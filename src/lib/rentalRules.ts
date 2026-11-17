import connectDB from "./db";
import AgencySetting from "@/models/AgencySetting";
import { matchGlobalSeason, type DurationDiscount, type GlobalSeason } from "./seasonalPricing";

export interface RentalRules {
  minRentalDaysGlobal: number;
  seasons: GlobalSeason[];
  durationDiscounts: DurationDiscount[];
}

/** Validates the degressive tiers (sorted by duration, one tier per duration). */
export function normalizeDiscounts(input: unknown): { tiers: DurationDiscount[]; error?: string } {
  if (!Array.isArray(input)) return { tiers: [], error: "Liste de paliers invalide." };
  if (input.length > 10) return { tiers: [], error: "10 paliers maximum." };
  const tiers: DurationDiscount[] = [];
  for (const raw of input as Record<string, unknown>[]) {
    const minDays = Math.floor(Number(raw?.minDays));
    const percent = Math.round(Number(raw?.percent) * 100) / 100;
    if (!Number.isFinite(minDays) || minDays < 2 || minDays > 365) return { tiers: [], error: "Chaque palier commence entre 2 et 365 jours." };
    if (!Number.isFinite(percent) || percent <= 0 || percent > 90) return { tiers: [], error: "Remise entre 0,01 % et 90 %." };
    if (tiers.some((t) => t.minDays === minDays)) return { tiers: [], error: `Deux paliers commencent à ${minDays} jours.` };
    tiers.push({ minDays, percent });
  }
  tiers.sort((a, b) => a.minDays - b.minDays);
  for (let i = 1; i < tiers.length; i++) {
    if (tiers[i].percent < tiers[i - 1].percent) return { tiers: [], error: "Un palier plus long ne peut pas avoir une remise plus faible." };
  }
  return { tiers };
}

export async function getDurationDiscounts(): Promise<DurationDiscount[]> {
  try {
    await connectDB();
    const row = await AgencySetting.findOne({ key: "durationDiscounts" }).lean();
    return Array.isArray(row?.value) ? normalizeDiscounts(row!.value).tiers : [];
  } catch {
    return [];
  }
}

export async function setDurationDiscounts(tiers: DurationDiscount[], userId?: string): Promise<DurationDiscount[]> {
  await connectDB();
  await AgencySetting.findOneAndUpdate(
    { key: "durationDiscounts" },
    { $set: { value: tiers, group: "booking", label: "Tarifs dégressifs (tous véhicules)", type: "json", ...(userId ? { updatedBy: userId } : {}) } },
    { upsert: true }
  );
  return tiers;
}

const DAY = /^\d{4}-\d{2}-\d{2}$/;

/** Validates and normalises fleet-wide periods coming from the back office. */
export function normalizeSeasons(input: unknown): { seasons: GlobalSeason[]; error?: string } {
  if (!Array.isArray(input)) return { seasons: [], error: "Liste de périodes invalide." };
  if (input.length > 40) return { seasons: [], error: "40 périodes maximum." };
  const seasons: GlobalSeason[] = [];
  for (const raw of input as Record<string, unknown>[]) {
    const name = String(raw?.name || "").trim().slice(0, 60);
    const startDate = String(raw?.startDate || "").slice(0, 10);
    const endDate = String(raw?.endDate || "").slice(0, 10);
    const recurring = Boolean(raw?.recurring);
    const adjustPercent = Math.round(Number(raw?.adjustPercent || 0) * 100) / 100;
    const minDays = Math.floor(Number(raw?.minDays || 0));
    if (!name) return { seasons: [], error: "Chaque période doit avoir un nom." };
    if (!DAY.test(startDate) || !DAY.test(endDate)) return { seasons: [], error: `Dates invalides pour « ${name} ».` };
    if (!recurring && endDate < startDate) return { seasons: [], error: `« ${name} » : la fin est avant le début.` };
    if (!Number.isFinite(adjustPercent) || adjustPercent < -90 || adjustPercent > 300)
      return { seasons: [], error: `« ${name} » : ajustement entre -90 % et +300 %.` };
    if (!Number.isFinite(minDays) || minDays < 0 || minDays > 365) return { seasons: [], error: `« ${name} » : durée minimale entre 0 et 365 jours.` };
    seasons.push({
      id: String(raw?.id || "").slice(0, 40) || `s${Date.now().toString(36)}${seasons.length}`,
      name,
      startDate,
      endDate,
      recurring,
      adjustPercent,
      minDays,
      active: raw?.active !== false,
    });
  }
  return { seasons };
}

