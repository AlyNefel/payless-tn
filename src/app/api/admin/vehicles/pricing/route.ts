import { NextRequest, NextResponse } from "next/server";
import mongoose from "mongoose";
import { z } from "zod";
import { connectDB } from "@/lib/db";
import Vehicle from "@/models/Vehicle";
import { requirePermission } from "@/lib/permissions";
import { overlappingPeriods, type SeasonalPriceRule } from "@/lib/seasonalPricing";
import { logAudit } from "@/lib/audit";

export const dynamic = "force-dynamic";

/** Prices are stored in minor units (1 TND = 100) on current data; very old records stored dinars. */
const toTND = (v: number | undefined, cents: boolean) => (cents ? Math.round(Number(v || 0)) / 100 : Number(v || 0));
const fromTND = (v: number, cents: boolean) => (cents ? Math.round(v * 100) : Math.round(v));
const isCents = (vehicle: { pricing?: { daily?: number } }) => Number(vehicle.pricing?.daily || 0) >= 1000 || Number(vehicle.pricing?.daily || 0) === 0;

const MD = /^(0[1-9]|1[0-2])-(0[1-9]|[12]\d|3[01])$/;
const YMD = /^\d{4}-(0[1-9]|1[0-2])-(0[1-9]|[12]\d|3[01])$/;

const periodSchema = z
  .object({
    name: z.string().trim().min(1, "Chaque période doit avoir un nom.").max(60),
    /** "MM-DD" = every year; "YYYY-MM-DD" = these dates only. */
    startDate: z.string().trim(),
    endDate: z.string().trim(),
    dailyRate: z.number().positive("Le tarif d'une période doit être supérieur à 0."),
    discountPercent: z.number().min(0).max(90).optional().default(0),
    minDays: z.number().int().min(0).max(365).optional().default(0),
  })
  .superRefine((p, ctx) => {
    const yearly = MD.test(p.startDate) && MD.test(p.endDate);
    const fixed = YMD.test(p.startDate) && YMD.test(p.endDate);
    if (!yearly && !fixed) ctx.addIssue({ code: "custom", message: `« ${p.name} » : dates invalides.` });
    if (fixed && p.endDate < p.startDate) ctx.addIssue({ code: "custom", message: `« ${p.name} » : la fin est avant le début.` });
    if (yearly) {
      const [m, d] = p.startDate.split("-").map(Number);
      const [m2, d2] = p.endDate.split("-").map(Number);
      const days = [31, 29, 31, 30, 31, 30, 31, 31, 30, 31, 30, 31];
      if (d > days[m - 1] || d2 > days[m2 - 1]) ctx.addIssue({ code: "custom", message: `« ${p.name} » : ce jour n'existe pas dans ce mois.` });
    }
  });

/** Old rules stored only months: shown as 1st of the first month → last day of the last month. */
function asDates(s: { startMonth?: number; endMonth?: number; startDate?: string; endDate?: string }) {
  if (s.startDate && s.endDate) return { startDate: s.startDate, endDate: s.endDate };
  const last = [31, 29, 31, 30, 31, 30, 31, 31, 30, 31, 30, 31];
  const sm = Number(s.startMonth || 1);
  const em = Number(s.endMonth || 12);
  return { startDate: `${String(sm).padStart(2, "0")}-01`, endDate: `${String(em).padStart(2, "0")}-${last[em - 1]}` };
}

export async function GET() {
  const guard = await requirePermission("pricing", "view");
  if (!guard.ok) return guard.response;
  try {
    await connectDB();
    const vehicles = await Vehicle.find({ status: { $ne: "archived" } })
      .select("brand model licensePlate category categoryId images pricing status minRentalDays")
      .populate("categoryId", "name")
      .sort({ brand: 1, model: 1 })
      .lean();
    return NextResponse.json({
      success: true,
      vehicles: vehicles.map((v) => {
        const cents = isCents(v);
        const cat = v.categoryId as unknown as { _id?: unknown; name?: { fr?: string } } | null;
        return {
          _id: String(v._id),
          brand: v.brand,
          model: v.model,
          licensePlate: v.licensePlate || "",
          category: cat?.name?.fr || (v as { category?: string }).category || "",
          categoryId: cat?._id ? String(cat._id) : "",
          imageUrl: v.images?.find((img) => img.isPrimary)?.url || v.images?.[0]?.url || "",
          status: v.status || "available",
          minRentalDays: v.minRentalDays || v.pricing?.minRentalDays || 1,
          pricing: {
            daily: toTND(v.pricing?.daily, cents),
            deposit: toTND(v.pricing?.deposit, cents),
            seasonalPrices: (v.pricing?.seasonalPrices || []).map((s) => ({
              name: s.name || "",
              ...asDates(s),
              // Same reading as the price engine: under 1 000 on a minor-units model = stored in dinars.
              dailyRate: toTND(s.dailyRate, cents && Number(s.dailyRate) >= 1000),
              discountPercent: s.discountPercent || 0,
              minDays: s.minDays || 0,
            })),
          },
        };
      }),
    });
  } catch (error) {
    console.error("GET /api/admin/vehicles/pricing error:", error);
    return NextResponse.json({ error: "Failed to fetch vehicle pricing" }, { status: 500 });
  }
}

const saveSchema = z.object({
  vehicleId: z.string(),
  dailyRate: z.number().positive("Le tarif standard doit être supérieur à 0.").optional(),
  minRentalDays: z.number().int().min(1).max(365).optional(),
  seasonalPrices: z.array(periodSchema).max(24).optional(),
});

