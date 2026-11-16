import { NextResponse } from "next/server";
import type { Session } from "next-auth";
import { auth } from "./auth";
import mongoose from "mongoose";
import connectDB from "./db";
import User from "@/models/User";

/**
 * Central authorization helpers for API route handlers.
 *
 * Every admin API must call one of these guards. The session is a signed JWT
 * verified by NextAuth — the mere presence of a session cookie is never trusted.
 */

// "agent" is kept for backward compatibility with older code paths; the User model uses "staff".
export const STAFF_ROLES = ["superadmin", "admin", "manager", "staff", "agent"] as const;
export const MANAGER_ROLES = ["superadmin", "admin", "manager"] as const;
export const SUPERADMIN_ROLES = ["superadmin"] as const;

export type GuardResult =
  | { ok: true; session: Session; role: string }
  | { ok: false; response: NextResponse };

const accountCache = new Map<string, { at: number; role: string | null }>();
const ACCOUNT_TTL = 15_000;

/**
 * Current role of the account behind a session, read from the database (15 s cache).
 * A suspended or deleted account, or a role change, takes effect almost immediately instead of
 * waiting for the 24 h session token to expire.
 */
async function liveRole(userId: string, tokenRole: string): Promise<string | null> {
  const hit = accountCache.get(userId);
  if (hit && Date.now() - hit.at < ACCOUNT_TTL) return hit.role;
  try {
    await connectDB();
    const user = await User.findById(userId).select("role isActive").lean();
    const role = user && user.isActive ? String(user.role || "").toLowerCase() : null;
    accountCache.set(userId, { at: Date.now(), role });
    if (accountCache.size > 500) accountCache.clear();
    return role;
  } catch {
    // Database unreachable: fall back to the signed token rather than locking everyone out.
    return tokenRole;
  }
}

/** Forget the cached state of an account (call after suspending / changing a role). */
export function invalidateAccount(userId?: string) {
  if (userId) accountCache.delete(userId);
  else accountCache.clear();
}

export async function getSessionRole(): Promise<{ session: Session | null; role: string }> {
  try {
    const session = await auth();
    const tokenRole = String((session?.user as { role?: string } | undefined)?.role || "").toLowerCase();
    const userId = (session?.user as { id?: string } | undefined)?.id;
    if (!session || !tokenRole) return { session: null, role: "" };
    if (userId && mongoose.Types.ObjectId.isValid(userId)) {
      const role = await liveRole(userId, tokenRole);
      if (!role) return { session: null, role: "" };
      return { session, role };
    }
    return { session, role: tokenRole };
  } catch (err) {
    console.warn("Session lookup failed:", err);
    return { session: null, role: "" };
  }
}

export async function requireRole(
  roles: readonly string[] = STAFF_ROLES
): Promise<GuardResult> {
  const { session, role } = await getSessionRole();
  if (!session || !role) {
    return {
      ok: false,
      response: NextResponse.json({ success: false, error: "Unauthorized" }, { status: 401 }),
    };
  }
  // Custom RBAC roles are back-office roles too: any non-client role counts as staff.
  const allowed = roles === STAFF_ROLES ? role !== "client" : roles.includes(role);
  if (!allowed) {
    return {
      ok: false,
      response: NextResponse.json({ success: false, error: "Forbidden" }, { status: 403 }),
    };
  }
  return { ok: true, session, role };
}

export const requireStaff = () => requireRole(STAFF_ROLES);
export const requireManager = () => requireRole(MANAGER_ROLES);
export const requireSuperadmin = () => requireRole(SUPERADMIN_ROLES);

/** True when the current request comes from an authenticated back-office user. */
export async function isStaffRequest(): Promise<boolean> {
  const { session, role } = await getSessionRole();
  return Boolean(session && role && role !== "client");
}

/** Escape user input before embedding it in a RegExp / Mongo $regex (prevents ReDoS & regex injection). */
export function escapeRegex(input: string): string {
  return input.replace(/[.*+?^${}()|[\]\\]/g, "\\$&").slice(0, 100);
}

/** Minimal HTML escaping for user-provided values interpolated into email HTML. */
export function escapeHtml(input: unknown): string {
  return String(input ?? "")
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#39;");
}
