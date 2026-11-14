import mongoose from "mongoose";
import Extra from "@/models/Extra";
import { normalizePricingType, onlySelected } from "./extras";

interface BookingExtraSnapshot {
  extraId?: unknown;
  name?: string;
  price?: number;
  quantity?: number;
  icon?: string;
  pricingType?: string;
  lineTotal?: number;
}

/**
 * Bookings created before icon snapshots existed only store extraId/name/price/quantity.
 * This enriches them (in memory) with the option's icon & pricing type, and drops
 * any unselected (quantity 0) entries so every consumer only sees selected options.
 */
export async function withExtraIcons<
  T extends { extras?: BookingExtraSnapshot[]; vehicles?: { extras?: BookingExtraSnapshot[] }[] }
>(booking: T): Promise<T> {
  if (!booking) return booking;

  const all: BookingExtraSnapshot[] = [
    ...(booking.extras || []),
    ...((booking.vehicles || []).flatMap((v) => v.extras || [])),
  ];
  const missing = all
    .filter((e) => !e.icon && e.extraId && mongoose.Types.ObjectId.isValid(String(e.extraId)))
    .map((e) => String(e.extraId));

  const byId = new Map<string, { icon?: string; pricingType?: string }>();
  if (missing.length) {
    const docs = await Extra.find({ _id: { $in: [...new Set(missing)] } })
      .select("icon pricingType")
      .lean();
    docs.forEach((d) => byId.set(String(d._id), { icon: d.icon, pricingType: d.pricingType }));
  }

  const enrich = (list?: BookingExtraSnapshot[]) =>
    onlySelected(list).map((e) => {
      const ref = byId.get(String(e.extraId));
      return {
        ...e,
        icon: e.icon || ref?.icon || "",
        pricingType: normalizePricingType(e.pricingType || ref?.pricingType),
      };
    });

  return {
    ...booking,
    extras: enrich(booking.extras),
    vehicles: (booking.vehicles || []).map((v) => ({ ...v, extras: enrich(v.extras) })),
  };
}