const copySchema = z.object({
  action: z.literal("copy"),
  vehicleId: z.string(),
  targetIds: z.array(z.string()).min(1).max(200),
  /** "percent": each model keeps the same % above/below its own standard price. "same": same price in TND. */
  priceMode: z.enum(["percent", "same"]).default("percent"),
  includeMinRentalDays: z.boolean().default(true),
});

function validationError(issues: z.ZodIssue[]) {
  return NextResponse.json({ success: false, error: issues[0]?.message || "Données invalides" }, { status: 400 });
}

/** Refuses two periods of one model covering the same day (the first one would silently win). */
function overlapError(periods: SeasonalPriceRule[]) {
  const clash = overlappingPeriods(periods)[0];
  if (!clash) return null;
  return NextResponse.json(
    { success: false, error: `Les périodes « ${periods[clash[0]].name} » et « ${periods[clash[1]].name} » se chevauchent : un même jour ne peut avoir qu'un seul tarif.` },
    { status: 400 }
  );
}

export async function PUT(request: NextRequest) {
  const guard = await requirePermission("pricing", "edit");
  if (!guard.ok) return guard.response;
  const body = await request.json().catch(() => ({}));
  await connectDB();

  // ── Copy one model's periods (and minimum) to other models ──
  if (body?.action === "copy") {
    const parsed = copySchema.safeParse(body);
    if (!parsed.success) return validationError(parsed.error.issues);
    const d = parsed.data;
    const source = await Vehicle.findById(d.vehicleId).lean();
    if (!source) return NextResponse.json({ success: false, error: "Modèle introuvable" }, { status: 404 });
    const srcBase = Number(source.pricing?.daily || 0);
    const ids = d.targetIds.filter((id) => id !== d.vehicleId && mongoose.Types.ObjectId.isValid(id));
    const targets = await Vehicle.find({ _id: { $in: ids } });
    for (const t of targets) {
      const base = Number(t.pricing?.daily || 0);
      t.pricing.seasonalPrices = (source.pricing?.seasonalPrices || []).map((s) => {
        const rate =
          d.priceMode === "same" || !srcBase || !base
            ? Number(s.dailyRate)
            : // Keep the same % gap with the standard price, rounded to the dinar.
              Math.max(100, Math.round(((Number(s.dailyRate) / srcBase) * base) / 100) * 100);
        return { name: s.name, startDate: s.startDate, endDate: s.endDate, startMonth: s.startMonth, endMonth: s.endMonth, dailyRate: rate, discountPercent: s.discountPercent || 0, minDays: s.minDays || 0 };
      }) as never;
      if (d.includeMinRentalDays) {
        t.minRentalDays = source.minRentalDays || 1;
        t.pricing.minRentalDays = source.minRentalDays || 1;
      }
      t.markModified("pricing");
      await t.save();
    }
    await logAudit(guard.session, "pricing.copy", "pricing", d.vehicleId, {
      after: { from: `${source.brand} ${source.model}`, to: targets.map((t) => `${t.brand} ${t.model}`), priceMode: d.priceMode },
    });
    return NextResponse.json({ success: true, updated: targets.length });
  }

  const parsed = saveSchema.safeParse(body);
  if (!parsed.success) return validationError(parsed.error.issues);
  const d = parsed.data;
  if (!mongoose.Types.ObjectId.isValid(d.vehicleId)) return NextResponse.json({ error: "vehicleId is required" }, { status: 400 });
  const vehicle = await Vehicle.findById(d.vehicleId);
  if (!vehicle) return NextResponse.json({ error: "Vehicle not found" }, { status: 404 });
  const cents = isCents(vehicle);
  const before = {
    daily: vehicle.pricing?.daily,
    minRentalDays: vehicle.minRentalDays,
    periods: (vehicle.pricing?.seasonalPrices || []).map((s) => `${s.name} ${s.startDate || s.startMonth}→${s.endDate || s.endMonth} ${s.dailyRate} min ${s.minDays || 0}`),
  };

  if (d.seasonalPrices) {
    const rules: SeasonalPriceRule[] = d.seasonalPrices.map((s) => ({ ...s, dailyRate: fromTND(s.dailyRate, cents) }));
    const err = overlapError(rules);
    if (err) return err;
    vehicle.pricing.seasonalPrices = rules.map((s) => ({
      name: s.name,
      startDate: s.startDate,
      endDate: s.endDate,
      startMonth: undefined,
      endMonth: undefined,
      dailyRate: s.dailyRate,
      discountPercent: s.discountPercent || 0,
      minDays: s.minDays || 0,
    })) as never;
  }
  if (d.dailyRate !== undefined) vehicle.pricing.daily = fromTND(d.dailyRate, cents);
  if (d.minRentalDays !== undefined) {
    vehicle.minRentalDays = d.minRentalDays;
    vehicle.pricing.minRentalDays = d.minRentalDays;
  }
  vehicle.markModified("pricing");
  await vehicle.save();
  await logAudit(guard.session, "pricing.model", "pricing", d.vehicleId, {
    before,
    after: {
      daily: vehicle.pricing.daily,
      minRentalDays: vehicle.minRentalDays,
      periods: (vehicle.pricing.seasonalPrices || []).map((s) => `${s.name} ${s.startDate}→${s.endDate} ${s.dailyRate} min ${s.minDays || 0}`),
    },
  });
  return NextResponse.json({ success: true, message: "Tarifs mis à jour avec succès" });
}
