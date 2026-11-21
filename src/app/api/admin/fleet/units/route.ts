import { NextRequest, NextResponse } from "next/server";
import mongoose from "mongoose";
import connectDB from "@/lib/db";
import { Vehicle, Booking, MaintenanceRecord, InsurancePolicy } from "@/models";
import { requirePermission } from "@/lib/permissions";
import { z } from "zod";
import { ensureAllUnits, ensureHoldsBackfilled, reassignBookingsOfUnit, unitLabel } from "@/lib/fleetUnits";
import { HOLDING_STATUSES, assignmentBookedWindow, effectiveReturn } from "@/lib/bookingOverlap";

export const dynamic = "force-dynamic";

/**
 * Physical fleet overview: every car model with its physical cars, and for each car its current
 * rental, upcoming reservations, open maintenance and insurance. Feeds the fleet accordions and
 * the per-car calendar.
 */
export async function GET(request: NextRequest) {
  const guard = await requirePermission("fleet", "view");
  if (!guard.ok) return guard.response;
  await connectDB();
  await ensureAllUnits();
  await ensureHoldsBackfilled();
  const withBookings = new URL(request.url).searchParams.get("bookings") === "1";
  const now = new Date();

  const [vehicles, bookings, maint, policies] = await Promise.all([
    Vehicle.find({ status: { $ne: "archived" } })
      .populate("categoryId", "name")
      .populate("location", "name city")
      .select("brand model year images units status pricing.daily categoryId location totalUnits")
      .sort({ brand: 1, model: 1 })
      .lean(),
    Booking.find({ bookingStatus: { $in: HOLDING_STATUSES } })
      .select("bookingReference pickupDate returnDate pickupTime returnTime bookingStatus paymentStatus assignedUnits customerId vehicleId vehicles pricingBreakdown.totalAmount")
      .populate("customerId", "firstName lastName phone")
      .sort({ pickupDate: 1 })
      .lean(),
    MaintenanceRecord.aggregate([{ $match: { status: { $in: ["scheduled", "in_progress"] } } }, { $group: { _id: "$unitId", n: { $sum: 1 } } }]),
    InsurancePolicy.find({ cancelled: { $ne: true }, renewedBy: { $exists: false } }).select("unitId endDate company").sort({ endDate: -1 }).lean(),
  ]);

  const openMaint = new Map(maint.map((m) => [String(m._id), m.n as number]));
  const policyOf = new Map<string, (typeof policies)[number]>();
  for (const p of policies) if (!policyOf.has(String(p.unitId))) policyOf.set(String(p.unitId), p);

  type Row = {
    _id: string;
    reference: string;
    status: string;
    paymentStatus?: string;
    customerName: string;
    customerPhone: string;
    pickupDate: string;
    returnDate: string;
    pickupTime?: string;
    returnTime?: string;
    totalAmount: number;
    late: boolean;
    /** Car changed during the rental: "replaced" (first part) or "replacement" (second part). */
    segment?: "replaced" | "replacement";
  };
  const byUnit = new Map<string, Row[]>();
  const unassignedByModel = new Map<string, Row[]>();
  for (const b of bookings) {
    const cust = b.customerId as unknown as { firstName?: string; lastName?: string; phone?: string } | null;
    const row: Row = {
      _id: String(b._id),
      reference: b.bookingReference,
      status: b.bookingStatus,
      paymentStatus: b.paymentStatus,
      customerName: cust ? `${cust.firstName || ""} ${cust.lastName || ""}`.trim() : "Client",
      customerPhone: cust?.phone || "",
      pickupDate: new Date(b.pickupDate).toISOString().slice(0, 10),
      returnDate: new Date(b.returnDate).toISOString().slice(0, 10),
      pickupTime: b.pickupTime,
      returnTime: b.returnTime,
      totalAmount: b.pricingBreakdown?.totalAmount || 0,
      late: b.bookingStatus === "active" && new Date(b.returnDate) < now,
    };
    const assigned = (b.assignedUnits || []).filter((a) => a.unitId);
    for (const a of assigned) {
      // After a car change each car shows only its own part of the rental (calendar, current rental).
      const w = assignmentBookedWindow(b, a);
      if (w.end <= w.start) continue;
      const seg: Row = a.from || a.to
        ? { ...row, pickupDate: w.start.toISOString().slice(0, 10), returnDate: w.end.toISOString().slice(0, 10), segment: a.to ? "replaced" : "replacement" }
        : row;
      // A replaced car whose segment is over is free again.
      if (a.to && effectiveReturn({ bookingStatus: "completed", returnDate: w.end }) <= now && b.bookingStatus === "active") continue;
      byUnit.set(String(a.unitId), [...(byUnit.get(String(a.unitId)) || []), seg]);
    }
    const wanted = b.vehicles?.length || 1;
    if (assigned.filter((a) => !a.to).length < wanted) {
      const mId = String((b.vehicleId as unknown as mongoose.Types.ObjectId) || "");
      unassignedByModel.set(mId, [...(unassignedByModel.get(mId) || []), row]);
    }
  }

  const models = vehicles.map((v) => {
    const units = (v.units || []).map((u, i) => {
      const list = byUnit.get(String(u._id)) || [];
      const current = list.find((r) => r.status === "active") ||
        list.find((r) => new Date(r.pickupDate) <= now && effectiveReturn({ bookingStatus: r.status, returnDate: r.returnDate }) > now);
      const upcoming = list.filter((r) => r !== current && new Date(r.returnDate) >= now);
      const pol = policyOf.get(String(u._id));
      const insuranceEnd = pol?.endDate || u.insuranceExpiryDate || null;
      return {
        unitId: String(u._id),
        index: i + 1,
        label: unitLabel(u, i),
        licensePlate: u.licensePlate || "",
        status: u.status,
        // What the car is doing right now.
        availability: u.status !== "active" ? (u.status === "maintenance" ? "garage" : "out") : current ? "rented" : "free",
        mileage: u.mileage || 0,
        current: current || null,
        next: upcoming[0] || null,
        upcomingCount: upcoming.length,
        openMaintenance: openMaint.get(String(u._id)) || 0,
        nextVidangeMileage: u.nextVidangeMileage || 0,
        technicalInspectionDate: u.technicalInspectionDate || null,
        insuranceEnd,
        insuranceCompany: pol?.company || "",
        notes: u.notes || "",
        ...(withBookings ? { bookings: list } : {}),
      };
    });
    return {
      _id: String(v._id),
      brand: v.brand,
      model: v.model,
      year: v.year,
      category: (v.categoryId as unknown as { name?: { fr?: string } } | null)?.name?.fr || "",
      location: (v.location as unknown as { name?: { fr?: string } } | null)?.name?.fr || "",
      image: v.images?.find((im) => im.isPrimary)?.url || v.images?.[0]?.url || "",
      dailyTND: Math.round(Number(v.pricing?.daily || 0)) / 100,
      status: v.status,
      units,
      counts: {
        total: units.length,
        free: units.filter((u) => u.availability === "free").length,
        rented: units.filter((u) => u.availability === "rented").length,
        garage: units.filter((u) => u.availability === "garage" || u.availability === "out").length,
      },
      unassigned: unassignedByModel.get(String(v._id)) || [],
    };
  });

  return NextResponse.json({ success: true, models });
}

