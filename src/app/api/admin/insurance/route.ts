import { NextRequest, NextResponse } from "next/server";
import mongoose from "mongoose";
import { z } from "zod";
import connectDB from "@/lib/db";
import { InsurancePolicy, Vehicle } from "@/models";
import { requirePermission } from "@/lib/permissions";
import { ensureAllUnits, unitLabel } from "@/lib/fleetUnits";
import { runFleetAlerts } from "@/lib/notify";

export const dynamic = "force-dynamic";
const DAY = 86_400_000;

/** Keeps the car's "insurance until" date equal to its current policy (used by lists and alerts). */
async function syncUnitInsurance(vId: unknown, uId: unknown) {
  const vehicleId = new mongoose.Types.ObjectId(String(vId));
  const unitId = new mongoose.Types.ObjectId(String(uId));
  const current = await InsurancePolicy.findOne({ unitId, cancelled: { $ne: true }, renewedBy: { $exists: false } })
    .sort({ endDate: -1 })
    .select("endDate")
    .lean();
  await Vehicle.updateOne(
    { _id: vehicleId, "units._id": unitId },
    current ? { $set: { "units.$.insuranceExpiryDate": current.endDate } } : { $unset: { "units.$.insuranceExpiryDate": 1 } }
  );
}

export async function GET() {
  const guard = await requirePermission("garage", "view");
  if (!guard.ok) return guard.response;
  await connectDB();
  await ensureAllUnits();
  const [policies, vehicles] = await Promise.all([
    InsurancePolicy.find({}).sort({ endDate: 1 }).lean(),
    Vehicle.find({ status: { $ne: "archived" } }).select("brand model units._id units.licensePlate units.status").sort({ brand: 1, model: 1 }).lean(),
  ]);
  const unitInfo = new Map<string, { label: string; vehicle: string; vehicleId: string }>();
  const cars: { vehicleId: string; unitId: string; label: string }[] = [];
  for (const v of vehicles)
    (v.units || []).forEach((u, i) => {
      const label = unitLabel(u, i);
      unitInfo.set(String(u._id), { label, vehicle: `${v.brand} ${v.model}`, vehicleId: String(v._id) });
      cars.push({ vehicleId: String(v._id), unitId: String(u._id), label: `${v.brand} ${v.model} — ${label}` });
    });
  const now = Date.now();
  const rows = policies.map((p) => {
    const days = Math.ceil((new Date(p.endDate).getTime() - now) / DAY);
    const status = p.cancelled ? "cancelled" : p.renewedBy ? "renewed" : days < 0 ? "expired" : days <= 30 ? "expiring" : new Date(p.startDate).getTime() > now ? "upcoming" : "active";
    const info = unitInfo.get(String(p.unitId));
    return {
      _id: String(p._id),
      vehicleId: String(p.vehicleId),
      unitId: String(p.unitId),
      car: info ? `${info.vehicle} — ${info.label}` : "Véhicule supprimé",
      company: p.company,
      policyNumber: p.policyNumber,
      startDate: p.startDate,
      endDate: p.endDate,
      costTND: (p.cost || 0) / 100,
      attachmentUrl: p.attachmentUrl || "",
      notes: p.notes || "",
      daysLeft: days,
      status,
    };
  });
  const insured = new Set(rows.filter((r) => ["active", "expiring"].includes(r.status)).map((r) => r.unitId));
  return NextResponse.json({
    success: true,
    policies: rows,
    cars,
    uninsured: cars.filter((c) => !insured.has(c.unitId)),
    stats: {
      active: rows.filter((r) => r.status === "active").length,
      expiring: rows.filter((r) => r.status === "expiring").length,
      expired: rows.filter((r) => r.status === "expired").length,
      uninsured: cars.length - insured.size,
    },
  });
}

