import mongoose from "mongoose";
import connectDB from "./db";
import Vehicle from "@/models/Vehicle";
import type { IBooking } from "@/models/Booking";
import { computeRentalDays, extraLineTotal, onlySelected } from "./extras";
import { calculateSeasonalRentalTotal, minDaysFor } from "./seasonalPricing";
import { getRentalRules, priceSource } from "./rentalRules";

export interface DatesQuote {
  days: number;
  subtotal: number;
  extrasTotal: number;
  contribution: number;
  total: number;
  lines: { vehicleId: string; dailyRate: number; subtotal: number }[];
  /** Set when a car of the booking requires more days for these dates. */
  minError?: string;
}

const iso = (d: Date | string) => new Date(d).toISOString().slice(0, 10);

/**
 * Price of a booking on new dates, with the SAME rules as a new booking: each car at its model's
 * rate for the pickup-day period (and degressive tariff), the minimum duration of the model and of
 * its period, per-day options and contribution scaled, every fixed fee kept.
 */
export async function quoteBookingDates(booking: IBooking, pickup: Date, ret: Date): Promise<DatesQuote> {
  await connectDB();
  const days = computeRentalDays(pickup, ret);
  const ids =
    booking.vehicles && booking.vehicles.length > 0
      ? booking.vehicles.map((v) => String((v.vehicleId as unknown as { _id?: unknown })?._id || v.vehicleId))
      : [String((booking.vehicleId as unknown as { _id?: unknown })?._id || booking.vehicleId)];
  const models = await Vehicle.find({ _id: { $in: ids.filter((x) => mongoose.Types.ObjectId.isValid(x)) } }).lean();
  const rules = await getRentalRules();
  const pb = booking.pricingBreakdown;
  let minError: string | undefined;
  const lines = ids.map((id) => {
    const m = models.find((x) => String(x._id) === id);
    if (!m) return { vehicleId: id, dailyRate: pb.dailyRate || 0, subtotal: (pb.dailyRate || 0) * days };
    const src = priceSource(m, rules);
    const q = calculateSeasonalRentalTotal(src, iso(pickup), iso(ret));
    const min = Math.max(rules.minRentalDaysGlobal, minDaysFor(src, iso(pickup)));
    if (days < min && !minError) {
      minError = `Le véhicule ${m.brand} ${m.model} exige une durée minimum de location de ${min} jour${min > 1 ? "s" : ""} pour ces dates (durée demandée : ${days} jour${days > 1 ? "s" : ""}).`;
    }
    return { vehicleId: id, dailyRate: q.averageDailyRate, subtotal: q.subtotal };
  });
  const subtotal = lines.reduce((a, l) => a + l.subtotal, 0);
  const extrasTotal = onlySelected(booking.extras).reduce((acc, ex) => acc + extraLineTotal(ex.price || 0, ex.quantity || 1, days, ex.pricingType), 0);
  const oldDays = pb.rentalDays || booking.rentalDuration || 1;
  const contribution = oldDays > 0 ? Math.round((pb.contributionLF2026 || 0) / oldDays) * days : 0;
  // Every fixed fee of the booking is kept (the out-of-town return fee used to be dropped here).
  const fees = (pb.timbreFiscal ?? 100) + (pb.pickupLocationFee || 0) + (pb.returnLocationFee || 0) + (pb.differentLocationFee || 0) + (pb.outOfTownFee || 0) + (pb.taxAmount || 0);
  const total = Math.max(0, subtotal + extrasTotal + fees + contribution - (pb.discountAmount || 0));
  return { days, subtotal, extrasTotal, contribution, total, lines, minError };
}
