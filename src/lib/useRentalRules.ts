"use client";

import { useCallback, useEffect, useState } from "react";
import { matchGlobalSeason, type DurationDiscount, type GlobalSeason } from "./seasonalPricing";

export interface PublicRentalRules {
  minRentalDaysGlobal: number;
  seasons: GlobalSeason[];
  durationDiscounts: DurationDiscount[];
}

/** "YYYY-MM-DD" + n days, without time-zone drift. */
export function addDays(day: string, n: number): string {
  const d = new Date(`${day}T12:00:00Z`);
  d.setUTCDate(d.getUTCDate() + n);
  return d.toISOString().slice(0, 10);
}

/**
 * Fleet-wide rental rules ("Tarifs par période" → paramètres globaux), live: read when the page
 * opens, again when the visitor comes back to the tab, and every minute. Used by every date picker
 * so the rules apply from the very first step, before a car is chosen.
 */
export function useRentalRules() {
  const [rules, setRules] = useState<PublicRentalRules>({ minRentalDaysGlobal: 1, seasons: [], durationDiscounts: [] });
  const [loaded, setLoaded] = useState(false);

  const load = useCallback(async () => {
    try {
      const d = await fetch("/api/rental-rules", { cache: "no-store" }).then((r) => r.json());
      if (d?.success) {
        setRules({ minRentalDaysGlobal: Number(d.minRentalDaysGlobal) || 1, seasons: Array.isArray(d.seasons) ? d.seasons : [], durationDiscounts: Array.isArray(d.durationDiscounts) ? d.durationDiscounts : [] });
        setLoaded(true);
      }
    } catch {
      /* the server re-checks every rule when the booking is submitted */
    }
  }, []);

  useEffect(() => {
    load();
    const onFocus = () => load();
    window.addEventListener("focus", onFocus);
    const timer = window.setInterval(load, 60_000);
    return () => {
      window.removeEventListener("focus", onFocus);
      window.clearInterval(timer);
    };
  }, [load]);

  /** Fleet-wide period containing the pickup day (null outside any period). */
  const periodFor = useCallback((pickupDate: string) => matchGlobalSeason(pickupDate, rules.seasons), [rules]);
  /** Minimum days for a rental starting that day (a car may still require more). */
  const minDaysOn = useCallback(
    (pickupDate: string) => Math.max(1, rules.minRentalDaysGlobal, Number(matchGlobalSeason(pickupDate, rules.seasons)?.minDays || 0)),
    [rules]
  );

  return { rules, loaded, periodFor, minDaysOn, reload: load };
}
