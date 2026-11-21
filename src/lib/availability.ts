import connectDB from "./db";
import Booking from "@/models/Booking";
import Vehicle from "@/models/Vehicle";
import mongoose from "mongoose";
import { rentableUnitCount } from "./fleetUnits";
import { HOLDING_STATUSES, assignmentOverlaps, modelsOfBooking, overlapFilter, reallyOverlaps } from "./bookingOverlap";

/** Statuses that hold a car (kept for backwards compatibility of imports). */
export const ACTIVE_STATUSES = HOLDING_STATUSES;

export interface VehicleStockInfo {
  totalUnits: number;
  bookedUnits: number;
  availableUnits: number;
  isAvailable: boolean;
}

/**
 * Single source of truth for availability — computed at PHYSICAL CAR level.
 *
 * A car is free for [pickup, return) when it is "en service" and no holding booking assigned to it
 * overlaps the window (pending, confirmed, paid, active; an overdue rental keeps its car until the
 * return is recorded). Two back-to-back bookings on the same car therefore use ONE car, not two.
 * Bookings that have no car yet (legacy data) still reserve one car of their model.
 */
async function windowUsage(
  pickupDate: Date,
  returnDate: Date,
  excludeBookingId?: string,
  onlyModelId?: string
): Promise<{ busyUnits: Set<string>; unassigned: Map<string, number> }> {
  await connectDB();
  const filter = overlapFilter(pickupDate, returnDate, excludeBookingId);
  if (onlyModelId && mongoose.Types.ObjectId.isValid(onlyModelId)) {
    const id = new mongoose.Types.ObjectId(onlyModelId);
    filter.$and = [{ $or: [{ vehicleId: id }, { "vehicles.vehicleId": id }] }];
  }
  const bookings = await Booking.find(filter)
    .select("vehicleId vehicles.vehicleId pickupDate returnDate bookingStatus assignedUnits.unitId assignedUnits.vehicleId assignedUnits.from assignedUnits.to")
    .lean();

  const busyUnits = new Set<string>();
  const unassigned = new Map<string, number>();
  for (const b of bookings) {
    if (!reallyOverlaps(b, pickupDate, returnDate)) continue;
    const perModelAssigned = new Map<string, number>();
    for (const a of b.assignedUnits || []) {
      if (!a.unitId) continue;
      // After a car change each car is busy only during its own part of the rental.
      if (assignmentOverlaps(b, a, pickupDate, returnDate)) busyUnits.add(String(a.unitId));
      if (!a.to) perModelAssigned.set(String(a.vehicleId), (perModelAssigned.get(String(a.vehicleId)) || 0) + 1);
    }
    const wanted = new Map<string, number>();
    for (const modelId of modelsOfBooking(b)) wanted.set(modelId, (wanted.get(modelId) || 0) + 1);
    for (const [modelId, n] of wanted) {
      const missing = n - (perModelAssigned.get(modelId) || 0);
      if (missing > 0) unassigned.set(modelId, (unassigned.get(modelId) || 0) + missing);
    }
  }
  return { busyUnits, unassigned };
}

type StockVehicle = { _id: unknown; totalUnits?: number; units?: { _id?: unknown; status: string }[] };

function stockFor(v: StockVehicle, usage: { busyUnits: Set<string>; unassigned: Map<string, number> }): VehicleStockInfo {
  const total = rentableUnitCount(v as never);
  const pending = usage.unassigned.get(String(v._id)) || 0;
  let free: number;
  if (v.units && v.units.length > 0) {
    free = v.units.filter((u) => u.status === "active" && !usage.busyUnits.has(String(u._id))).length - pending;
  } else {
    // Legacy model not migrated to physical cars yet.
    free = total - pending;
  }
  const availableUnits = Math.max(0, free);
  return { totalUnits: total, bookedUnits: Math.max(0, total - availableUnits), availableUnits, isAvailable: availableUnits > 0 };
}

/** Exact availability of one car model for a window. */
export async function getVehicleStockAvailability(
  vehicleId: string,
  pickupDate: Date,
  returnDate: Date,
  excludeBookingId?: string
): Promise<VehicleStockInfo> {
  await connectDB();
  const vehicle = await Vehicle.findById(vehicleId).select("totalUnits status isActive units._id units.status").lean();
  if (!vehicle || !vehicle.isActive || ["archived", "unavailable"].includes(vehicle.status)) {
    return { totalUnits: 0, bookedUnits: 0, availableUnits: 0, isAvailable: false };
  }
  return stockFor(vehicle as StockVehicle, await windowUsage(pickupDate, returnDate, excludeBookingId, vehicleId));
}

/** Boolean availability check for strict validation. */
export async function checkVehicleAvailability(
  vehicleId: string,
  pickupDate: Date,
  returnDate: Date,
  excludeBookingId?: string
): Promise<boolean> {
  return (await getVehicleStockAvailability(vehicleId, pickupDate, returnDate, excludeBookingId)).isAvailable;
}

/** Availability of every public car model for a window (one booking query for the whole fleet). */
export async function getFleetStockMap(pickupDate: Date, returnDate: Date): Promise<Record<string, VehicleStockInfo>> {
  await connectDB();
  const [vehicles, usage] = await Promise.all([
    Vehicle.find({ isActive: true, status: { $nin: ["archived", "unavailable"] } })
      .select("_id totalUnits units._id units.status")
      .lean(),
    windowUsage(pickupDate, returnDate),
  ]);
  const result: Record<string, VehicleStockInfo> = {};
  for (const v of vehicles) result[String(v._id)] = stockFor(v as StockVehicle, usage);
  return result;
}

/** Stock without a date window: cars currently rentable (no booking-based claim). */
export function stockWithoutDates(v: { totalUnits?: number; units?: { status: string }[] }): VehicleStockInfo {
  const total = rentableUnitCount(v as never);
  return { totalUnits: total, bookedUnits: 0, availableUnits: total, isAvailable: total > 0 };
}

/** IDs of models with no car left for the window. */
export async function getUnavailableVehicleIds(pickupDate: Date, returnDate: Date): Promise<string[]> {
  const stockMap = await getFleetStockMap(pickupDate, returnDate);
  return Object.keys(stockMap).filter((vId) => !stockMap[vId].isAvailable);
}

/** @deprecated kept for older imports — returns the UNAVAILABLE ids. */
export async function getAvailableVehicleIds(pickupDate: Date, returnDate: Date): Promise<string[]> {
  return getUnavailableVehicleIds(pickupDate, returnDate);
}

/** Booked date ranges of a model (calendar display). */
export async function getVehicleBookedDates(vehicleId: string): Promise<{ start: Date; end: Date; status: string }[]> {
  await connectDB();
  const id = new mongoose.Types.ObjectId(vehicleId);
  const bookings = await Booking.find({
    bookingStatus: { $in: HOLDING_STATUSES },
    $or: [{ vehicleId: id }, { "vehicles.vehicleId": id }],
    returnDate: { $gte: new Date() },
  })
    .select("pickupDate returnDate bookingStatus")
    .lean();
  return bookings.map((b) => ({ start: b.pickupDate, end: b.returnDate, status: b.bookingStatus }));
}