export async function getGlobalSeasons(): Promise<GlobalSeason[]> {
  try {
    await connectDB();
    const row = await AgencySetting.findOne({ key: "globalSeasons" }).lean();
    return Array.isArray(row?.value) ? normalizeSeasons(row!.value).seasons : [];
  } catch {
    return [];
  }
}

export async function setGlobalSeasons(seasons: GlobalSeason[], userId?: string): Promise<GlobalSeason[]> {
  await connectDB();
  await AgencySetting.findOneAndUpdate(
    { key: "globalSeasons" },
    { $set: { value: seasons, group: "booking", label: "Périodes tarifaires (tous véhicules)", type: "json", ...(userId ? { updatedBy: userId } : {}) } },
    { upsert: true }
  );
  return seasons;
}

/** Every fleet-wide rule, read from the database on each call (no cache: changes are live). */
export async function getRentalRules(): Promise<RentalRules> {
  const [minRentalDaysGlobal, seasons, durationDiscounts] = await Promise.all([getGlobalMinRentalDays(), getGlobalSeasons(), getDurationDiscounts()]);
  return { minRentalDaysGlobal, seasons: seasons.filter((s) => s.active !== false), durationDiscounts };
}

/**
 * Adds the fleet-wide rules to a vehicle (plain object) so that the SAME pricing functions give
 * the same result in the browser and on the server.
 */
export function applyRules<T extends { minRentalDays?: number; pricing?: any }>(vehicle: T, rules: RentalRules, pickupDate?: string): T {
  const base = effectiveMinDays(vehicle, rules.minRentalDaysGlobal);
  const season = pickupDate ? matchGlobalSeason(pickupDate, rules.seasons) : null;
  const min = Math.max(base, Number(season?.minDays || 0));
  return {
    ...vehicle,
    minRentalDays: base,
    minRentalDaysForPeriod: min,
    pricing: { ...(vehicle.pricing || {}), minRentalDays: base, globalSeasons: rules.seasons, durationDiscounts: rules.durationDiscounts },
  };
}

/** Fleet-wide minimum rental period (days). A vehicle's own minimum applies when higher. */
export async function getGlobalMinRentalDays(): Promise<number> {
  try {
    await connectDB();
    const row = await AgencySetting.findOne({ key: "minRentalDaysGlobal" }).lean();
    const n = Math.floor(Number(row?.value));
    return Number.isFinite(n) && n >= 1 ? Math.min(n, 365) : 1;
  } catch {
    return 1;
  }
}

export async function setGlobalMinRentalDays(days: number, userId?: string): Promise<number> {
  const value = Math.min(365, Math.max(1, Math.floor(days)));
  await connectDB();
  await AgencySetting.findOneAndUpdate(
    { key: "minRentalDaysGlobal" },
    {
      $set: {
        value,
        group: "booking",
        label: "Durée minimale de location (tous véhicules)",
        type: "number",
        ...(userId ? { updatedBy: userId } : {}),
      },
    },
    { upsert: true }
  );
  return value;
}

/** Effective minimum for one vehicle = max(global, vehicle). */
export function effectiveMinDays(
  vehicle: { minRentalDays?: number; pricing?: { minRentalDays?: number } } | null | undefined,
  globalMin: number
): number {
  const own = Number(vehicle?.minRentalDays || vehicle?.pricing?.minRentalDays || 1);
  return Math.max(globalMin || 1, own || 1);
}

/** Plain pricing object (vehicle + fleet-wide periods) for the server-side price calculation. */
export function priceSource(vehicle: any, rules: RentalRules): { minRentalDays?: number; pricing: any } {
  const pricing = vehicle?.pricing?.toObject ? vehicle.pricing.toObject() : { ...(vehicle?.pricing || {}) };
  return { minRentalDays: vehicle?.minRentalDays, pricing: { ...pricing, globalSeasons: rules.seasons, durationDiscounts: rules.durationDiscounts } };
}
