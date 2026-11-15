import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import mongoose from "mongoose";
import connectDB from "@/lib/db";
import Extra from "@/models/Extra";
import { deleteImages, markImagesAttached } from "@/lib/cloudinary";
import { normalizePricingType } from "@/lib/extras";
import { requirePermission } from "@/lib/permissions";

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
  selectionMode: z.enum(["quantity", "amount"]).default("quantity"),
  /** Amount slider bounds in TND (amount mode only). */
  amountMinTnd: z.number().min(1).max(100000).optional(),
  amountMaxTnd: z.number().min(1).max(100000).optional(),
  amountStepTnd: z.number().min(1).max(100000).optional(),
}).refine(
  (d) =>
    d.selectionMode !== "amount" ||
    ((d.amountMinTnd ?? 50) < (d.amountMaxTnd ?? 200) && (d.amountStepTnd ?? 50) <= (d.amountMaxTnd ?? 200) - (d.amountMinTnd ?? 50)),
  { message: "Montants invalides : minimum < maximum et palier ≤ écart", path: ["amountMaxTnd"] }
);

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
    selectionMode: input.selectionMode,
    amountMin: Math.round((input.amountMinTnd ?? 50) * 100),
    amountMax: Math.round((input.amountMaxTnd ?? 200) * 100),
    amountStep: Math.round((input.amountStepTnd ?? 50) * 100),
  };
}

const badRequest = (error: z.ZodError) =>
  NextResponse.json(
    { success: false, error: error.issues.map((i) => `${i.path.join(".")}: ${i.message}`).join("; ") },
    { status: 400 }
  );

export async function GET() {
  const guard = await requirePermission("options", "view");
  if (!guard.ok) return guard.response;

  await connectDB();
  const extras = await Extra.find({}).sort({ order: 1, createdAt: 1 }).lean();
  return NextResponse.json({
    success: true,
    extras: extras.map((e) => ({ ...e, _id: String(e._id), pricingType: normalizePricingType(e.pricingType) })),
  });
}

export async function POST(request: NextRequest) {
  const guard = await requirePermission("options", "edit");
  if (!guard.ok) return guard.response;

  const parsed = extraSchema.safeParse(await request.json().catch(() => ({})));
  if (!parsed.success) return badRequest(parsed.error);

  await connectDB();
  const created = await Extra.create(toDoc(parsed.data));
  if (created.iconPublicId) await markImagesAttached([created.iconPublicId]);
  return NextResponse.json({ success: true, extra: created }, { status: 201 });
}

export async function PUT(request: NextRequest) {
  const guard = await requirePermission("options", "edit");
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

/** Show / hide an option on the website in one click (no full re-validation of the form). */
export async function PATCH(request: NextRequest) {
  const guard = await requirePermission("options", "edit");
  if (!guard.ok) return guard.response;

  const body = await request.json().catch(() => ({}));
  const id = String(body.id || "");
  if (!mongoose.Types.ObjectId.isValid(id) || typeof body.isActive !== "boolean") {
    return NextResponse.json({ success: false, error: "Paramètres invalides." }, { status: 400 });
  }
  await connectDB();
  const updated = await Extra.findByIdAndUpdate(id, { $set: { isActive: body.isActive } }, { returnDocument: "after" });
  if (!updated) return NextResponse.json({ success: false, error: "Option introuvable." }, { status: 404 });
  return NextResponse.json({ success: true, extra: updated });
}

export async function DELETE(request: NextRequest) {
  const guard = await requirePermission("options", "edit");
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
