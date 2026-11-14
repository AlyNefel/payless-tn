import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import mongoose from "mongoose";
import { connectDB } from "@/lib/db";
import Vehicle from "@/models/Vehicle";
import VehicleCategory from "@/models/VehicleCategory";
import { sanitizeQuery } from "@/lib/utils";
import { requireManager, requireStaff } from "@/lib/apiAuth";
import { deleteImages, markImagesAttached } from "@/lib/cloudinary";

export const dynamic = "force-dynamic";

/* ───────────────────────────── Validation ───────────────────────────── */

const imageSchema = z.object({
  url: z.string().url().max(1000),
  // Empty for legacy/external images that are not hosted on our Cloudinary account.
  publicId: z.string().max(300).optional().default(""),
  alt: z.string().max(200).optional().default(""),
});

const lower = (v: unknown) => (typeof v === "string" ? v.trim().toLowerCase() : v);

/** Payload sent by the admin fleet form. Prices are entered in TND (major units). */
const vehicleInputSchema = z.object({
  brand: z.string().trim().min(1).max(60),
  model: z.string().trim().min(1).max(80),
  year: z.number().int().min(1990).max(2100),
  categoryId: z.string().refine((v) => mongoose.Types.ObjectId.isValid(v), "Catégorie invalide"),
  transmission: z.preprocess(
    (v) => (String(lower(v)).startsWith("auto") || lower(v) === "cvt" ? "automatic" : "manual"),
    z.enum(["automatic", "manual"])
  ),
  fuelType: z.preprocess(lower, z.enum(["gasoline", "diesel", "electric", "hybrid"])),
  seats: z.number().int().min(1).max(20),
  doors: z.number().int().min(0).max(6),
  luggageCapacity: z.number().int().min(0).max(20),
  color: z.string().trim().max(40).optional().default(""),
  licensePlate: z.string().trim().min(2).max(20),
  mileage: z.number().min(0).max(2_000_000).optional(),
  totalUnits: z.number().int().min(1).max(200),
  features: z.array(z.string().max(60)).max(30).default([]),
  pricing: z.object({
    daily: z.number().min(0).max(100000),
    weekly: z.number().min(0).max(1000000),
    monthly: z.number().min(0).max(5000000),
    deposit: z.number().min(0).max(1000000),
  }),
  images: z.array(imageSchema).max(20).default([]),
  description: z.object({ fr: z.string().max(3000), en: z.string().max(3000), ar: z.string().max(3000) }).partial().optional(),
});

type VehicleInput = z.infer<typeof vehicleInputSchema>;

const toMinor = (tnd: number) => Math.round(tnd * 100);

/** Maps validated form input to the Vehicle document shape. Order of `images` = display order; first = primary. */
function toVehicleFields(input: VehicleInput) {
  return {
    brand: input.brand,
    model: input.model,
    year: input.year,
    categoryId: new mongoose.Types.ObjectId(input.categoryId),
    transmission: input.transmission,
    fuelType: input.fuelType,
    seats: input.seats,
    doors: input.doors,
    luggageCapacity: input.luggageCapacity,
    color: input.color || "—",
    licensePlate: input.licensePlate.toUpperCase(),
    ...(input.mileage !== undefined ? { mileage: input.mileage } : {}),
    totalUnits: input.totalUnits,
    features: input.features,
    hasAirConditioning: input.features.includes("A/C"),
    "pricing.daily": toMinor(input.pricing.daily),
    "pricing.weekly": toMinor(input.pricing.weekly),
    "pricing.monthly": toMinor(input.pricing.monthly),
    "pricing.deposit": toMinor(input.pricing.deposit),
    images: input.images.map((img, i) => ({
      url: img.url,
      publicId: img.publicId || "",
      alt: img.alt || `${input.brand} ${input.model}`,
      isPrimary: i === 0,
    })),
    ...(input.description
      ? Object.fromEntries(Object.entries(input.description).map(([k, v]) => [`description.${k}`, v]))
      : {}),
  };
}

/** Converts dotted keys into a nested object for Model.create(). */
function nest(fields: Record<string, unknown>) {
  const out: Record<string, unknown> = {};
  for (const [key, value] of Object.entries(fields)) {
    const parts = key.split(".");
    let cur = out;
    parts.slice(0, -1).forEach((p) => {
      cur[p] = (cur[p] as Record<string, unknown>) || {};
      cur = cur[p] as Record<string, unknown>;
    });
    cur[parts[parts.length - 1]] = value;
  }
  return out;
}

const validationError = (error: z.ZodError) =>
  NextResponse.json(
    { success: false, error: error.issues.map((i) => `${i.path.join(".")}: ${i.message}`).join("; ") },
    { status: 400 }
  );

function duplicatePlate(error: unknown) {
  return (error as { code?: number })?.code === 11000;
}

/* ───────────────────────────── Handlers ───────────────────────────── */

