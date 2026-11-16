import mongoose from "mongoose";
import connectDB from "./db";
import Vehicle, { type IVehicleUnit } from "@/models/Vehicle";
import Booking from "@/models/Booking";
import { HOLDING_STATUSES, overlapFilter, reallyOverlaps } from "./bookingOverlap";

/**
 * Physical fleet ("units"): one car model (Vehicle) owns N physical cars, each with its own
 * license plate, mileage and maintenance schedule.
 *
 * Legacy vehicles only stored `licensePlate` + `totalUnits`. They are migrated lazily the first
 * time they are touched: unit #1 receives the model's plate, the other units get an empty plate
 * that the admin fills in the fleet manager.
 */

/** Booking statuses that hold a physical car. "pending" is included so a fresh request already has a car. */
export const UNIT_HOLDING_STATUSES = HOLDING_STATUSES;

type VehicleLike = {
  _id: mongoose.Types.ObjectId | string;
  licensePlate?: string;
  totalUnits?: number;
  mileage?: number;
  lastVidangeMileage?: number;
  vidangeInterval?: number;
  nextVidangeMileage?: number;
  technicalInspectionDate?: Date;
  insuranceInfo?: { expiryDate?: Date };
  location?: mongoose.Types.ObjectId;
  color?: string;
  units?: IVehicleUnit[];
};

export function unitLabel(u: { licensePlate?: string } | null | undefined, index?: number): string {
  if (u?.licensePlate) return u.licensePlate;
  return index !== undefined ? `Unité ${index + 1} (immat. à saisir)` : "Immat. à saisir";
}

/** Builds the default units for a legacy vehicle (not persisted). */
export function legacyUnits(v: VehicleLike): Omit<IVehicleUnit, "_id">[] {
  const count = Math.max(1, Number(v.totalUnits) || 1);
  const interval = Number(v.vidangeInterval || 10000);
  const mileage = Number(v.mileage || 0);
  // No vidange ever recorded (last = 0) on a car that already has mileage: the history is unknown,
  // so the cycle starts at the current odometer instead of raising a false "overdue" alert.
  const hasHistory = Number(v.lastVidangeMileage || 0) > 0;
  const last = hasHistory ? Number(v.lastVidangeMileage) : mileage;
  const next = hasHistory ? Number(v.nextVidangeMileage || last + interval) : mileage + interval;
  return Array.from({ length: count }, (_, i) => ({
    licensePlate: i === 0 ? String(v.licensePlate || "").toUpperCase() : "",
    status: "active" as const,
    mileage: i === 0 ? mileage : 0,
    lastVidangeMileage: i === 0 ? last : 0,
    vidangeInterval: interval,
    nextVidangeMileage: i === 0 ? next : interval,
    technicalInspectionDate: i === 0 ? v.technicalInspectionDate : undefined,
    insuranceExpiryDate: i === 0 ? v.insuranceInfo?.expiryDate : undefined,
    location: v.location,
    color: v.color || "",
    notes: "",
  }));
}

/** Persists default units on legacy vehicles. Returns the units of the vehicle. */
export async function ensureUnits(vehicleId: string | mongoose.Types.ObjectId): Promise<IVehicleUnit[]> {
  await connectDB();
  const v = await Vehicle.findById(vehicleId).lean<VehicleLike>();
  if (!v) return [];
  if (v.units && v.units.length > 0) return v.units;
  const units = legacyUnits(v);
  const updated = await Vehicle.findOneAndUpdate(
    { _id: v._id, $or: [{ units: { $exists: false } }, { units: { $size: 0 } }] },
    { $set: { units } },
    { returnDocument: "after" }
  ).lean<VehicleLike>();
  if (updated?.units?.length) return updated.units;
  // Another request migrated it concurrently.
  const fresh = await Vehicle.findById(vehicleId).select("units").lean<VehicleLike>();
  return fresh?.units || [];
}

