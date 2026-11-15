import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import connectDB from "@/lib/db";
import Role from "@/models/Role";
import User from "@/models/User";
import {
  ALL_PERMISSIONS,
  RESOURCES,
  SUPERADMIN_KEY,
  getRoles,
  invalidateRoleCache,
  requirePermission,
  slugifyRoleKey,
} from "@/lib/permissions";

export const dynamic = "force-dynamic";

async function withCounts() {
  const roles = [...(await getRoles()).values()];
  const counts = await User.aggregate([{ $match: { role: { $ne: "client" } } }, { $group: { _id: "$role", n: { $sum: 1 } } }]);
  const byRole = new Map(counts.map((c) => [c._id, c.n]));
  return roles.map((r) => ({ ...r, userCount: byRole.get(r.key) || 0 }));
}

export async function GET() {
  const guard = await requirePermission("roles", "view");
  if (!guard.ok) return guard.response;
  return NextResponse.json({ success: true, roles: await withCounts(), resources: RESOURCES });
}

const permList = z.array(z.string()).max(500).transform((l) => [...new Set(l.filter((p) => ALL_PERMISSIONS.includes(p)))]);

const createSchema = z.object({
  name: z.string().trim().min(2).max(60),
  description: z.string().trim().max(300).optional().default(""),
  permissions: permList.optional().default([]),
  /** Duplicate: copy the permissions of this role. */
  copyFrom: z.string().optional(),
  color: z.string().max(20).optional(),
});

export async function POST(request: NextRequest) {
  const guard = await requirePermission("roles", "create");
  if (!guard.ok) return guard.response;
  const parsed = createSchema.safeParse(await request.json().catch(() => ({})));
  if (!parsed.success) return NextResponse.json({ success: false, error: "Nom du rôle requis (2 caractères min.)" }, { status: 400 });

  await connectDB();
  const roles = await getRoles();
  let permissions = parsed.data.permissions;
  if (parsed.data.copyFrom) {
    const src = roles.get(parsed.data.copyFrom);
    if (!src) return NextResponse.json({ success: false, error: "Rôle à dupliquer introuvable" }, { status: 404 });
    permissions = [...src.permissions];
  }
  // Nobody can create a role more powerful than their own.
  if (guard.role !== SUPERADMIN_KEY) {
    const mine = new Set(roles.get(guard.role)?.permissions || []);
    permissions = permissions.filter((p) => mine.has(p));
  }
  let key = slugifyRoleKey(parsed.data.name);
  if (key === SUPERADMIN_KEY || key === "client") key = `${key}_role`;
  for (let i = 2; roles.has(key); i++) key = `${slugifyRoleKey(parsed.data.name)}_${i}`;

  const role = await Role.create({
    key,
    name: parsed.data.name,
    description: parsed.data.description,
    permissions,
    isSystem: false,
    color: parsed.data.color || "slate",
  });
  invalidateRoleCache();
  return NextResponse.json({ success: true, role }, { status: 201 });
}

const updateSchema = z.object({
  key: z.string().min(1),
  name: z.string().trim().min(2).max(60).optional(),
  description: z.string().trim().max(300).optional(),
  permissions: permList.optional(),
  color: z.string().max(20).optional(),
});

export async function PATCH(request: NextRequest) {
  const guard = await requirePermission("roles", "edit");
  if (!guard.ok) return guard.response;
  const parsed = updateSchema.safeParse(await request.json().catch(() => ({})));
  if (!parsed.success) return NextResponse.json({ success: false, error: "Données invalides" }, { status: 400 });
  const { key, ...rest } = parsed.data;
  if (key === SUPERADMIN_KEY) {
    return NextResponse.json({ success: false, error: "Le rôle Super admin n'est pas modifiable." }, { status: 403 });
  }
  if (key === guard.role && guard.role !== SUPERADMIN_KEY && rest.permissions) {
    return NextResponse.json({ success: false, error: "Vous ne pouvez pas modifier les permissions de votre propre rôle." }, { status: 403 });
  }
  await connectDB();
  const roles = await getRoles();
  if (!roles.has(key)) return NextResponse.json({ success: false, error: "Rôle introuvable" }, { status: 404 });
  if (rest.permissions && guard.role !== SUPERADMIN_KEY) {
    const mine = new Set(roles.get(guard.role)?.permissions || []);
    if (rest.permissions.some((p) => !mine.has(p))) {
      return NextResponse.json({ success: false, error: "Vous ne pouvez pas accorder une permission que vous n'avez pas." }, { status: 403 });
    }
  }
  await Role.updateOne({ key }, { $set: rest });
  invalidateRoleCache();
  return NextResponse.json({ success: true });
}

export async function DELETE(request: NextRequest) {
  const guard = await requirePermission("roles", "delete");
  if (!guard.ok) return guard.response;
  const { searchParams } = new URL(request.url);
  const key = searchParams.get("key") || "";
  const reassignTo = searchParams.get("reassignTo") || "";
  await connectDB();
  const roles = await getRoles();
  const role = roles.get(key);
  if (!role) return NextResponse.json({ success: false, error: "Rôle introuvable" }, { status: 404 });
  if (role.isSystem) return NextResponse.json({ success: false, error: "Les rôles système ne peuvent pas être supprimés." }, { status: 403 });

  const users = await User.countDocuments({ role: key });
  if (users > 0) {
    if (!reassignTo || !roles.has(reassignTo) || reassignTo === key) {
      return NextResponse.json(
        { success: false, error: `${users} utilisateur(s) ont ce rôle : choisissez un rôle de remplacement.`, userCount: users },
        { status: 409 }
      );
    }
    if (reassignTo === SUPERADMIN_KEY && guard.role !== SUPERADMIN_KEY) {
      return NextResponse.json({ success: false, error: "Seul le super admin peut attribuer ce rôle." }, { status: 403 });
    }
    await User.updateMany({ role: key }, { $set: { role: reassignTo } });
  }
  await Role.deleteOne({ key });
  invalidateRoleCache();
  return NextResponse.json({ success: true, reassigned: users });
}