export async function GET(request: NextRequest) {
  const guard = await requireStaff();
  if (!guard.ok) return guard.response;

  try {
    await connectDB();
    const { searchParams } = new URL(request.url);
    const search = searchParams.get("search");
    const status = searchParams.get("status");
    const page = Math.max(1, parseInt(searchParams.get("page") || "1", 10) || 1);
    const limit = Math.min(200, Math.max(1, parseInt(searchParams.get("limit") || "50", 10) || 50));

    const query: Record<string, unknown> = {};
    if (search) {
      const q = sanitizeQuery(search);
      query.$or = [
        { brand: { $regex: q, $options: "i" } },
        { model: { $regex: q, $options: "i" } },
        { licensePlate: { $regex: q, $options: "i" } },
      ];
    }
    if (status) query.status = String(status);
    else query.status = { $ne: "archived" };

    const [vehicles, total, categories] = await Promise.all([
      Vehicle.find(query)
        .populate("categoryId", "name slug")
        .sort({ createdAt: -1 })
        .skip((page - 1) * limit)
        .limit(limit)
        .lean(),
      Vehicle.countDocuments(query),
      VehicleCategory.find({}).select("name slug").sort({ order: 1, createdAt: 1 }).lean(),
    ]);

    return NextResponse.json({ vehicles, total, page, limit, categories });
  } catch (error) {
    console.error("GET /api/admin/vehicles error:", error);
    return NextResponse.json({ error: "Failed to fetch vehicles" }, { status: 500 });
  }
}

export async function POST(request: NextRequest) {
  const guard = await requireManager();
  if (!guard.ok) return guard.response;

  const parsed = vehicleInputSchema.safeParse(await request.json().catch(() => ({})));
  if (!parsed.success) return validationError(parsed.error);

  try {
    await connectDB();
    const fields = toVehicleFields(parsed.data);
    const vehicle = await Vehicle.create({
      ...nest(fields),
      pricing: { ...(nest(fields).pricing as object), currency: "TND" },
      availableUnits: parsed.data.totalUnits,
      status: "available",
      isActive: true,
    });
    await markImagesAttached(parsed.data.images.map((i) => i.publicId || ""));
    return NextResponse.json({ success: true, vehicle }, { status: 201 });
  } catch (error) {
    if (duplicatePlate(error)) {
      return NextResponse.json({ success: false, error: "Cette immatriculation existe déjà." }, { status: 409 });
    }
    console.error("POST /api/admin/vehicles error:", error);
    return NextResponse.json({ success: false, error: "Failed to create vehicle" }, { status: 500 });
  }
}

const statusOnlySchema = z.object({
  id: z.string(),
  status: z.enum(["available", "rented", "maintenance", "unavailable"]),
});

export async function PUT(request: NextRequest) {
  const guard = await requireManager();
  if (!guard.ok) return guard.response;

  const body = await request.json().catch(() => ({}));
  const id = String(body.id || "");
  if (!mongoose.Types.ObjectId.isValid(id)) {
    return NextResponse.json({ success: false, error: "Vehicle ID required" }, { status: 400 });
  }

  try {
    await connectDB();

    // Lightweight status toggle (workshop / available) from the fleet grid.
    const statusOnly = statusOnlySchema.safeParse(body);
    if (statusOnly.success && Object.keys(body).length === 2) {
      const vehicle = await Vehicle.findByIdAndUpdate(id, { $set: { status: statusOnly.data.status } }, { returnDocument: "after" });
      if (!vehicle) return NextResponse.json({ success: false, error: "Vehicle not found" }, { status: 404 });
      return NextResponse.json({ success: true, vehicle });
    }

    const parsed = vehicleInputSchema.safeParse(body);
    if (!parsed.success) return validationError(parsed.error);

    const previous = await Vehicle.findById(id).select("images").lean();
    if (!previous) return NextResponse.json({ success: false, error: "Vehicle not found" }, { status: 404 });

    // $set with dotted pricing keys keeps currency & seasonalPrices intact.
    const vehicle = await Vehicle.findByIdAndUpdate(
      id,
      { $set: toVehicleFields(parsed.data) },
      { returnDocument: "after", runValidators: true }
    );

    // Orphan cleanup: Cloudinary assets removed from the gallery are deleted.
    const kept = new Set(parsed.data.images.map((i) => i.publicId).filter(Boolean));
    const removed = (previous.images || []).map((i) => i.publicId).filter((pid) => pid && !kept.has(pid));
    const cleanup = removed.length ? await deleteImages(removed) : { deleted: [], failed: [] };
    await markImagesAttached([...kept] as string[]);

    return NextResponse.json({ success: true, vehicle, imagesDeleted: cleanup.deleted });
  } catch (error) {
    if (duplicatePlate(error)) {
      return NextResponse.json({ success: false, error: "Cette immatriculation existe déjà." }, { status: 409 });
    }
    console.error("PUT /api/admin/vehicles error:", error);
    return NextResponse.json({ success: false, error: "Failed to update vehicle" }, { status: 500 });
  }
}

export async function DELETE(request: NextRequest) {
  const guard = await requireManager();
  if (!guard.ok) return guard.response;

  try {
    await connectDB();
    const id = new URL(request.url).searchParams.get("id") || "";
    if (!mongoose.Types.ObjectId.isValid(id)) {
      return NextResponse.json({ error: "Vehicle ID required" }, { status: 400 });
    }

    // Soft delete: archived vehicles disappear from the public site and from availability,
    // while past bookings keep their reference. Images are kept for the booking history.
    const vehicle = await Vehicle.findByIdAndUpdate(
      id,
      { $set: { status: "archived", isActive: false } },
      { returnDocument: "after" }
    );
    if (!vehicle) return NextResponse.json({ error: "Vehicle not found" }, { status: 404 });

    return NextResponse.json({ success: true, message: "Vehicle archived successfully" });
  } catch (error) {
    console.error("DELETE /api/admin/vehicles error:", error);
    return NextResponse.json({ error: "Failed to archive vehicle" }, { status: 500 });
  }
}
