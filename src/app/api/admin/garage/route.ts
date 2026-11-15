import { NextRequest, NextResponse } from "next/server";
import mongoose from "mongoose";
import { z } from "zod";
import connectDB from "@/lib/db";
import { Vehicle, MaintenanceRecord, Notification } from "@/models";
import { requireStaff } from "@/lib/apiAuth";
import { ensureAllUnits } from "@/lib/fleetUnits";
import { getAlertSettings, runFleetAlerts } from "@/lib/notify";
import { requirePermission } from "@/lib/permissions";

export const dynamic = "force-dynamic";

const DAY = 86_400_000;

/**
 * Garage = one row per physical car (license plate), split in three sections:
 * - Vidange (oil change by mileage)
 * - Maintenance (repairs / services, with history)
 * - Visite technique (+ insurance expiry)
 */
export async function GET() {
  const guard = await requirePermission("garage", "view");
  if (!guard.ok) return guard.response;

  try {
    await connectDB();
    await ensureAllUnits();
    const settings = await getAlertSettings();
    const now = Date.now();

    const vehicles = await Vehicle.find({ status: { $ne: "archived" } })
      .populate("categoryId", "name")
      .select("brand model year images units categoryId")
      .sort({ brand: 1, model: 1 })
      .lean();

    const records = await MaintenanceRecord.find({})
      .sort({ startDate: -1 })
      .limit(500)
      .lean();

    const units = vehicles.flatMap((v) =>
      (v.units || []).map((u, i) => {
        const mileage = Number(u.mileage || 0);
        const interval = Number(u.vidangeInterval || 10000);
        const last = Number(u.lastVidangeMileage || 0);
        const next = Number(u.nextVidangeMileage || last + interval);
        const remainingKm = next - mileage;
        const inspectionDays = u.technicalInspectionDate
          ? Math.ceil((new Date(u.technicalInspectionDate).getTime() - now) / DAY)
          : null;
        const insuranceDays = u.insuranceExpiryDate
          ? Math.ceil((new Date(u.insuranceExpiryDate).getTime() - now) / DAY)
          : null;
        const maintenanceDays = u.nextMaintenanceDate
          ? Math.ceil((new Date(u.nextMaintenanceDate).getTime() - now) / DAY)
          : null;
        const unitRecords = records.filter((r) => String(r.unitId || "") === String(u._id));
        return {
          vehicleId: String(v._id),
          unitId: String(u._id),
          brand: v.brand,
          model: v.model,
          year: v.year,
          category: (v.categoryId as { name?: { fr?: string } } | null)?.name?.fr || "",
          image: v.images?.find((im) => im.isPrimary)?.url || v.images?.[0]?.url || "",
          licensePlate: u.licensePlate || "",
          label: u.licensePlate || `${v.brand} ${v.model} #${i + 1} (immat. à saisir)`,
          status: u.status,
          mileage,
          lastVidangeMileage: last,
          lastVidangeDate: u.lastVidangeDate || null,
          vidangeInterval: interval,
          nextVidangeMileage: next,
          remainingKm,
          percentUsed: Math.min(100, Math.max(0, Math.round(((mileage - last) / interval) * 100))),
          vidangeState: remainingKm <= 0 ? "overdue" : remainingKm <= settings.vidangeKmThreshold ? "soon" : "ok",
          technicalInspectionDate: u.technicalInspectionDate || null,
          inspectionDays,
          inspectionState:
            inspectionDays === null ? "unknown" : inspectionDays < 0 ? "overdue" : inspectionDays <= settings.inspectionDaysThreshold ? "soon" : "ok",
          insuranceExpiryDate: u.insuranceExpiryDate || null,
          insuranceDays,
          insuranceState:
            insuranceDays === null ? "unknown" : insuranceDays < 0 ? "overdue" : insuranceDays <= settings.insuranceDaysThreshold ? "soon" : "ok",
          nextMaintenanceDate: u.nextMaintenanceDate || null,
          maintenanceDays,
          openMaintenance: unitRecords.filter((r) => ["scheduled", "in_progress"].includes(r.status)).length,
          notes: u.notes || "",
          history: unitRecords.slice(0, 15).map((r) => ({
            _id: String(r._id),
            type: r.type,
            description: r.description,
            status: r.status,
            startDate: r.startDate,
            endDate: r.endDate || null,
            cost: r.cost || 0,
            provider: r.provider || "",
            mileage: r.mileage ?? null,
          })),
        };
      })
    );

    const count = (fn: (u: (typeof units)[number]) => boolean) => units.filter(fn).length;
    return NextResponse.json({
      success: true,
      units,
      settings,
      stats: {
        total: units.length,
        inGarage: count((u) => u.status === "maintenance"),
        vidange: { overdue: count((u) => u.vidangeState === "overdue"), soon: count((u) => u.vidangeState === "soon") },
        inspection: {
          overdue: count((u) => u.inspectionState === "overdue" || u.insuranceState === "overdue"),
          soon: count((u) => u.inspectionState === "soon" || u.insuranceState === "soon"),
          unknown: count((u) => u.inspectionState === "unknown"),
        },
        maintenance: { open: count((u) => u.openMaintenance > 0), dueSoon: count((u) => u.maintenanceDays !== null && u.maintenanceDays <= 7) },
      },
    });
  } catch (error) {
    console.error("GET /api/admin/garage error:", error);
    return NextResponse.json({ success: false, error: "Erreur lors du chargement du garage." }, { status: 500 });
  }
}

