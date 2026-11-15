import { NextRequest, NextResponse } from "next/server";
import mongoose from "mongoose";
import { z } from "zod";
import connectDB from "@/lib/db";
import User from "@/models/User";
import { SUPERADMIN_KEY, getRoles, requirePermission } from "@/lib/permissions";

export const dynamic = "force-dynamic";

export async function GET() {
  const guard = await requirePermission("users", "view");
  if (!guard.ok) return guard.response;
  await connectDB();
  const users = await User.find({ role: { $ne: "client" } })
    .select("name email role isActive lastLoginAt phone createdAt")
    .sort({ createdAt: 1 })
    .lean();
  return NextResponse.json({ success: true, users });
}

/** Only an existing role; only a superadmin can hand out (or touch) the superadmin role. */
async function checkRole(role: string, actorRole: string): Promise<string | null> {
  const roles = await getRoles();
  if (!roles.has(role)) return "Rôle inconnu.";
  if (role === SUPERADMIN_KEY && actorRole !== SUPERADMIN_KEY) return "Seul le super admin peut attribuer ce rôle.";
  return null;
}

const createSchema = z.object({
  name: z.string().trim().min(2).max(80),
  email: z.string().trim().email().max(120),
  password: z.string().min(8).max(128),
  role: z.string().trim().min(1).max(40),
  phone: z.string().trim().max(30).optional(),
});

export async function POST(request: NextRequest) {
  const guard = await requirePermission("users", "create");
  if (!guard.ok) return guard.response;
  const parsed = createSchema.safeParse(await request.json().catch(() => ({})));
  if (!parsed.success) {
    const i = parsed.error.issues[0];
    return NextResponse.json(
      { success: false, error: i?.path[0] === "password" ? "Mot de passe : 8 caractères minimum." : `Champ invalide : ${i?.path.join(".")}` },
      { status: 400 }
    );
  }
  await connectDB();
  const roleErr = await checkRole(parsed.data.role, guard.role);
  if (roleErr) return NextResponse.json({ success: false, error: roleErr }, { status: 403 });
  const email = parsed.data.email.toLowerCase();
  if (await User.exists({ email })) {
    return NextResponse.json({ success: false, error: "Cet email est déjà utilisé." }, { status: 409 });
  }
  const user = await User.create({ ...parsed.data, email, isActive: true });
  return NextResponse.json(
    { success: true, user: { _id: user._id, name: user.name, email: user.email, role: user.role, isActive: true } },
    { status: 201 }
  );
}

const updateSchema = z.object({
  id: z.string(),
  name: z.string().trim().min(2).max(80).optional(),
  email: z.string().trim().email().max(120).optional(),
  role: z.string().trim().min(1).max(40).optional(),
  isActive: z.boolean().optional(),
  password: z.string().min(8).max(128).optional(),
  phone: z.string().trim().max(30).optional(),
});

export async function PATCH(request: NextRequest) {
  const guard = await requirePermission("users", "edit");
  if (!guard.ok) return guard.response;
  const parsed = updateSchema.safeParse(await request.json().catch(() => ({})));
  if (!parsed.success || !mongoose.Types.ObjectId.isValid(parsed.data.id)) {
    return NextResponse.json({ success: false, error: "Données invalides (mot de passe : 8 caractères min.)" }, { status: 400 });
  }
  await connectDB();
  const { id, password, ...rest } = parsed.data;
  const user = await User.findById(id).select("+password");
  if (!user || user.role === "client") return NextResponse.json({ success: false, error: "Utilisateur introuvable" }, { status: 404 });

  if (user.role === SUPERADMIN_KEY && guard.role !== SUPERADMIN_KEY) {
    return NextResponse.json({ success: false, error: "Seul un super admin peut modifier un super admin." }, { status: 403 });
  }
  if (rest.role) {
    const roleErr = await checkRole(rest.role, guard.role);
    if (roleErr) return NextResponse.json({ success: false, error: roleErr }, { status: 403 });
  }
  if (rest.email) {
    rest.email = rest.email.toLowerCase();
    if (await User.exists({ email: rest.email, _id: { $ne: user._id } })) {
      return NextResponse.json({ success: false, error: "Cet email est déjà utilisé." }, { status: 409 });
    }
  }
  // Never lock the agency out: keep at least one active superadmin.
  const demoting = user.role === SUPERADMIN_KEY && ((rest.role && rest.role !== SUPERADMIN_KEY) || rest.isActive === false);
  if (demoting) {
    const others = await User.countDocuments({ role: SUPERADMIN_KEY, isActive: true, _id: { $ne: user._id } });
    if (others === 0) {
      return NextResponse.json({ success: false, error: "Il doit rester au moins un super admin actif." }, { status: 409 });
    }
  }
  Object.assign(user, rest);
  if (password) user.password = password; // hashed by the pre-save hook
  await user.save();
  return NextResponse.json({ success: true });
}

export async function DELETE(request: NextRequest) {
  const guard = await requirePermission("users", "delete");
  if (!guard.ok) return guard.response;
  const id = new URL(request.url).searchParams.get("id") || "";
  if (!mongoose.Types.ObjectId.isValid(id)) return NextResponse.json({ success: false, error: "Utilisateur invalide" }, { status: 400 });
  await connectDB();
  const user = await User.findById(id);
  if (!user || user.role === "client") return NextResponse.json({ success: false, error: "Utilisateur introuvable" }, { status: 404 });
  if (String(user._id) === guard.session.user?.id) {
    return NextResponse.json({ success: false, error: "Vous ne pouvez pas supprimer votre propre compte." }, { status: 409 });
  }
  if (user.role === SUPERADMIN_KEY) {
    if (guard.role !== SUPERADMIN_KEY) return NextResponse.json({ success: false, error: "Action réservée au super admin." }, { status: 403 });
    const others = await User.countDocuments({ role: SUPERADMIN_KEY, isActive: true, _id: { $ne: user._id } });
    if (others === 0) return NextResponse.json({ success: false, error: "Il doit rester au moins un super admin actif." }, { status: 409 });
  }
  await User.deleteOne({ _id: user._id });
  return NextResponse.json({ success: true });
}
