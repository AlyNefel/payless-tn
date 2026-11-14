/**
 * Shared (client + server) helpers for rental options ("extras") and rental duration.
 *
 * The client summary and the server invoice MUST use these same functions,
 * otherwise the total shown to the customer drifts from the amount actually invoiced.
 */

export type ExtraPricingType = "per_day" | "per_rental" | "per_unit";

/**
 * Normalizes legacy/unknown values. Historical data uses "fixed" (not in the schema enum)
 * for one-off fees; the server always billed anything that is not "per_day" once per rental.
 */
export function normalizePricingType(value: unknown): ExtraPricingType {
  if (value === "per_day") return "per_day";
  if (value === "per_unit") return "per_unit";
  return "per_rental";
}

export function isPerDayPricing(value: unknown): boolean {
  return normalizePricingType(value) === "per_day";
}

/** Line total in minor units (millimes ×10 / centimes). */
export function extraLineTotal(
  unitPrice: number,
  quantity: number,
  rentalDays: number,
  pricingType: unknown
): number {
  const qty = Math.max(0, Math.floor(quantity || 0));
  const price = Math.max(0, Number(unitPrice) || 0);
  const days = Math.max(1, Math.floor(rentalDays || 1));
  return isPerDayPricing(pricingType) ? price * qty * days : price * qty;
}

/**
 * Billed rental days. Calendar-day difference between pickup and return dates (min. 1),
 * which is exactly what the server has always invoiced.
 */
export function computeRentalDays(pickupDate: string | Date, returnDate: string | Date): number {
  const toUtcMidnight = (d: string | Date) => {
    if (typeof d === "string") {
      const [y, m, day] = d.slice(0, 10).split("-").map(Number);
      return Date.UTC(y, (m || 1) - 1, day || 1);
    }
    return Date.UTC(d.getUTCFullYear(), d.getUTCMonth(), d.getUTCDate());
  };
  const diff = Math.round((toUtcMidnight(returnDate) - toUtcMidnight(pickupDate)) / 86_400_000);
  return Math.max(1, diff);
}

export interface SelectedExtraLike {
  quantity?: number;
}

/** Keep only options the customer actually selected (quantity ≥ 1). */
export function onlySelected<T extends SelectedExtraLike>(extras: T[] | undefined | null): T[] {
  return (extras || []).filter((e) => (e?.quantity ?? 0) > 0);
}
