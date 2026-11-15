"use client";

import { useEffect, useState } from "react";

export interface MeInfo {
  user: { id?: string; name?: string; email?: string; role?: string; roleName?: string };
  permissions: string[];
  access: Record<string, "none" | "view" | "edit">;
}

let inflight: Promise<MeInfo | null> | null = null;
let cached: { at: number; value: MeInfo | null } | null = null;

/** Loads /api/admin/me once per 60 s for the whole back-office (shared across components). */
export function loadMe(force = false): Promise<MeInfo | null> {
  if (!force && cached && Date.now() - cached.at < 60_000) return Promise.resolve(cached.value);
  if (!force && inflight) return inflight;
  inflight = fetch("/api/admin/me", { cache: "no-store" })
    .then((r) => (r.ok ? r.json() : null))
    .then((d) => (d?.success ? (d as MeInfo) : null))
    .catch(() => null)
    .then((v) => {
      cached = { at: Date.now(), value: v };
      inflight = null;
      return v;
    });
  return inflight;
}

/**
 * `can("bookings.cancel")` for UI decisions (hide / disable buttons).
 * The server enforces the same permissions; this is only for a clean UI.
 * While loading, everything is allowed so screens do not flicker.
 */
export function usePermissions() {
  const [me, setMe] = useState<MeInfo | null>(cached?.value ?? null);
  useEffect(() => {
    let alive = true;
    loadMe().then((v) => alive && setMe(v));
    return () => {
      alive = false;
    };
  }, []);
  const set = me ? new Set(me.permissions) : null;
  return {
    me,
    loaded: Boolean(me),
    can: (perm: string) => (set ? set.has(perm) : true),
  };
}
