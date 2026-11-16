import mongoose from "mongoose";
import connectDB from "./db";
import Vehicle, { type IVehicleUnit } from "@/models/Vehicle";
import Booking from "@/models/Booking";
import UnitHold from "@/models/UnitHold";
import AgencySetting from "@/models/AgencySetting";
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

/* ───────────────────────── Atomic per-day holds ───────────────────────── */

/** Calendar days (UTC) a booking occupies: pickup day … day before the return day (min. one day). */
export function holdDays(pickup: Date | string, ret: Date | string): string[] {
  const p = new Date(pickup);
  const r = new Date(ret);
  const start = Date.UTC(p.getUTCFullYear(), p.getUTCMonth(), p.getUTCDate());
  const end = Date.UTC(r.getUTCFullYear(), r.getUTCMonth(), r.getUTCDate());
  const days: string[] = [];
  for (let t = start; t < end && days.length < 800; t += 86_400_000) days.push(new Date(t).toISOString().slice(0, 10));
  if (days.length === 0) days.push(new Date(start).toISOString().slice(0, 10));
  return days;
}

/**
 * Atomically reserves a physical car for a booking on the given days.
 * Returns false (and leaves nothing behind) when any day is already held by another booking.
 */
async function claimUnit(bookingId: string, vehicleId: string, unitId: string, days: string[]): Promise<boolean> {
  const bId = new mongoose.Types.ObjectId(bookingId);
  const uId = new mongoose.Types.ObjectId(unitId);
  const existing = await UnitHold.find({ unitId: uId, day: { $in: days } }).select("day bookingId").lean();
  if (existing.some((h) => String(h.bookingId) !== bookingId)) return false;
  const mine = new Set(existing.map((h) => h.day));
  const missing = days.filter((d) => !mine.has(d));
  if (missing.length === 0) return true;
  try {
    await UnitHold.insertMany(
      missing.map((day) => ({ unitId: uId, day, bookingId: bId, vehicleId: new mongoose.Types.ObjectId(vehicleId) })),
      { ordered: false }
    );
    return true;
  } catch {
    // Lost a race on at least one day: undo what this call inserted.
    await UnitHold.deleteMany({ bookingId: bId, unitId: uId, day: { $in: missing } });
    return false;
  }
}

/** True when the car can be held by this booking on these days (no write). */
async function unitFreeOn(bookingId: string, unitId: string, days: string[]): Promise<boolean> {
  const other = await UnitHold.exists({
    unitId: new mongoose.Types.ObjectId(unitId),
    day: { $in: days },
    bookingId: { $ne: new mongoose.Types.ObjectId(bookingId) },
  });
  return !other;
}

export interface AssignmentResult {
  assigned: { vehicleId: string; unitId?: string; licensePlate: string }[];
  /** Units this booking lost (conflict, car removed, car sent to the garage). */
  dropped: string[];
  /** Booked cars that could not get a physical car. */
  unassigned: number;
}

/**
 * THE assignment routine — call it after every booking change (create, dates, model, status, delete).
 *
 * 1. A booking that no longer holds a car (cancelled, completed, rejected) releases its days.
 * 2. Assignments whose car vanished, went to the garage (before departure) or collides are dropped.
 * 3. Days are (re)claimed atomically; missing cars are auto-assigned (free car, lowest mileage).
 *
 * Each booking ends with at most one physical car per booked car, and a physical car is never
 * shared by two bookings on the same day. Cars without a plate are assigned like any other.
 */