const dateStr = z.string().refine((v) => v === "" || !Number.isNaN(Date.parse(v)), "Date invalide");

const patchSchema = z.discriminatedUnion("action", [
  z.object({
    action: z.literal("update"),
    vehicleId: z.string(),
    unitId: z.string(),
    mileage: z.number().min(0).max(2_000_000).optional(),
    vidangeInterval: z.number().min(500).max(100_000).optional(),
    lastVidangeMileage: z.number().min(0).max(2_000_000).optional(),
    nextVidangeMileage: z.number().min(0).max(2_000_000).optional(),
    technicalInspectionDate: dateStr.optional(),
    insuranceExpiryDate: dateStr.optional(),
    nextMaintenanceDate: dateStr.optional(),
    status: z.enum(["active", "maintenance", "out_of_service"]).optional(),
    notes: z.string().max(3000).optional(),
  }),
  z.object({
    action: z.literal("vidange_done"),
    vehicleId: z.string(),
    unitId: z.string(),
    mileage: z.number().min(0).max(2_000_000),
    date: dateStr.optional(),
    cost: z.number().min(0).max(100_000).optional(),
    provider: z.string().max(120).optional(),
    notes: z.string().max(1000).optional(),
  }),
  z.object({
    action: z.literal("inspection_done"),
    vehicleId: z.string(),
    unitId: z.string(),
    date: dateStr.optional(),
    nextDate: z.string().refine((v) => !Number.isNaN(Date.parse(v)), "Date invalide"),
    cost: z.number().min(0).max(100_000).optional(),
    provider: z.string().max(120).optional(),
    notes: z.string().max(1000).optional(),
  }),
  z.object({
    action: z.literal("add_maintenance"),
    vehicleId: z.string(),
    unitId: z.string(),
    type: z.enum(["scheduled", "unscheduled", "repair", "tyres", "bodywork", "inspection"]),
    description: z.string().trim().min(2).max(500),
    startDate: dateStr.optional(),
    endDate: dateStr.optional(),
    cost: z.number().min(0).max(1_000_000).optional(),
    provider: z.string().max(120).optional(),
    mileage: z.number().min(0).max(2_000_000).optional(),
    status: z.enum(["scheduled", "in_progress", "completed"]).default("scheduled"),
    /** Puts the car "in the garage" (not rentable) while the work is in progress. */
    immobilize: z.boolean().optional(),
  }),
  z.object({
    action: z.literal("update_maintenance"),
    recordId: z.string(),
    status: z.enum(["scheduled", "in_progress", "completed", "cancelled"]),
    cost: z.number().min(0).max(1_000_000).optional(),
    notes: z.string().max(1000).optional(),
  }),
]);

/** Marks every alert of a kind for a car as read once the work is done. */
async function clearAlerts(unitId: string, types: string[]) {
  await Notification.updateMany(
    { "data.unitId": unitId, type: { $in: types }, isRead: false },
    { $set: { isRead: true, readAt: new Date() } }
  ).catch(() => {});
}

