import { NextRequest, NextResponse } from "next/server";
import mongoose from "mongoose";
import { z } from "zod";
import connectDB from "@/lib/db";
import User from "@/models/User";
import { requireSuperadmin } from "@/lib/apiAuth";

export const dynamic = "force-dynamic";

const ROLES = ["superadmin", "admin", "manager", "staff"] as const;

export async function GET() {
  const guard = await requireSuperadmin();
  if (!guard.ok) return guard.response;
  await connectDB();
  const users = await User.find({ role: { $in: ROLES } })
    .select("name email role isActive lastLoginAt phone createdAt")
    .sort({ createdAt: 1 })
    .lean();
  return NextResponse.json({ success: true, users });
}

const createSchema = z.object({
  name: z.string().trim().min(2).max(80),
  email: z.string().trim().email().max(120),
  password: z.string().min(8).max(128),
  role: z.enum(ROLES),
  phone: z.string().trim().max(30).optional(),
});

export async function POST(request: NextRequest) {
  const guard = await requireSuperadmin();
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
  role: z.enum(ROLES).optional(),
  isActive: z.boolean().optional(),
  password: z.string().min(8).max(128).optional(),
  phone: z.string().trim().max(30).optional(),
});

export async function PATCH(request: NextRequest) {
  const guard = await requireSuperadmin();
  if (!guard.ok) return guard.response;
  const parsed = updateSchema.safeParse(await request.json().catch(() => ({})));
  if (!parsed.success || !mongoose.Types.ObjectId.isValid(parsed.data.id)) {
    return NextResponse.json({ success: false, error: "Données invalides (mot de passe : 8 caractères min.)" }, { status: 400 });
  }
  await connectDB();
  const { id, password, ...rest } = parsed.data;
  const user = await User.findById(id).select("+password");
  if (!user) return NextResponse.json({ success: false, error: "Utilisateur introuvable" }, { status: 404 });

  // Never lock the agency out: keep at least one active superadmin.
  const demoting = user.role === "superadmin" && ((rest.role && rest.role !== "superadmin") || rest.isActive === false);
  if (demoting) {
    const others = await User.countDocuments({ role: "superadmin", isActive: true, _id: { $ne: user._id } });
    if (others === 0) {
      return NextResponse.json({ success: false, error: "Il doit rester au moins un super admin actif." }, { status: 409 });
    }
  }
  Object.assign(user, rest);
  if (password) user.password = password; // hashed by the pre-save hook
  await user.save();
  return NextResponse.json({ success: true });
}