export async function syncBookingAssignment(
  bookingId: string,
  opts: { skipBackfill?: boolean; holdsOnly?: boolean } = {}
): Promise<AssignmentResult> {
  await connectDB();
  if (!opts.skipBackfill) await ensureHoldsBackfilled();
  const empty: AssignmentResult = { assigned: [], dropped: [], unassigned: 0 };
  if (!mongoose.Types.ObjectId.isValid(bookingId)) return empty;
  const bId = new mongoose.Types.ObjectId(bookingId);
  const booking = await Booking.findById(bookingId);
  if (!booking) {
    await UnitHold.deleteMany({ bookingId: bId });
    return empty;
  }
  if (!(HOLDING_STATUSES as string[]).includes(booking.bookingStatus)) {
    await UnitHold.deleteMany({ bookingId: bId });
    return empty;
  }

  const days = holdDays(booking.pickupDate, booking.returnDate);
  const modelIds: string[] =
    booking.vehicles && booking.vehicles.length > 0
      ? booking.vehicles.map((v) => String(v.vehicleId))
      : [String(booking.vehicleId)];
  const needed = new Map<string, number>();
  modelIds.forEach((id) => needed.set(id, (needed.get(id) || 0) + 1));

  const started = booking.bookingStatus === "active";
  const kept: NonNullable<typeof booking.assignedUnits> = [];
  const dropped: string[] = [];
  const usedUnits = new Set<string>();
  const unitsCache = new Map<string, IVehicleUnit[]>();
  const unitsOf = async (modelId: string) => {
    if (!unitsCache.has(modelId)) unitsCache.set(modelId, await ensureUnits(modelId));
    return unitsCache.get(modelId)!;
  };

  // Release days / cars that are no longer wanted before claiming (dates shortened, model changed).
  await UnitHold.deleteMany({ bookingId: bId, day: { $nin: days } });

  for (const a of booking.assignedUnits || []) {
    const modelId = String(a.vehicleId);
    const uid = String(a.unitId || "");
    const keptForModel = kept.filter((k) => String(k.vehicleId) === modelId).length;
    const unit = uid ? (await unitsOf(modelId)).find((u) => String(u._id) === uid) : undefined;
    const valid =
      Boolean(unit) &&
      keptForModel < (needed.get(modelId) || 0) &&
      !usedUnits.has(uid) &&
      // A car already with the customer stays assigned even if flagged for the garage.
      (started || unit!.status === "active");
    let ok = false;
    if (valid) {
      // During a repair the hold table (rebuilt oldest first) is the only referee: the stored
      // assignment of a newer, conflicting booking must not evict the older one.
      const busy = opts.holdsOnly
        ? new Set<string>()
        : await busyUnitIds(modelId, booking.pickupDate, booking.returnDate, bookingId);
      ok = !busy.has(uid) && (await claimUnit(bookingId, modelId, uid, days));
    }
    if (ok) {
      usedUnits.add(uid);
      kept.push({
        vehicleId: a.vehicleId,
        unitId: a.unitId,
        licensePlate: unit!.licensePlate || "",
        auto: a.auto,
        assignedAt: a.assignedAt,
        assignedBy: a.assignedBy,
      });
    } else {
      dropped.push(a.licensePlate || unitLabel(unit));
      if (uid) await UnitHold.deleteMany({ bookingId: bId, unitId: a.unitId });
    }
  }

  let unassigned = 0;
  for (const [modelId, count] of needed) {
    let have = kept.filter((k) => String(k.vehicleId) === modelId).length;
    if (have >= count) continue;
    const units = await unitsOf(modelId);
    const busy = await busyUnitIds(modelId, booking.pickupDate, booking.returnDate, bookingId);
    const candidates = units
      .filter((u) => u.status === "active" && !busy.has(String(u._id)) && !usedUnits.has(String(u._id)))
      .sort((x, y) => (x.mileage || 0) - (y.mileage || 0));
    for (const unit of candidates) {
      if (have >= count) break;
      const uid = String(unit._id);
      if (!(await claimUnit(bookingId, modelId, uid, days))) continue;
      usedUnits.add(uid);
      kept.push({
        vehicleId: new mongoose.Types.ObjectId(modelId),
        unitId: unit._id,
        licensePlate: unit.licensePlate || "",
        auto: true,
        assignedAt: new Date(),
      });
      have++;
    }
    unassigned += count - have;
  }

  // Holds of cars this booking no longer uses.
  await UnitHold.deleteMany({
    bookingId: bId,
    unitId: { $nin: kept.map((k) => k.unitId).filter((x): x is mongoose.Types.ObjectId => Boolean(x)) },
  });

  await Booking.updateOne({ _id: bId }, { $set: { assignedUnits: kept } });
  return {
    assigned: kept.map((a) => ({ vehicleId: String(a.vehicleId), unitId: a.unitId ? String(a.unitId) : undefined, licensePlate: a.licensePlate })),
    dropped,
    unassigned,
  };
}

/** Back-compat names used across the API. */
export async function autoAssignUnits(bookingId: string) {
  return (await syncBookingAssignment(bookingId)).assigned;
}
export async function revalidateAssignments(bookingId: string): Promise<string[]> {
  return (await syncBookingAssignment(bookingId)).dropped;
}