const dateStr = z.string().refine((v) => !Number.isNaN(Date.parse(v)), "Date invalide");
const policySchema = z
  .object({
    vehicleId: z.string(),
    unitId: z.string(),
    company: z.string().trim().min(2).max(120),
    policyNumber: z.string().trim().min(1).max(80),
    startDate: dateStr,
    endDate: dateStr,
    costTND: z.number().min(0).max(1_000_000).default(0),
    attachmentUrl: z.string().trim().max(1000).refine((v) => v === "" || /^https:\/\//.test(v) || v.startsWith("/"), "Lien invalide (https://…)").default(""),
    notes: z.string().max(1000).default(""),
  })
  .refine((d) => new Date(d.endDate) > new Date(d.startDate), { message: "La fin doit être après le début", path: ["endDate"] });

const bad = (e: z.ZodError) =>
  NextResponse.json({ success: false, error: e.issues[0]?.message || "Données invalides" }, { status: 400 });

async function checkCar(vehicleId: string, unitId: string) {
  if (!mongoose.Types.ObjectId.isValid(vehicleId) || !mongoose.Types.ObjectId.isValid(unitId)) return false;
  return Boolean(await Vehicle.exists({ _id: vehicleId, "units._id": unitId }));
}

/** Create a policy — or renew one ({ renewFrom: <policyId> }): the old policy is closed, history is kept. */
export async function POST(request: NextRequest) {
  const guard = await requirePermission("garage", "edit");
  if (!guard.ok) return guard.response;
  const body = await request.json().catch(() => ({}));
  const parsed = policySchema.safeParse(body);
  if (!parsed.success) return bad(parsed.error);
  await connectDB();
  const d = parsed.data;
  if (!(await checkCar(d.vehicleId, d.unitId))) return NextResponse.json({ success: false, error: "Véhicule introuvable" }, { status: 404 });
  const created = await InsurancePolicy.create({
    vehicleId: d.vehicleId,
    unitId: d.unitId,
    company: d.company,
    policyNumber: d.policyNumber,
    startDate: new Date(d.startDate),
    endDate: new Date(d.endDate),
    cost: Math.round(d.costTND * 100),
    attachmentUrl: d.attachmentUrl,
    notes: d.notes,
    createdBy: guard.session.user?.email || undefined,
  });
  if (typeof body.renewFrom === "string" && mongoose.Types.ObjectId.isValid(body.renewFrom)) {
    await InsurancePolicy.updateOne({ _id: body.renewFrom, unitId: d.unitId }, { $set: { renewedBy: created._id } });
  }
  await syncUnitInsurance(d.vehicleId, d.unitId);
  runFleetAlerts({ force: true }).catch(() => {});
  return NextResponse.json({ success: true, policy: created }, { status: 201 });
}

export async function PUT(request: NextRequest) {
  const guard = await requirePermission("garage", "edit");
  if (!guard.ok) return guard.response;
  const body = await request.json().catch(() => ({}));
  const id = String(body.id || "");
  if (!mongoose.Types.ObjectId.isValid(id)) return NextResponse.json({ success: false, error: "Contrat invalide" }, { status: 400 });
  const parsed = policySchema.safeParse(body);
  if (!parsed.success) return bad(parsed.error);
  await connectDB();
  const d = parsed.data;
  const policy = await InsurancePolicy.findById(id);
  if (!policy) return NextResponse.json({ success: false, error: "Contrat introuvable" }, { status: 404 });
  if (!(await checkCar(d.vehicleId, d.unitId))) return NextResponse.json({ success: false, error: "Véhicule introuvable" }, { status: 404 });
  const previous = { vehicleId: policy.vehicleId, unitId: policy.unitId };
  Object.assign(policy, {
    vehicleId: d.vehicleId,
    unitId: d.unitId,
    company: d.company,
    policyNumber: d.policyNumber,
    startDate: new Date(d.startDate),
    endDate: new Date(d.endDate),
    cost: Math.round(d.costTND * 100),
    attachmentUrl: d.attachmentUrl,
    notes: d.notes,
  });
  await policy.save();
  await syncUnitInsurance(d.vehicleId, d.unitId);
  if (String(previous.unitId) !== d.unitId) await syncUnitInsurance(previous.vehicleId, previous.unitId);
  runFleetAlerts({ force: true }).catch(() => {});
  return NextResponse.json({ success: true });
}

export async function DELETE(request: NextRequest) {
  const guard = await requirePermission("garage", "edit");
  if (!guard.ok) return guard.response;
  const id = new URL(request.url).searchParams.get("id") || "";
  if (!mongoose.Types.ObjectId.isValid(id)) return NextResponse.json({ success: false, error: "Contrat invalide" }, { status: 400 });
  await connectDB();
  const policy = await InsurancePolicy.findByIdAndDelete(id);
  if (!policy) return NextResponse.json({ success: false, error: "Contrat introuvable" }, { status: 404 });
  // A policy that was replaced by the deleted one becomes current again.
  await InsurancePolicy.updateMany({ renewedBy: policy._id }, { $unset: { renewedBy: 1 } });
  await syncUnitInsurance(policy.vehicleId, policy.unitId);
  return NextResponse.json({ success: true });
}
