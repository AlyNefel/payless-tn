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
 * Fleet-wide pricing period ("Tarifs par période" → paramètres globaux). Applies to every car:
 * the base daily rate is adjusted by a percentage, and a minimum duration can be imposed for
 * rentals that START in the period. A car's own seasonal price wins over the global adjustment.
 */
export interface GlobalSeason {
  id: string;
  name: string;
  /** YYYY-MM-DD (inclusive). With `recurring`, only month and day are used, every year. */
  startDate: string;
  endDate: string;
  recurring?: boolean;
  /** -90 … +300. +20 = base price + 20 %. */
  adjustPercent: number;
  /** Minimum rental days for a rental starting in the period (0 = no specific minimum). */
  minDays?: number;
  active?: boolean;
}

/** Calendar day "YYYY-MM-DD" of a date or string — never shifted by the browser time zone. */
export function dayKey(d: Date | string | undefined | null): string {
  if (!d) return new Date().toISOString().slice(0, 10);
  if (typeof d === "string") {
    if (/^\d{4}-\d{2}-\d{2}/.test(d)) return d.slice(0, 10);
    const parsed = new Date(d);
    return isNaN(parsed.getTime()) ? new Date().toISOString().slice(0, 10) : parsed.toISOString().slice(0, 10);
  }
  return isNaN(d.getTime()) ? new Date().toISOString().slice(0, 10) : d.toISOString().slice(0, 10);
}

/** True when MM-DD `md` is inside [from, to], supporting ranges that wrap over New Year. */
function monthDayInRange(md: string, from: string, to: string): boolean {
  return from <= to ? md >= from && md <= to : md >= from || md <= to;
}

/**
 * Check if a given day falls inside a seasonal rule (per-vehicle rule).
 */
export function isDateInSeason(date: Date | string, rule: SeasonalPriceRule): boolean {
  const day = dayKey(date);
  const month = Number(day.slice(5, 7));

  // Month range rule (supports wrapping around new year, e.g. Month 11 -> Month 5)
  if (rule.startMonth && rule.endMonth) {
    if (rule.startMonth <= rule.endMonth) {
      if (month >= rule.startMonth && month <= rule.endMonth) return true;
    } else if (month >= rule.startMonth || month <= rule.endMonth) return true;
  }

  // Exact date range rule (YYYY-MM-DD, or MM-DD repeated every year)
  if (rule.startDate && rule.endDate) {
    if (rule.startDate.length === 5 && rule.endDate.length === 5) {
      if (monthDayInRange(day.slice(5), rule.startDate, rule.endDate)) return true;
    } else if (rule.startDate.length >= 10 && rule.endDate.length >= 10) {
      if (day >= rule.startDate.slice(0, 10) && day <= rule.endDate.slice(0, 10)) return true;
    }
  }

  return false;
}

/** The active fleet-wide period containing this day (first match), if any. */
export function matchGlobalSeason(date: Date | string | undefined, seasons: GlobalSeason[] | undefined | null): GlobalSeason | null {
  if (!seasons || seasons.length === 0) return null;
  const day = dayKey(date);
  for (const s of seasons) {
    if (s.active === false || !s.startDate || !s.endDate) continue;
    const inRange = s.recurring
      ? monthDayInRange(day.slice(5), s.startDate.slice(5, 10), s.endDate.slice(5, 10))
      : day >= s.startDate.slice(0, 10) && day <= s.endDate.slice(0, 10);
    if (inRange) return s;
  }
  return null;
}

/**
 * Minimum rental days for a vehicle when the rental starts on `pickupDate`:
 * max(fleet-wide minimum / vehicle minimum — already merged in `minRentalDays` by the API —,
 * minimum of the fleet-wide period containing the pickup day).
 */
export function minDaysFor(vehicle: any, pickupDate?: Date | string): number {
  const own = Number(vehicle?.minRentalDays || vehicle?.pricing?.minRentalDays || 1) || 1;
  const season = matchGlobalSeason(pickupDate, vehicle?.pricing?.globalSeasons);
  return Math.max(1, own, Number(season?.minDays || 0));
}

/** Per-vehicle rule or fleet-wide period that sets the price on this day (for display). */
export function pricingPeriodName(vehicle: any, date?: Date | string): string {
  const seasons: SeasonalPriceRule[] = vehicle?.pricing?.seasonalPrices || [];
  const own = seasons.find((s) => isDateInSeason(dayKey(date), s));
  if (own && own.dailyRate > 0) return own.name || "";
  return matchGlobalSeason(date, vehicle?.pricing?.globalSeasons)?.name || "";
}

/**
 * Computes the effective daily rate for a vehicle on a specific date (or today if omitted).
 * Order: the vehicle's own seasonal price, else the fleet-wide period adjustment, else the base.
 */
export function getVehicleEffectiveDailyRate(vehicle: any, dateOrStr?: Date | string): number {
  if (!vehicle || !vehicle.pricing) return 0;
  const baseRate = vehicle.pricing.daily || 0;
  const seasons: SeasonalPriceRule[] = vehicle.pricing.seasonalPrices || [];
  const day = dayKey(dateOrStr);

  const matched = seasons.find((s) => isDateInSeason(day, s));
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

  const global = matchGlobalSeason(day, vehicle.pricing.globalSeasons);
  if (global && Number.isFinite(global.adjustPercent) && global.adjustPercent !== 0) {
    const pct = Math.max(-90, Math.min(300, global.adjustPercent));
    // Rounded to a whole dinar (100 minor units) so the customer never sees 91,20 DT/day.
    const unit = baseRate >= 1000 ? 100 : 1;
    return Math.max(unit, Math.round((baseRate * (1 + pct / 100)) / unit) * unit);
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

  const start = dayKey(pickupDate);
  const days = computeRentalDays(pickupDate, returnDate);

  const lockedDailyRate = getVehicleEffectiveDailyRate(vehicle, start);
  const subtotal = lockedDailyRate * days;

  return { subtotal, averageDailyRate: lockedDailyRate, days };
}