/** Releases every day held by a booking (booking deleted). */
export async function releaseBooking(bookingId: string): Promise<void> {
  if (mongoose.Types.ObjectId.isValid(bookingId)) {
    await connectDB();
    await UnitHold.deleteMany({ bookingId: new mongoose.Types.ObjectId(bookingId) });
  }
}

/**
 * Can this booking keep its physical car(s) until `newReturn`? (extension check)
 * Looks at the per-day holds and at bookings assigned to the same car.
 */
export async function canKeepUnitsUntil(bookingId: string, newReturn: Date): Promise<{ ok: boolean; blockedBy?: string }> {
  await connectDB();
  await ensureHoldsBackfilled();
  const booking = await Booking.findById(bookingId).select("pickupDate returnDate assignedUnits vehicleId vehicles").lean();
  if (!booking) return { ok: false };
  const extraDays = holdDays(booking.returnDate, newReturn);
  for (const a of booking.assignedUnits || []) {
    if (!a.unitId) continue;
    const uid = String(a.unitId);
    const busy = await busyUnitIds(String(a.vehicleId), booking.returnDate, newReturn, bookingId);
    if (busy.has(uid) || !(await unitFreeOn(bookingId, uid, extraDays))) {
      const hold = await UnitHold.findOne({ unitId: a.unitId, day: { $in: extraDays }, bookingId: { $ne: booking._id } }).select("bookingId").lean();
      const other = hold ? await Booking.findById(hold.bookingId).select("bookingReference").lean() : null;
      return { ok: false, blockedBy: other?.bookingReference };
    }
  }
  return { ok: true };
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
  await ensureHoldsBackfilled();
  const booking = await Booking.findById(bookingId);
  if (!booking) return { ok: false, error: "Réservation introuvable" };
  const units = await ensureUnits(vehicleId);
  const unit = units.find((u) => String(u._id) === unitId);
  if (!unit) return { ok: false, error: "Véhicule introuvable" };
  if (unit.status !== "active") return { ok: false, error: "Ce véhicule est en maintenance ou hors service" };
  const taken = `${unitLabel(unit)} est déjà affecté à une autre réservation sur ces dates`;
  const busy = await busyUnitIds(vehicleId, booking.pickupDate, booking.returnDate, bookingId);
  if (busy.has(unitId)) return { ok: false, error: taken };
  // The database decides: the claim fails if another booking holds this car on any day.
  if (!(await claimUnit(bookingId, vehicleId, unitId, holdDays(booking.pickupDate, booking.returnDate)))) {
    return { ok: false, error: taken };
  }
  const list = [...(booking.assignedUnits || [])].filter((a) => String(a.unitId || "") !== unitId);
  const sameModel = list.map((a, i) => ({ a, i })).filter(({ a }) => String(a.vehicleId) === vehicleId);
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
    notes: `Véhicule affecté : ${unitLabel(unit)}`,
  });
  await booking.save();
  await syncBookingAssignment(bookingId); // releases the previous car's days
  return { ok: true, licensePlate: unit.licensePlate || "" };
}

/* ───────────────────────── Integrity audit & repair ───────────────────────── */

export interface IntegrityReport {
  bookingsChecked: number;
  /** Same physical car given to several overlapping bookings. */
  conflicts: { unit: string; bookings: string[] }[];
  /** Bookings pointing to a car that no longer exists. */
  orphanAssignments: string[];
  /** Holding bookings with fewer cars than booked. */
  unassigned: string[];
  fixed?: { reassigned: string[]; stillUnassigned: string[] };
}

async function holdingBookings() {
  return Booking.find({ bookingStatus: { $in: HOLDING_STATUSES } })
    .select("bookingReference pickupDate returnDate bookingStatus assignedUnits vehicleId vehicles createdAt")
    .sort({ createdAt: 1 })
    .lean();
}