/* ───────────── Physical car management (add / edit / remove one car of a model) ───────────── */


const plate = z.string().trim().max(20).transform((v) => v.toUpperCase());

async function plateTaken(value: string, exceptUnitId?: string): Promise<boolean> {
  if (!value) return false;
  const other = await Vehicle.findOne({ "units.licensePlate": value }).select("units._id units.licensePlate").lean();
  return Boolean(other?.units?.some((u) => u.licensePlate === value && String(u._id) !== exceptUnitId));
}

/** Add a physical car to a model. The plate is optional (it can be filled in later). */
export async function POST(request: NextRequest) {
  const guard = await requirePermission("fleet", "create");
  if (!guard.ok) return guard.response;
  const parsed = z.object({ vehicleId: z.string(), licensePlate: plate.optional().default(""), mileage: z.number().min(0).max(2_000_000).optional() }).safeParse(await request.json().catch(() => ({})));
  if (!parsed.success || !mongoose.Types.ObjectId.isValid(parsed.data.vehicleId)) {
    return NextResponse.json({ success: false, error: "Données invalides" }, { status: 400 });
  }
  await connectDB();
  const d = parsed.data;
  if (await plateTaken(d.licensePlate)) return NextResponse.json({ success: false, error: `L'immatriculation ${d.licensePlate} est déjà utilisée.` }, { status: 409 });
  const km = d.mileage || 0;
  const v = await Vehicle.findByIdAndUpdate(
    d.vehicleId,
    { $push: { units: { licensePlate: d.licensePlate, status: "active", mileage: km, lastVidangeMileage: km, vidangeInterval: 10000, nextVidangeMileage: km + 10000 } } },
    { returnDocument: "after" }
  );
  if (!v) return NextResponse.json({ success: false, error: "Modèle introuvable" }, { status: 404 });
  await Vehicle.updateOne({ _id: v._id }, { $set: { totalUnits: Math.max(1, (v.units || []).filter((u) => u.status === "active").length) } });
  return NextResponse.json({ success: true }, { status: 201 });
}

