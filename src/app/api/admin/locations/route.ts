import { NextRequest, NextResponse } from "next/server";
import mongoose from "mongoose";
import { z } from "zod";
import connectDB from "@/lib/db";
import Location from "@/models/Location";
import Vehicle from "@/models/Vehicle";
import Booking from "@/models/Booking";
import { requireStaff } from "@/lib/apiAuth";
import { requirePermission } from "@/lib/permissions";

export const dynamic = "force-dynamic";

export async function GET() {
  const guard = await requireStaff();
  if (!guard.ok) return guard.response;
  try {
    await connectDB();
    const locations = await Location.find({}).sort({ createdAt: 1 }).lean();
    return NextResponse.json({ success: true, locations });
  } catch (error) {
    console.error("GET /api/admin/locations error:", error);
    return NextResponse.json({ success: false, error: "Impossible de charger les agences" }, { status: 500 });
  }
}

const money = z.coerce.number().min(0).max(10_000_000);
const locationSchema = z.object({
  name: z.union([
    z.string().trim().min(2).max(120),
    z.object({ fr: z.string().trim().min(2).max(120), en: z.string().trim().max(120).optional(), ar: z.string().trim().max(120).optional() }),
  ]),
  code: z.string().trim().max(8).optional().default(""),
  address: z.string().trim().max(300).optional().default(""),
  city: z.string().trim().min(1).max(80),
  country: z.string().trim().max(80).optional().default("Tunisie"),
  phone: z.string().trim().max(40).optional().default(""),
  email: z.string().trim().max(120).optional().default(""),
  isAirport: z.boolean().optional().default(false),
  isActive: z.boolean().optional().default(true),
  isOutsideTunis: z.boolean().optional().default(false),
  pickupFee: money.optional().default(0),
  returnFee: money.optional(),
  customReturnFee: money.optional(),
});

function toDoc(d: z.infer<typeof locationSchema>) {
  const fr = typeof d.name === "string" ? d.name : d.name.fr;
  const en = typeof d.name === "string" ? fr : d.name.en || fr;
  const ar = typeof d.name === "string" ? fr : d.name.ar || fr;
  const returnFee = d.returnFee ?? d.customReturnFee ?? 0;
  return {
    name: { fr, en, ar },
    code: (d.code || d.city.slice(0, 3)).toUpperCase(),
    address: d.address || d.city,
    city: d.city,
    country: d.country || "Tunisie",
    phone: d.phone,
    email: d.email,
    isAirport: d.isAirport,
    isActive: d.isActive,
    isOutsideTunis: d.isOutsideTunis,
    pickupFee: Math.round(d.pickupFee || 0),
    returnFee: Math.round(returnFee),
    customReturnFee: Math.round(returnFee),
  };
}

export async function POST(request: NextRequest) {
  const guard = await requirePermission("locations");
  if (!guard.ok) return guard.response;

  const parsed = locationSchema.safeParse(await request.json().catch(() => ({})));
  if (!parsed.success) {
    const issue = parsed.error.issues[0];
    return NextResponse.json(
      { success: false, error: `Champ invalide : ${issue?.path.join(".") || "?"} (${issue?.message})` },
      { status: 400 }
    );
  }
  try {
    await connectDB();
    const doc = toDoc(parsed.data);
    const exists = await Location.findOne({ "name.fr": doc.name.fr, city: doc.city }).select("_id").lean();
    if (exists) {
      return NextResponse.json({ success: false, error: "Une agence avec ce nom existe déjà dans cette ville." }, { status: 409 });
    }
    const location = await Location.create(doc);
    return NextResponse.json({ success: true, location }, { status: 201 });
  } catch (error) {
    console.error("POST /api/admin/locations error:", error);
    return NextResponse.json({ success: false, error: "Création de l'agence impossible" }, { status: 500 });
  }
}

export async function PATCH(request: NextRequest) {
  const guard = await requirePermission("locations");
  if (!guard.ok) return guard.response;

  const body = await request.json().catch(() => ({}));
  const id = String(body.id || "");
  if (!mongoose.Types.ObjectId.isValid(id) || !body.updates) {
    return NextResponse.json({ success: false, error: "Agence invalide" }, { status: 400 });
  }
  const parsed = locationSchema.partial().safeParse(body.updates);
  if (!parsed.success) {
    const issue = parsed.error.issues[0];
    return NextResponse.json({ success: false, error: `Champ invalide : ${issue?.path.join(".")}` }, { status: 400 });
  }
  try {
    await connectDB();
    const current = await Location.findById(id).lean();
    if (!current) return NextResponse.json({ success: false, error: "Agence introuvable" }, { status: 404 });
    const merged = locationSchema.parse({
      name: current.name,
      code: current.code,
      address: current.address,
      city: current.city,
      country: current.country,
      phone: current.phone,
      email: current.email,
      isAirport: current.isAirport,
      isActive: current.isActive,
      isOutsideTunis: current.isOutsideTunis,
      pickupFee: current.pickupFee,
      returnFee: current.returnFee,
      ...Object.fromEntries(Object.entries(parsed.data).filter(([, v]) => v !== undefined)),
    });
    const location = await Location.findByIdAndUpdate(id, { $set: toDoc(merged) }, { returnDocument: "after" });
    return NextResponse.json({ success: true, location });
  } catch (error) {
    console.error("PATCH /api/admin/locations error:", error);
    return NextResponse.json({ success: false, error: "Mise à jour impossible" }, { status: 500 });
  }
}

export async function DELETE(request: NextRequest) {
  const guard = await requirePermission("locations");
  if (!guard.ok) return guard.response;

  try {
    await connectDB();
    const id = new URL(request.url).searchParams.get("id") || "";
    if (!mongoose.Types.ObjectId.isValid(id)) {
      return NextResponse.json({ success: false, error: "Agence invalide" }, { status: 400 });
    }
    // Bookings keep a reference to their agencies: such an agency is deactivated, not deleted.
    const used = await Booking.exists({ $or: [{ pickupLocationId: id }, { returnLocationId: id }] });
    await Vehicle.updateMany({ location: id }, { $unset: { location: 1 } });
    if (used) {
      await Location.findByIdAndUpdate(id, { $set: { isActive: false } });
      return NextResponse.json({
        success: true,
        deactivated: true,
        message: "Agence utilisée par des réservations : elle a été désactivée (masquée du site) au lieu d'être supprimée.",
      });
    }
    await Location.findByIdAndDelete(id);
    return NextResponse.json({ success: true, message: "Agence supprimée" });
  } catch (error) {
    console.error("DELETE /api/admin/locations error:", error);
    return NextResponse.json({ success: false, error: "Suppression impossible" }, { status: 500 });
  }
}
