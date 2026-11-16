import mongoose from "mongoose";

/**
 * Booking statuses that hold a car. "pending" is included: a request that is waiting for the agency
 * must not be sold a second time.
 */
export const HOLDING_STATUSES: ("pending" | "confirmed" | "awaiting_payment" | "paid" | "active")[] = [
  "pending",
  "confirmed",
  "awaiting_payment",
  "paid",
  "active",
];

/** End of the current day: an overdue rental ("active", return date passed) still holds its car today. */
export function endOfToday(): Date {
  const d = new Date();
  d.setHours(23, 59, 59, 999);
  return d;
}

/** Effective end of a booking: an overdue active rental is extended to the end of today. */
export function effectiveReturn(b: { bookingStatus?: string; returnDate: Date | string }): Date {
  const r = new Date(b.returnDate);
  if (b.bookingStatus === "active") {
    const eod = endOfToday();
    if (r < eod) return eod;
  }
  return r;
}

/**
 * Mongo filter for bookings that may overlap [pickup, return).
 * Overdue active rentals are fetched too (refined in JS with effectiveReturn).
 */
export function overlapFilter(pickup: Date, ret: Date, excludeBookingId?: string): Record<string, unknown> {
  const q: Record<string, unknown> = {
    bookingStatus: { $in: HOLDING_STATUSES },
    pickupDate: { $lt: ret },
    $or: [{ returnDate: { $gt: pickup } }, { bookingStatus: "active" }],
  };
  if (excludeBookingId && mongoose.Types.ObjectId.isValid(excludeBookingId)) {
    q._id = { $ne: new mongoose.Types.ObjectId(excludeBookingId) };
  }
  return q;
}

export function reallyOverlaps(
  b: { bookingStatus?: string; pickupDate: Date | string; returnDate: Date | string },
  pickup: Date,
  ret: Date
): boolean {
  return new Date(b.pickupDate) < ret && effectiveReturn(b) > pickup;
}

/**
 * Car models held by a booking, one entry per car. A multi-car booking lists every car
 * (the same model twice = two entries); a classic booking holds its single vehicleId.
 */
export function modelsOfBooking(b: {
  vehicleId?: unknown;
  vehicles?: { vehicleId?: unknown }[];
}): string[] {
  if (b.vehicles && b.vehicles.length > 0) {
    return b.vehicles.map((v) => String((v.vehicleId as { _id?: unknown })?._id || v.vehicleId || "")).filter(Boolean);
  }
  const id = String((b.vehicleId as { _id?: unknown })?._id || b.vehicleId || "");
  return id ? [id] : [];
}
