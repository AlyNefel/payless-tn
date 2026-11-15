import connectDB from "./db";
import Vehicle from "@/models/Vehicle";
import Location from "@/models/Location";
import Booking from "@/models/Booking";

export interface TrustStats {
  /** Rentable physical cars. */
  cars: number;
  agencies: number;
  airports: number;
  /** Completed rentals (shown only when meaningful). */
  completedRentals: number;
}

/** Homepage trust figures, computed from the real database (never hard-coded). */
export async function getTrustStats(): Promise<TrustStats> {
  try {
    await connectDB();
    const [vehicles, agencies, airports, completedRentals] = await Promise.all([
      Vehicle.find({ isActive: true, status: { $nin: ["archived", "unavailable"] } }).select("totalUnits units.status").lean(),
      Location.countDocuments({ isActive: true }),
      Location.countDocuments({ isActive: true, isAirport: true }),
      Booking.countDocuments({ bookingStatus: "completed" }),
    ]);
    const cars = vehicles.reduce(
      (n, v) => n + (v.units?.length ? v.units.filter((u) => u.status !== "out_of_service").length : Math.max(1, v.totalUnits || 1)),
      0
    );
    return { cars, agencies, airports, completedRentals };
  } catch {
    return { cars: 0, agencies: 0, airports: 0, completedRentals: 0 };
  }
}