/** Migrates every legacy vehicle (used by the garage / fleet screens). */
export async function ensureAllUnits(): Promise<void> {
  await connectDB();
  const legacy = await Vehicle.find({
    status: { $ne: "archived" },
    $or: [{ units: { $exists: false } }, { units: { $size: 0 } }],
  })
    .select("_id")
    .lean();
  for (const v of legacy) await ensureUnits(v._id);
}

/** Number of rentable physical cars (used for stock). */
export function rentableUnitCount(v: VehicleLike): number {
  if (v.units && v.units.length > 0) return v.units.filter((u) => u.status === "active").length;
  return Math.max(1, Number(v.totalUnits) || 1);
}

/** Unit ids already held by overlapping bookings of this model. */
async function busyUnitIds(
  vehicleId: string,
  pickupDate: Date,
  returnDate: Date,
  excludeBookingId?: string
): Promise<Set<string>> {
  // Same overlap rules as the stock engine (overdue rentals keep their car until returned).
  const query = overlapFilter(pickupDate, returnDate, excludeBookingId);
  query["assignedUnits.vehicleId"] = new mongoose.Types.ObjectId(vehicleId);
  const overlapping = (
    await Booking.find(query).select("assignedUnits pickupDate returnDate bookingStatus").lean()
  ).filter((b) => reallyOverlaps(b, pickupDate, returnDate));
  const busy = new Set<string>();
  for (const b of overlapping) {
    for (const a of b.assignedUnits || []) {
      if (String(a.vehicleId) === String(vehicleId) && a.unitId) busy.add(String(a.unitId));
    }
  }
  return busy;
}

export interface UnitAvailability {
  unitId: string;
  licensePlate: string;
  label: string;
  status: string;
  mileage: number;
  free: boolean;
}

/** Lists every unit of a model with its availability for a window (for the admin picker). */
export async function listUnitAvailability(
  vehicleId: string,
  pickupDate: Date,
  returnDate: Date,
  excludeBookingId?: string
): Promise<UnitAvailability[]> {
  const units = await ensureUnits(vehicleId);
  const busy = await busyUnitIds(vehicleId, pickupDate, returnDate, excludeBookingId);
  return units.map((u, i) => ({
    unitId: String(u._id),
    licensePlate: u.licensePlate || "",
    label: unitLabel(u, i),
    status: u.status,
    mileage: u.mileage || 0,
    free: u.status === "active" && !busy.has(String(u._id)),
  }));
}

/**
 * Picks a free physical car of the model for the window. Preference: active, free, lowest mileage
 * (spreads wear across the fleet). Returns null when every car is taken.
 */
export async function pickFreeUnit(
  vehicleId: string,
  pickupDate: Date,
  returnDate: Date,
  excludeBookingId?: string
): Promise<IVehicleUnit | null> {
  const units = await ensureUnits(vehicleId);
  const busy = await busyUnitIds(vehicleId, pickupDate, returnDate, excludeBookingId);
  const candidates = units
    .filter((u) => u.status === "active" && !busy.has(String(u._id)))
    .sort((a, b) => (a.mileage || 0) - (b.mileage || 0));
  return candidates[0] || null;
}

/**
 * Auto-assigns a physical car to every booked model of a booking that has none yet.
 * Safe to call repeatedly (idempotent). Returns the resulting assignments.
 */
export async function autoAssignUnits(bookingId: string): Promise<
  { vehicleId: string; unitId?: string; licensePlate: string }[]
