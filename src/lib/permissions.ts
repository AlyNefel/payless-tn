import { NextResponse } from "next/server";
import connectDB from "./db";
import AgencySetting from "@/models/AgencySetting";
import { getSessionRole, type GuardResult } from "./apiAuth";
import { ADMIN_SECTIONS, DEFAULT_ROLE_PERMISSIONS, type AccessLevel, type RolePermissions, type SectionKey } from "./permissionsShared";

export * from "./permissionsShared";

let cache: { at: number; value: RolePermissions } | null = null;
const TTL = 30_000;

export async function getRolePermissions(): Promise<RolePermissions> {
  if (cache && Date.now() - cache.at < TTL) return cache.value;
  await connectDB();
  const row = await AgencySetting.findOne({ key: "rolePermissions" }).lean();
  const stored = (row?.value || {}) as Partial<RolePermissions>;
  const value = {} as RolePermissions;
  for (const role of Object.keys(DEFAULT_ROLE_PERMISSIONS) as (keyof RolePermissions)[]) {
    value[role] = { ...DEFAULT_ROLE_PERMISSIONS[role], ...(stored[role] || {}) };
  }
  cache = { at: Date.now(), value };
  return value;
}

export async function saveRolePermissions(next: Partial<RolePermissions>, userId?: string): Promise<RolePermissions> {
  const current = await getRolePermissions();
  const merged = { ...current } as RolePermissions;
  for (const role of Object.keys(DEFAULT_ROLE_PERMISSIONS) as (keyof RolePermissions)[]) {
    const incoming = next[role] || {};
    const clean: Record<string, AccessLevel> = { ...current[role] };
    for (const s of ADMIN_SECTIONS) {
      const v = (incoming as Record<string, string>)[s.key];
      if (v === "none" || v === "view" || v === "edit") clean[s.key] = v;
    }
    // The roles/users section always stays superadmin-only.
    clean.users = "none";
    merged[role] = clean as Record<SectionKey, AccessLevel>;
  }
  await AgencySetting.findOneAndUpdate(
    { key: "rolePermissions" },
    { $set: { value: merged, group: "security", label: "Permissions par rôle", type: "json", ...(userId ? { updatedBy: userId } : {}) } },
    { upsert: true }
  );
  cache = { at: Date.now(), value: merged };
  return merged;
}

export async function accessFor(role: string, section: SectionKey): Promise<AccessLevel> {
  if (role === "superadmin") return "edit";
  const perms = await getRolePermissions();
  const r = (role === "agent" ? "staff" : role) as keyof RolePermissions;
  return perms[r]?.[section] || "none";
}

/** API guard: the signed-in user must have `level` access to `section` (superadmin always passes). */
export async function requirePermission(section: SectionKey, level: "view" | "edit" = "edit"): Promise<GuardResult> {
  const { session, role } = await getSessionRole();
  if (!session || !role) {
    return { ok: false, response: NextResponse.json({ success: false, error: "Unauthorized" }, { status: 401 }) };
  }
  const access = await accessFor(role, section);
  const allowed = level === "view" ? access !== "none" : access === "edit";
  if (!allowed) {
    return {
      ok: false,
      response: NextResponse.json(
        { success: false, error: "Accès limité : votre rôle ne permet pas de modifier cette section." },
        { status: 403 }
      ),
    };
  }
  return { ok: true, session, role };
}
