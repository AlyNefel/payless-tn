import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import mongoose from "mongoose";
import connectDB from "@/lib/db";
import Extra from "@/models/Extra";
import { requireManager, requireStaff } from "@/lib/apiAuth";
import { deleteImages, markImagesAttached } from "@/lib/cloudinary";
import { normalizePricingType } from "@/lib/extras";

export const dynamic = "force-dynamic";

const i18n = z.object({
  fr: z.string().trim().min(1).max(120),
  en: z.string().trim().min(1).max(120),
  ar: z.string().trim().min(1).max(120),
});

const extraSchema = z.object({
  name: i18n,
  description: z
    .object({ fr: z.string().max(500), en: z.string().max(500), ar: z.string().max(500) })
    .partial()
    .optional(),
  icon: z.string().trim().min(1, "Icône requise").max(500),
  iconPublicId: z.string().max(300).optional().default(""),
  /** Price in TND (major units) from the admin form; stored in minor units. */
  priceTnd: z.number().min(0).max(100000),
  pricingType: z.enum(["per_day", "per_rental", "per_unit"]),
  maxQuantity: z.number().int().min(1).max(20),
  order: z.number().int().min(0).max(1000).default(0),
  isActive: z.boolean().default(true),
});

function toDoc(input: z.infer<typeof extraSchema>) {
  return {
    name: input.name,
    description: { fr: "", en: "", ar: "", ...(input.description || {}) },
    icon: input.icon,
    iconPublicId: input.iconPublicId || "",
    price: Math.round(input.priceTnd * 100),
    pricingType: input.pricingType,
    maxQuantity: input.maxQuantity,
    order: input.order,
    isActive: input.isActive,
  };
}

const badRequest = (error: z.ZodError) =>
  NextResponse.json(
    { success: false, error: error.issues.map((i) => `${i.path.join(".")}: ${i.message}`).join("; ") },
    { status: 400 }
  );

export async function GET() {
  const guard = await requireStaff();
  if (!guard.ok) return guard.response;

  await connectDB();
  const extras = await Extra.find({}).sort({ order: 1, createdAt: 1 }).lean();
  return NextResponse.json({
    success: true,
    extras: extras.map((e) => ({ ...e, _id: String(e._id), pricingType: normalizePricingType(e.pricingType) })),
  });
}

export async function POST(request: NextRequest) {
  const guard = await requireManager();
  if (!guard.ok) return guard.response;

  const parsed = extraSchema.safeParse(await request.json().catch(() => ({})));
  if (!parsed.success) return badRequest(parsed.error);

  await connectDB();
  const created = await Extra.create(toDoc(parsed.data));
  if (created.iconPublicId) await markImagesAttached([created.iconPublicId]);
  return NextResponse.json({ success: true, extra: created }, { status: 201 });
}

export async function PUT(request: NextRequest) {
  const guard = await requireManager();
  if (!guard.ok) return guard.response;

  const body = await request.json().catch(() => ({}));
  const id = String(body.id || "");
  if (!mongoose.Types.ObjectId.isValid(id)) {
    return NextResponse.json({ success: false, error: "Identifiant invalide." }, { status: 400 });
  }
  const parsed = extraSchema.safeParse(body);
  if (!parsed.success) return badRequest(parsed.error);

  await connectDB();
  const previous = await Extra.findById(id).lean();
  if (!previous) return NextResponse.json({ success: false, error: "Option introuvable." }, { status: 404 });

  const updated = await Extra.findByIdAndUpdate(id, { $set: toDoc(parsed.data) }, { returnDocument: "after", runValidators: true });

  // Replaced uploaded icon → delete the old Cloudinary asset (no orphans).
  if (previous.iconPublicId && previous.iconPublicId !== parsed.data.iconPublicId) {
    await deleteImages([previous.iconPublicId]);
  }
  if (parsed.data.iconPublicId) await markImagesAttached([parsed.data.iconPublicId]);

  return NextResponse.json({ success: true, extra: updated });
}

export async function DELETE(request: NextRequest) {
  const guard = await requireManager();
  if (!guard.ok) return guard.response;

  const id = new URL(request.url).searchParams.get("id") || "";
  if (!mongoose.Types.ObjectId.isValid(id)) {
    return NextResponse.json({ success: false, error: "Identifiant invalide." }, { status: 400 });
  }
  await connectDB();
  const deleted = await Extra.findByIdAndDelete(id).lean();
  if (!deleted) return NextResponse.json({ success: false, error: "Option introuvable." }, { status: 404 });
  // Existing bookings keep their own snapshot (name/price/icon), so deleting the option is safe.
  if (deleted.iconPublicId) await deleteImages([deleted.iconPublicId]);
  return NextResponse.json({ success: true });
}
