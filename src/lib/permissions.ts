import { NextResponse } from "next/server";
import connectDB from "./db";
import AgencySetting from "@/models/AgencySetting";
import Role from "@/models/Role";
import { getSessionRole, type GuardResult } from "./apiAuth";
import {
  ALL_PERMISSIONS,
  RESOURCES,
  SUPERADMIN_KEY,
  SYSTEM_ROLES,
  sectionAccess,
  type AccessLevel,
  type RoleDef,
} from "./permissionsShared";

export * from "./permissionsShared";

let cache: { at: number; roles: Map<string, RoleDef> } | null = null;
const TTL = 30_000;

export function invalidateRoleCache() {
  cache = null;
}

/**
 * Creates the system roles the first time. When the previous coarse matrix
 * (AgencySetting "rolePermissions": section → none/view/edit) exists, it is converted
 * so admins keep the access they configured.
 */
async function ensureSystemRoles() {
  const existing = await Role.find({ isSystem: true }).select("key").lean();
  const have = new Set(existing.map((r) => r.key));
  const missing = SYSTEM_ROLES.filter((r) => !have.has(r.key));
  if (!missing.length) return;

  const legacy = (await AgencySetting.findOne({ key: "rolePermissions" }).lean())?.value as
    | Record<string, Record<string, AccessLevel>>
    | undefined;

  for (const def of missing) {
    let permissions = def.permissions;
    const old = legacy?.[def.key];
    if (old && def.key !== SUPERADMIN_KEY) {
      permissions = RESOURCES.flatMap((r) => {
        const lvl = old[r.key];
        if (lvl === "edit") return r.actions.map((a) => `${r.key}.${a}`);
        if (lvl === "view") return r.actions.includes("view") ? [`${r.key}.view`] : [];
        // Resources that did not exist in the old matrix keep their default grant.
        return lvl === undefined ? def.permissions.filter((p) => p.startsWith(`${r.key}.`)) : [];
      });
    }
    await Role.updateOne(
      { key: def.key },
      { $setOnInsert: { key: def.key, name: def.name, description: def.description, permissions, isSystem: true, color: def.color } },
      { upsert: true }
    );
  }
}

export async function getRoles(): Promise<Map<string, RoleDef>> {
  if (cache && Date.now() - cache.at < TTL) return cache.roles;
  await connectDB();
  await ensureSystemRoles();
  const docs = await Role.find({}).sort({ isSystem: -1, createdAt: 1 }).lean();
  const roles = new Map<string, RoleDef>();
  for (const d of docs) {
    roles.set(d.key, {
      key: d.key,
      name: d.name,
      description: d.description,
      // Superadmin always has every permission, including ones added in future versions.
      permissions: d.key === SUPERADMIN_KEY ? ALL_PERMISSIONS : (d.permissions || []).filter((p) => ALL_PERMISSIONS.includes(p)),
      isSystem: d.isSystem,
      color: d.color,
    });
  }
  cache = { at: Date.now(), roles };
  return roles;
}

export async function permissionsFor(roleKey: string): Promise<Set<string>> {
  const key = roleKey === "agent" ? "staff" : roleKey;
  if (key === SUPERADMIN_KEY) return new Set(ALL_PERMISSIONS);
  const roles = await getRoles();
  return new Set(roles.get(key)?.permissions || []);
}

/** True when the role holds `resource.action` (an action unknown to the resource means "any write"). */
export async function can(roleKey: string, resource: string, action: string): Promise<boolean> {
  const perms = await permissionsFor(roleKey);
  if (perms.has(`${resource}.${action}`)) return true;
  const def = RESOURCES.find((r) => r.key === resource);
  if (def && !def.actions.includes(action as never) && action !== "view") {
    return def.actions.some((a) => a !== "view" && perms.has(`${resource}.${a}`));
  }
  return false;
}

export async function accessFor(roleKey: string, section: string): Promise<AccessLevel> {
  return sectionAccess(await permissionsFor(roleKey), section);
}

/**
 * API guard. `action` is a granular action ("view", "create", "edit", "delete", "cancel", "export",
 * "upload"). Superadmin always passes.
 */
export async function requirePermission(resource: string, action: string = "edit"): Promise<GuardResult> {
  const { session, role } = await getSessionRole();
  if (!session || !role || role === "client") {
    return { ok: false, response: NextResponse.json({ success: false, error: "Unauthorized" }, { status: 401 }) };
  }
  if (!(await can(role, resource, action))) {
    return {
      ok: false,
      response: NextResponse.json(
        { success: false, error: "Accès limité : votre rôle ne permet pas cette action." },
        { status: 403 }
      ),
    };
  }
  return { ok: true, session, role };
}
