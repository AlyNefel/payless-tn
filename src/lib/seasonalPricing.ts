import { computeRentalDays } from "./extras";

export interface SeasonalPriceRule {
  name?: string;
  startDate?: string;
  endDate?: string;
  startMonth?: number; // 1 to 12 (1 = Jan, 11 = Nov, etc.)
  endMonth?: number;   // 1 to 12 (5 = May, etc.)
  dailyRate: number;   // in millimes/cents (or DT if stored normalized)
  discountPercent?: number; // discount applied during this period (0-100)
}

/**
 * Check if a given Date falls inside a seasonal rule
 */
export function isDateInSeason(date: Date, rule: SeasonalPriceRule): boolean {
  const month = date.getMonth() + 1; // 1 to 12

  // Month range rule (supports wrapping around new year, e.g. Month 11 -> Month 5)
  if (rule.startMonth && rule.endMonth) {
    if (rule.startMonth <= rule.endMonth) {
      if (month >= rule.startMonth && month <= rule.endMonth) return true;
    } else {
      // Wraps around new year (e.g., Nov to May: 11, 12, 1, 2, 3, 4, 5)
      if (month >= rule.startMonth || month <= rule.endMonth) return true;
    }
  }

  // Exact date range rule (YYYY-MM-DD or MM-DD)
  if (rule.startDate && rule.endDate) {
    const y = date.getFullYear();
    const sStr = rule.startDate.length === 5 ? `${y}-${rule.startDate}` : rule.startDate;
    const eStr = rule.endDate.length === 5 ? `${y}-${rule.endDate}` : rule.endDate;
    const sDate = new Date(sStr);
    const eDate = new Date(eStr);
    if (!isNaN(sDate.getTime()) && !isNaN(eDate.getTime())) {
      if (date >= sDate && date <= eDate) return true;
    }
  }

  return false;
}

/**
 * Computes the effective daily rate for a vehicle on a specific date (or today if omitted)
 */
export function getVehicleEffectiveDailyRate(vehicle: any, dateOrStr?: Date | string): number {
  if (!vehicle || !vehicle.pricing) return 0;
  const baseRate = vehicle.pricing.daily || 0;
  const seasons: SeasonalPriceRule[] = vehicle.pricing.seasonalPrices || [];

  if (!seasons.length) return baseRate;

  const targetDate = dateOrStr
    ? typeof dateOrStr === "string"
      ? new Date(dateOrStr)
      : dateOrStr
    : new Date();

  // Find first matching rule
  const matched = seasons.find((s) => isDateInSeason(targetDate, s));
  if (matched && matched.dailyRate > 0) {
    // If seasonal daily rate is stored in DT (e.g. 90) but base is in millimes (e.g. 9000), normalize
    let seasonalRate = matched.dailyRate;
    if (baseRate >= 1000 && seasonalRate < 1000) {
      seasonalRate = seasonalRate * 100; // convert DT to cents
    }
    const discount = matched.discountPercent || 0;
    if (discount > 0 && discount < 100) {
      return Math.round(seasonalRate * (1 - discount / 100));
    }
    return seasonalRate;
  }

  return baseRate;
}

/**
 * Computes the total rental subtotal.
 *
 * Price guarantee: the daily rate in force on the PICKUP day is locked for the
 * whole rental. A rental that starts in one pricing period and ends in another
 * (e.g. starts in low season, ends in high season) keeps the first period's
 * price for every day, so the customer is never charged a different rate than
 * the one shown when they booked.
 */
export function calculateSeasonalRentalTotal(
  vehicle: any,
  pickupDate: string,
  returnDate: string
): { subtotal: number; averageDailyRate: number; days: number } {
  if (!vehicle || !pickupDate || !returnDate) {
    return { subtotal: 0, averageDailyRate: 0, days: 1 };
  }

  const start = new Date(pickupDate);
  const days = computeRentalDays(pickupDate, returnDate);

  const lockedDailyRate = getVehicleEffectiveDailyRate(vehicle, start);
  const subtotal = lockedDailyRate * days;

  return { subtotal, averageDailyRate: lockedDailyRate, days };
}
