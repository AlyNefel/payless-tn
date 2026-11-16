import connectDB from "./db";
import Booking from "@/models/Booking";
import Vehicle from "@/models/Vehicle";
import mongoose from "mongoose";
import { rentableUnitCount } from "./fleetUnits";
import { HOLDING_STATUSES, modelsOfBooking, overlapFilter, reallyOverlaps } from "./bookingOverlap";

/** Statuses that hold a car (kept for backwards compatibility of imports). */
export const ACTIVE_STATUSES = HOLDING_STATUSES;

export interface VehicleStockInfo {
  totalUnits: number;
  bookedUnits: number;
  availableUnits: number;
  isAvailable: boolean;
}

/**
 * Single source of truth for availability.
 *
 * For a window [pickup, return) it counts, per car model, how many physical cars are held by
 * overlapping bookings:
 *   - every car of a multi-car booking (the same model twice counts twice),
 *   - pending, confirmed, paid and active bookings,
 *   - overdue active rentals (return date passed, car not back yet) still hold their car today.
 * Stock = cars "en service" (cars at the garage or out of service are not rentable).
 */
export async function bookedUnitsByModel(
  pickupDate: Date,
  returnDate: Date,
  excludeBookingId?: string,
  onlyModelId?: string
): Promise<Map<string, number>> {
  await connectDB();
  const filter = overlapFilter(pickupDate, returnDate, excludeBookingId);
  if (onlyModelId && mongoose.Types.ObjectId.isValid(onlyModelId)) {
    const id = new mongoose.Types.ObjectId(onlyModelId);
    filter.$and = [{ $or: [{ vehicleId: id }, { "vehicles.vehicleId": id }] }];
  }
  const bookings = await Booking.find(filter)
    .select("vehicleId vehicles.vehicleId pickupDate returnDate bookingStatus")
    .lean();

  const counts = new Map<string, number>();
  for (const b of bookings) {
    if (!reallyOverlaps(b, pickupDate, returnDate)) continue;
    for (const modelId of modelsOfBooking(b)) {
      counts.set(modelId, (counts.get(modelId) || 0) + 1);
    }
  }
  return counts;
}

function toStock(totalUnits: number, bookedUnits: number): VehicleStockInfo {
  const availableUnits = Math.max(0, totalUnits - bookedUnits);
  return { totalUnits, bookedUnits, availableUnits, isAvailable: availableUnits > 0 };
}

/** Exact availability of one car model for a window. */
export async function getVehicleStockAvailability(
  vehicleId: string,
  pickupDate: Date,
  returnDate: Date,
  excludeBookingId?: string
): Promise<VehicleStockInfo> {
  await connectDB();
  const vehicle = await Vehicle.findById(vehicleId).select("totalUnits status isActive units.status").lean();
  if (!vehicle || !vehicle.isActive || ["archived", "unavailable"].includes(vehicle.status)) {
    return toStock(0, 0);
  }
  const booked = await bookedUnitsByModel(pickupDate, returnDate, excludeBookingId, vehicleId);
  return toStock(rentableUnitCount(vehicle as never), booked.get(String(vehicleId)) || 0);
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
  const [vehicles, booked] = await Promise.all([
    Vehicle.find({ isActive: true, status: { $nin: ["archived", "unavailable"] } })
      .select("_id totalUnits units.status")
      .lean(),
    bookedUnitsByModel(pickupDate, returnDate),
  ]);
  const result: Record<string, VehicleStockInfo> = {};
  for (const v of vehicles) {
    const id = String(v._id);
    result[id] = toStock(rentableUnitCount(v as never), booked.get(id) || 0);
  }
  return result;
}

/** Stock without a date window: cars currently rentable (no booking-based claim). */
export function stockWithoutDates(v: { totalUnits?: number; units?: { status: string }[] }): VehicleStockInfo {
  const total = rentableUnitCount(v as never);
  return toStock(total, 0);
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