export async function PATCH(request: NextRequest) {
  const guard = await requirePermission("garage", "edit");
  if (!guard.ok) return guard.response;
  const by = guard.session.user?.id;

  const parsed = patchSchema.safeParse(await request.json().catch(() => ({})));
  if (!parsed.success) {
    return NextResponse.json({ success: false, error: parsed.error.issues[0]?.message || "Données invalides" }, { status: 400 });
  }
  const a = parsed.data;

  try {
    await connectDB();

    if (a.action === "update_maintenance") {
      if (!mongoose.Types.ObjectId.isValid(a.recordId)) {
        return NextResponse.json({ success: false, error: "Intervention introuvable" }, { status: 404 });
      }
      const rec = await MaintenanceRecord.findById(a.recordId);
      if (!rec) return NextResponse.json({ success: false, error: "Intervention introuvable" }, { status: 404 });
      rec.status = a.status;
      if (a.cost !== undefined) rec.cost = a.cost;
      if (a.notes) rec.notes = [rec.notes, a.notes].filter(Boolean).join("\n");
      if (a.status === "completed" || a.status === "cancelled") rec.endDate = rec.endDate || new Date();
      await rec.save();
      // Back in service when no other open work remains on this car.
      if ((a.status === "completed" || a.status === "cancelled") && rec.unitId) {
        const stillOpen = await MaintenanceRecord.countDocuments({
          unitId: rec.unitId,
          status: "in_progress",
          _id: { $ne: rec._id },
        });
        if (!stillOpen) {
          await Vehicle.updateOne(
            { _id: rec.vehicleId, "units._id": rec.unitId, "units.status": "maintenance" },
            { $set: { "units.$.status": "active" } }
          );
        }
        await clearAlerts(String(rec.unitId), ["maintenance_due"]);
      }
      return NextResponse.json({ success: true });
    }

    if (!mongoose.Types.ObjectId.isValid(a.vehicleId) || !mongoose.Types.ObjectId.isValid(a.unitId)) {
      return NextResponse.json({ success: false, error: "Véhicule invalide" }, { status: 400 });
    }
    const vehicle = await Vehicle.findOne({ _id: a.vehicleId, "units._id": a.unitId });
    const unit = vehicle?.units?.find((u) => String(u._id) === a.unitId);
    if (!vehicle || !unit) {
      return NextResponse.json({ success: false, error: "Véhicule introuvable" }, { status: 404 });
    }
    const plate = unit.licensePlate || "";
    const toDate = (v?: string) => (v ? new Date(v) : undefined);

    if (a.action === "update") {
      if (a.mileage !== undefined) unit.mileage = a.mileage;
      if (a.vidangeInterval !== undefined) unit.vidangeInterval = a.vidangeInterval;
      if (a.lastVidangeMileage !== undefined) unit.lastVidangeMileage = a.lastVidangeMileage;
      if (a.nextVidangeMileage !== undefined) unit.nextVidangeMileage = a.nextVidangeMileage;
      else if (a.lastVidangeMileage !== undefined || a.vidangeInterval !== undefined) {
        unit.nextVidangeMileage = Number(unit.lastVidangeMileage || 0) + Number(unit.vidangeInterval || 10000);
      }
      if (a.technicalInspectionDate !== undefined) unit.technicalInspectionDate = toDate(a.technicalInspectionDate);
      if (a.insuranceExpiryDate !== undefined) unit.insuranceExpiryDate = toDate(a.insuranceExpiryDate);
      if (a.nextMaintenanceDate !== undefined) unit.nextMaintenanceDate = toDate(a.nextMaintenanceDate);
      if (a.status !== undefined) unit.status = a.status;
      if (a.notes !== undefined) unit.notes = a.notes;
    }

    if (a.action === "vidange_done") {
      unit.mileage = Math.max(Number(unit.mileage || 0), a.mileage);
      unit.lastVidangeMileage = a.mileage;
      unit.lastVidangeDate = toDate(a.date) || new Date();
      unit.nextVidangeMileage = a.mileage + Number(unit.vidangeInterval || 10000);
      await MaintenanceRecord.create({
        vehicleId: vehicle._id,
        unitId: unit._id,
        licensePlate: plate,
        type: "vidange",
        description: `Vidange à ${a.mileage.toLocaleString("fr-FR")} km`,
        startDate: unit.lastVidangeDate,
        endDate: unit.lastVidangeDate,
        mileage: a.mileage,
        cost: a.cost,
        provider: a.provider,
        notes: a.notes,
        status: "completed",
        ...(by && mongoose.Types.ObjectId.isValid(by) ? { recordedBy: by } : {}),
      });
      await clearAlerts(a.unitId, ["vidange_due", "vidange_overdue"]);
    }

    if (a.action === "inspection_done") {
      unit.technicalInspectionDate = new Date(a.nextDate);
      await MaintenanceRecord.create({
        vehicleId: vehicle._id,
        unitId: unit._id,
        licensePlate: plate,
        type: "technical_inspection",
        description: `Visite technique — prochaine échéance ${new Date(a.nextDate).toLocaleDateString("fr-FR")}`,
        startDate: toDate(a.date) || new Date(),
        endDate: toDate(a.date) || new Date(),
        mileage: unit.mileage,
        cost: a.cost,
        provider: a.provider,
        notes: a.notes,
        status: "completed",
        ...(by && mongoose.Types.ObjectId.isValid(by) ? { recordedBy: by } : {}),
      });
      await clearAlerts(a.unitId, ["inspection_due", "inspection_overdue"]);
    }

    if (a.action === "add_maintenance") {
      await MaintenanceRecord.create({
        vehicleId: vehicle._id,
        unitId: unit._id,
        licensePlate: plate,
        type: a.type,
        description: a.description,
        startDate: toDate(a.startDate) || new Date(),
        endDate: toDate(a.endDate),
        mileage: a.mileage ?? unit.mileage,
        cost: a.cost,
        provider: a.provider,
        status: a.status,
        ...(by && mongoose.Types.ObjectId.isValid(by) ? { recordedBy: by } : {}),
      });
      if (a.status === "scheduled" && a.startDate) unit.nextMaintenanceDate = toDate(a.startDate);
      if (a.immobilize || a.status === "in_progress") unit.status = "maintenance";
    }

    vehicle.markModified("units");
    await vehicle.save();
    // Re-evaluate alerts right away so the bell reflects the change.
    runFleetAlerts({ force: true }).catch(() => {});
    return NextResponse.json({ success: true });
  } catch (error) {
    console.error("PATCH /api/admin/garage error:", error);
    return NextResponse.json({ success: false, error: "Erreur lors de la mise à jour." }, { status: 500 });
  }
}
