import { computeRentalDays } from "./extras";

export interface SeasonalPriceRule {
  name?: string;
  startDate?: string;
  endDate?: string;
  startMonth?: number; // 1 to 12 (1 = Jan, 11 = Nov, etc.)
  endMonth?: number;   // 1 to 12 (5 = May, etc.)
  dailyRate: number;   // in millimes/cents (or DT if stored normalized)
  discountPercent?: number; // discount applied during this period (0-100)
  /** Minimum rental days for a rental starting in this period (0 = the model's minimum). */
  minDays?: number;
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

/** Fleet-wide degressive tariff: from `minDays` days of rental, `percent` % off the daily rate. */
export interface DurationDiscount {
  minDays: number;
  percent: number;
}

/** Best discount tier reached by a rental of `days` days (0 when none). */
export function durationDiscountPercent(days: number, tiers: DurationDiscount[] | undefined | null): number {
  let best = 0;
  for (const t of tiers || []) {
    if (days >= Number(t.minDays) && Number(t.percent) > best) best = Number(t.percent);
  }
  return Math.max(0, Math.min(90, best));
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
  // The model's own period (the one that sets the price) can require more days.
  const seasons: SeasonalPriceRule[] = vehicle?.pricing?.seasonalPrices || [];
  const period = pickupDate ? seasons.find((s) => isDateInSeason(dayKey(pickupDate), s)) : undefined;
  const legacy = matchGlobalSeason(pickupDate, vehicle?.pricing?.globalSeasons);
  return Math.max(1, own, Number(period?.minDays || 0), Number(legacy?.minDays || 0));
}

/** Calendar days ("MM-DD" for a yearly period, "YYYY-MM-DD" for fixed dates) covered by a rule. */
function ruleDays(rule: SeasonalPriceRule): { yearly: Set<string>; fixed: Set<string> } {
  const yearly = new Set<string>();
  const fixed = new Set<string>();
  const md = (d: Date) => d.toISOString().slice(5, 10);
  if (rule.startDate && rule.endDate && rule.startDate.length >= 10 && rule.endDate.length >= 10) {
    for (let t = Date.parse(`${rule.startDate.slice(0, 10)}T00:00:00Z`), end = Date.parse(`${rule.endDate.slice(0, 10)}T00:00:00Z`), n = 0; t <= end && n < 800; t += 86_400_000, n++) {
      fixed.add(new Date(t).toISOString().slice(0, 10));
    }
    return { yearly, fixed };
  }
  // Leap year: every MM-DD exists.
  for (let t = Date.UTC(2028, 0, 1); t < Date.UTC(2029, 0, 1); t += 86_400_000) {
    if (isDateInSeason(new Date(t), rule)) yearly.add(md(new Date(t)));
  }
  return { yearly, fixed };
}

/** Pairs of periods of one model that cover the same day (the first one would silently win). */
export function overlappingPeriods(rules: SeasonalPriceRule[]): [number, number][] {
  const days = rules.map(ruleDays);
  const out: [number, number][] = [];
  for (let i = 0; i < rules.length; i++)
    for (let j = i + 1; j < rules.length; j++) {
      const a = days[i];
      const b = days[j];
      const clash =
        [...a.yearly].some((d) => b.yearly.has(d)) ||
        [...a.fixed].some((d) => b.fixed.has(d) || b.yearly.has(d.slice(5))) ||
        [...b.fixed].some((d) => a.yearly.has(d.slice(5)));
      if (clash) out.push([i, j]);
    }
  return out;
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
 * Daily rate of a model ON `day`: the period in force that day (the model's own periods), then the
 * model's degressive tariff for a rental of `totalDays` days. Summed day by day by rentalDaysPrice.
 */
export function rateOn(vehicle: any, day: Date | string, totalDays: number): number {
  let rate = getVehicleEffectiveDailyRate(vehicle, dayKey(day));
  const pct = durationDiscountPercent(totalDays, vehicle?.pricing?.durationDiscounts);
  if (pct > 0 && rate > 0) {
    const unit = rate >= 1000 ? 100 : 1;
    rate = Math.max(unit, Math.round((rate * (1 - pct / 100)) / unit) * unit);
  }
  return rate;
}

/** "YYYY-MM-DD" + n calendar days. */
export function addDays(day: string, n: number): string {
  return new Date(Date.parse(`${dayKey(day)}T00:00:00Z`) + n * 86_400_000).toISOString().slice(0, 10);
}

/**
 * Price of the days [fromIndex, toIndex) of a rental starting on `start` (day 0 = pickup day):
 * EACH day at the rate of the period it falls in (mixed price across two periods), with the
 * model's degressive tariff for a rental of `totalDays` days.
 */
export function rentalDaysPrice(vehicle: any, start: Date | string, fromIndex: number, toIndex: number, totalDays: number): number {
  const first = dayKey(start);
  let sum = 0;
  for (let k = Math.max(0, fromIndex); k < toIndex; k++) sum += rateOn(vehicle, addDays(first, k), totalDays);
  return sum;
}

export interface PriceSegment {
  /** Period name ("" = standard rate). */
  name: string;
  /** First and last calendar day billed at this rate (inclusive). */
  from: string;
  to: string;
  days: number;
  dailyRate: number;
  amount: number;
}

/** Consecutive days billed at the same rate, for the price detail ("3 j × 100 + 2 j × 150"). */
export function priceSegments(vehicle: any, start: Date | string, days: number, totalDays = days): PriceSegment[] {
  const first = dayKey(start);
  const out: PriceSegment[] = [];
  for (let k = 0; k < days; k++) {
    const day = addDays(first, k);
    const rate = rateOn(vehicle, day, totalDays);
    const name = pricingPeriodName(vehicle, day);
    const last = out[out.length - 1];
    if (last && last.dailyRate === rate && last.name === name) {
      last.days += 1;
      last.to = day;
      last.amount += rate;
    } else out.push({ name, from: day, to: day, days: 1, dailyRate: rate, amount: rate });
  }
  return out;
}

/**
 * Computes the total rental subtotal.
 *
 * Mixed price: a rental that starts in one pricing period and ends in another is billed day by
 * day — the days in period 1 at period 1's rate, the days in period 2 at period 2's rate — with
 * the model's degressive tariff for the full duration. `averageDailyRate` = subtotal / days.
 */
export function calculateSeasonalRentalTotal(
  vehicle: any,
  pickupDate: string,
  returnDate: string
): { subtotal: number; averageDailyRate: number; days: number; discountPercent?: number; segments: PriceSegment[] } {
  if (!vehicle || !pickupDate || !returnDate) {
    return { subtotal: 0, averageDailyRate: 0, days: 1, segments: [] };
  }

  const start = dayKey(pickupDate);
  const days = computeRentalDays(pickupDate, returnDate);
  const discountPercent = durationDiscountPercent(days, vehicle.pricing?.durationDiscounts);
  const segments = priceSegments(vehicle, start, days, days);
  const subtotal = segments.reduce((a, x) => a + x.amount, 0);

  return { subtotal, averageDailyRate: days > 0 ? Math.round(subtotal / days) : 0, days, discountPercent, segments };
}