/** Edit one physical car: plate, status, notes. Taking a car out of service moves its future bookings. */
export async function PATCH(request: NextRequest) {
  const guard = await requirePermission("fleet", "edit");
  if (!guard.ok) return guard.response;
  const parsed = z
    .object({
      vehicleId: z.string(),
      unitId: z.string(),
      licensePlate: plate.optional(),
      status: z.enum(["active", "maintenance", "out_of_service"]).optional(),
      notes: z.string().max(3000).optional(),
    })
    .safeParse(await request.json().catch(() => ({})));
  if (!parsed.success || !mongoose.Types.ObjectId.isValid(parsed.data.vehicleId) || !mongoose.Types.ObjectId.isValid(parsed.data.unitId)) {
    return NextResponse.json({ success: false, error: "Données invalides" }, { status: 400 });
  }
  await connectDB();
  const d = parsed.data;
  if (d.licensePlate && (await plateTaken(d.licensePlate, d.unitId))) {
    return NextResponse.json({ success: false, error: `L'immatriculation ${d.licensePlate} est déjà utilisée.` }, { status: 409 });
  }
  const set: Record<string, unknown> = {};
  if (d.licensePlate !== undefined) set["units.$.licensePlate"] = d.licensePlate;
  if (d.status !== undefined) set["units.$.status"] = d.status;
  if (d.notes !== undefined) set["units.$.notes"] = d.notes;
  const v = await Vehicle.findOneAndUpdate({ _id: d.vehicleId, "units._id": d.unitId }, { $set: set }, { returnDocument: "after" });
  if (!v) return NextResponse.json({ success: false, error: "Véhicule introuvable" }, { status: 404 });
  await Vehicle.updateOne({ _id: v._id }, { $set: { totalUnits: Math.max(1, (v.units || []).filter((u) => u.status === "active").length) } });
  // Keep the plate snapshot of the bookings in sync, and move bookings if the car is no longer rentable.
  if (d.licensePlate !== undefined) {
    await Booking.updateMany(
      { "assignedUnits.unitId": new mongoose.Types.ObjectId(d.unitId) },
      { $set: { "assignedUnits.$[a].licensePlate": d.licensePlate } },
      { arrayFilters: [{ "a.unitId": new mongoose.Types.ObjectId(d.unitId) }] }
    );
  }
  let moved = { moved: [] as string[], unassigned: [] as string[] };
  if (d.status && d.status !== "active") moved = await reassignBookingsOfUnit(d.unitId);
  return NextResponse.json({ success: true, ...moved });
}

/** Remove one physical car. Refused while a customer has it; its future bookings move to another car. */
export async function DELETE(request: NextRequest) {
  const guard = await requirePermission("fleet", "delete");
  if (!guard.ok) return guard.response;
  const sp = new URL(request.url).searchParams;
  const vehicleId = sp.get("vehicleId") || "";
  const unitId = sp.get("unitId") || "";
  if (!mongoose.Types.ObjectId.isValid(vehicleId) || !mongoose.Types.ObjectId.isValid(unitId)) {
    return NextResponse.json({ success: false, error: "Véhicule invalide" }, { status: 400 });
  }
  await connectDB();
  const uid = new mongoose.Types.ObjectId(unitId);
  const v = await Vehicle.findOne({ _id: vehicleId, "units._id": uid }).select("units._id");
  if (!v) return NextResponse.json({ success: false, error: "Véhicule introuvable" }, { status: 404 });
  if ((v.units || []).length <= 1) {
    return NextResponse.json({ success: false, error: "C'est le dernier véhicule de ce modèle : archivez le modèle à la place." }, { status: 409 });
  }
  // Only the car currently with the customer counts (a car replaced during the rental is back).
  const onRoad = await Booking.findOne({ bookingStatus: "active", assignedUnits: { $elemMatch: { unitId: uid, to: { $exists: false } } } }).select("bookingReference").lean();
  if (onRoad) {
    return NextResponse.json({ success: false, error: `Ce véhicule est actuellement en location (${onRoad.bookingReference}).` }, { status: 409 });
  }
  await Vehicle.updateOne({ _id: vehicleId }, { $pull: { units: { _id: uid } } });
  const fresh = await Vehicle.findById(vehicleId).select("units.status");
  await Vehicle.updateOne({ _id: vehicleId }, { $set: { totalUnits: Math.max(1, (fresh?.units || []).filter((u) => u.status === "active").length) } });
  const moved = await reassignBookingsOfUnit(unitId);
  return NextResponse.json({ success: true, ...moved });
}