> {
  await connectDB();
  const booking = await Booking.findById(bookingId);
  if (!booking) return [];

  const modelIds: string[] =
    booking.vehicles && booking.vehicles.length > 0
      ? booking.vehicles.map((v) => String(v.vehicleId))
      : [String(booking.vehicleId)];

  const current = [...(booking.assignedUnits || [])];
  const taken = new Set(current.map((a) => String(a.unitId || "")));
  let changed = false;

  // One assignment per booked car (a booking may contain the same model twice).
  const neededPerModel = new Map<string, number>();
  modelIds.forEach((id) => neededPerModel.set(id, (neededPerModel.get(id) || 0) + 1));

  for (const [modelId, needed] of neededPerModel) {
    const have = current.filter((a) => String(a.vehicleId) === modelId).length;
    for (let i = have; i < needed; i++) {
      const units = await ensureUnits(modelId);
      const busy = await busyUnitIds(modelId, booking.pickupDate, booking.returnDate, bookingId);
      const unit = units
        .filter((u) => u.status === "active" && !busy.has(String(u._id)) && !taken.has(String(u._id)))
        .sort((a, b) => (a.mileage || 0) - (b.mileage || 0))[0];
      if (!unit) break;
      taken.add(String(unit._id));
      current.push({
        vehicleId: new mongoose.Types.ObjectId(modelId),
        unitId: unit._id,
        licensePlate: unit.licensePlate || "",
        auto: true,
        assignedAt: new Date(),
      });
      changed = true;
    }
  }

  if (changed) {
    booking.assignedUnits = current;
    await booking.save();
  }
  return current.map((a) => ({
    vehicleId: String(a.vehicleId),
    unitId: a.unitId ? String(a.unitId) : undefined,
    licensePlate: a.licensePlate,
  }));
}

/**
 * After a date change: keeps assignments that are still free, drops the conflicting ones
 * and auto-assigns replacements. Returns the plates that had to be changed.
 */
export async function revalidateAssignments(bookingId: string): Promise<string[]> {
  await connectDB();
  const booking = await Booking.findById(bookingId);
  if (!booking) return [];
  const kept = [];
  const dropped: string[] = [];
  for (const a of booking.assignedUnits || []) {
    if (!a.unitId) continue;
    const busy = await busyUnitIds(String(a.vehicleId), booking.pickupDate, booking.returnDate, bookingId);
    if (busy.has(String(a.unitId))) dropped.push(a.licensePlate);
    else kept.push(a);
  }
  if (dropped.length > 0) {
    booking.assignedUnits = kept;
    await booking.save();
  }
  await autoAssignUnits(bookingId);
  return dropped;
}

/** Manually assigns a given physical car to a booking (admin choice). */
export async function assignUnitManually(
  bookingId: string,
  vehicleId: string,
  unitId: string,
  by: string,
  index = 0
): Promise<{ ok: true; licensePlate: string } | { ok: false; error: string }> {
  await connectDB();
  const booking = await Booking.findById(bookingId);
  if (!booking) return { ok: false, error: "Réservation introuvable" };
  const units = await ensureUnits(vehicleId);
  const unit = units.find((u) => String(u._id) === unitId);
  if (!unit) return { ok: false, error: "Véhicule (immatriculation) introuvable" };
  if (unit.status !== "active") return { ok: false, error: "Ce véhicule est en maintenance ou hors service" };
  const busy = await busyUnitIds(vehicleId, booking.pickupDate, booking.returnDate, bookingId);
  if (busy.has(unitId)) {
    return { ok: false, error: `${unit.licensePlate || "Ce véhicule"} est déjà affecté à une autre réservation sur ces dates` };
  }
  const list = [...(booking.assignedUnits || [])];
  const sameModel = list
    .map((a, i) => ({ a, i }))
    .filter(({ a }) => String(a.vehicleId) === vehicleId);
  const entry = {
    vehicleId: new mongoose.Types.ObjectId(vehicleId),
    unitId: unit._id,
    licensePlate: unit.licensePlate || "",
    auto: false,
    assignedAt: new Date(),
    assignedBy: by,
  };
  if (sameModel[index]) list[sameModel[index].i] = entry;
  else list.push(entry);
  booking.assignedUnits = list;
  booking.auditHistory.push({
    action: "Véhicule affecté manuellement",
    performedBy: by,
    performedByRole: "staff",
    timestamp: new Date(),
    notes: `Immatriculation affectée : ${unit.licensePlate || "(sans immatriculation)"}`,
  });
  await booking.save();
  return { ok: true, licensePlate: unit.licensePlate || "" };
}