/** Read-only audit of physical car assignments. */
export async function auditAssignments(): Promise<IntegrityReport> {
  await connectDB();
  const bookings = await holdingBookings();
  const vehicles = await Vehicle.find({}).select("brand model units._id units.licensePlate").lean();
  const unitName = new Map<string, string>();
  for (const v of vehicles) (v.units || []).forEach((u, i) => unitName.set(String(u._id), `${v.brand} ${v.model} — ${unitLabel(u, i)}`));

  const byUnit = new Map<string, typeof bookings>();
  const orphanAssignments: string[] = [];
  const unassigned: string[] = [];
  for (const b of bookings) {
    const wanted = b.vehicles?.length || 1;
    const got = (b.assignedUnits || []).filter((a) => a.unitId);
    if (got.length < wanted) unassigned.push(b.bookingReference);
    for (const a of got) {
      const uid = String(a.unitId);
      if (!unitName.has(uid)) orphanAssignments.push(b.bookingReference);
      byUnit.set(uid, [...(byUnit.get(uid) || []), b]);
    }
  }
  const conflicts: IntegrityReport["conflicts"] = [];
  for (const [uid, list] of byUnit) {
    const clash = new Set<string>();
    for (let i = 0; i < list.length; i++)
      for (let j = i + 1; j < list.length; j++) {
        const A = new Set(holdDays(list[i].pickupDate, list[i].returnDate));
        if (holdDays(list[j].pickupDate, list[j].returnDate).some((d) => A.has(d))) {
          clash.add(list[i].bookingReference);
          clash.add(list[j].bookingReference);
        }
      }
    if (clash.size) conflicts.push({ unit: unitName.get(uid) || uid, bookings: [...clash] });
  }
  return { bookingsChecked: bookings.length, conflicts, orphanAssignments: [...new Set(orphanAssignments)], unassigned };
}

/**
 * Repairs assignments: bookings are replayed oldest first, so the first booking keeps its car and
 * later conflicting bookings receive another free car of the same model.
 */
export async function repairAssignments(): Promise<IntegrityReport> {
  await connectDB();
  const before = await auditAssignments();
  // Rebuild the hold table from scratch: stale rows (deleted bookings…) disappear.
  await UnitHold.deleteMany({});
  const bookings = await holdingBookings();
  // Started rentals first (the customer physically has the car), then by creation date.
  bookings.sort((a, b) => Number(b.bookingStatus === "active") - Number(a.bookingStatus === "active"));
  const reassigned: string[] = [];
  const stillUnassigned: string[] = [];
  for (const b of bookings) {
    const res = await syncBookingAssignment(String(b._id), { skipBackfill: true, holdsOnly: true });
    if (res.dropped.length) reassigned.push(b.bookingReference);
    if (res.unassigned > 0) stillUnassigned.push(b.bookingReference);
  }
  return { ...before, fixed: { reassigned, stillUnassigned } };
}

let backfill: Promise<void> | null = null;
/** One-time migration: builds the per-day holds for existing bookings and fixes legacy conflicts. */
export function ensureHoldsBackfilled(): Promise<void> {
  if (!backfill) {
    backfill = (async () => {
      await connectDB();
      await UnitHold.init(); // unique index must exist before the first claim
      const done = await AgencySetting.findOne({ key: "unitHoldsVersion" }).lean();
      if (done) return;
      const report = await repairAssignments();
      await AgencySetting.updateOne(
        { key: "unitHoldsVersion" },
        { $set: { value: { version: 1, at: new Date(), report }, group: "system", label: "Affectation véhicules (migration)", type: "json" } },
        { upsert: true }
      );
    })().catch((err) => {
      backfill = null;
      console.error("Unit holds backfill failed:", err);
    });
  }
  return backfill;
}

/**
 * A car left the rentable fleet (garage, out of service, deleted): future bookings holding it are
 * moved to another free car. Returns the references that could not be re-assigned.
 */
export async function reassignBookingsOfUnit(unitId: string): Promise<{ moved: string[]; unassigned: string[] }> {
  await connectDB();
  const moved: string[] = [];
  const unassigned: string[] = [];
  if (!mongoose.Types.ObjectId.isValid(unitId)) return { moved, unassigned };
  const bookings = await Booking.find({
    bookingStatus: { $in: HOLDING_STATUSES },
    "assignedUnits.unitId": new mongoose.Types.ObjectId(unitId),
  })
    .select("bookingReference")
    .lean();
  for (const b of bookings) {
    const res = await syncBookingAssignment(String(b._id));
    if (res.dropped.length) moved.push(b.bookingReference);
    if (res.unassigned > 0) unassigned.push(b.bookingReference);
  }
  return { moved, unassigned };
}
