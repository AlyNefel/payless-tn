import connectDB from "./db";
import AgencySetting from "@/models/AgencySetting";

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
