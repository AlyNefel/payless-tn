import { NextRequest, NextResponse } from "next/server";
import { requirePermission } from "@/lib/permissions";
import connectDB from "@/lib/db";
import { Extra, Vehicle } from "@/models";
import {
  ALLOWED_IMAGE_TYPES,
  CLOUDINARY_FOLDERS,
  MAX_UPLOAD_BYTES,
  deleteImages,
  isCloudinaryConfigured,
  isManagedPublicId,
  uploadImageBuffer,
  uploadImageFromUrl,
  type CloudinaryFolderKey,
} from "@/lib/cloudinary";

export const dynamic = "force-dynamic";

/**
 * POST /api/upload  (multipart: file, folder=fleet|options)
 * Uploads an image to Cloudinary. The image is tagged "pending" until a vehicle/option
 * referencing it is saved — see markImagesAttached().
 */
export async function POST(request: NextRequest) {
  const guard = await requirePermission("media", "upload");
  if (!guard.ok) return guard.response;

  if (!isCloudinaryConfigured()) {
    return NextResponse.json(
      { success: false, error: "Cloudinary n'est pas configuré (CLOUDINARY_CLOUD_NAME / API_KEY / API_SECRET)." },
      { status: 503 }
    );
  }

  // JSON body { url, folder } → import a remote image into Cloudinary.
  if ((request.headers.get("content-type") || "").includes("application/json")) {
    try {
      const { url, folder: f } = await request.json();
      const parsed = new URL(String(url));
      if (parsed.protocol !== "https:") throw new Error("https only");
      const folder: CloudinaryFolderKey = f in CLOUDINARY_FOLDERS ? f : "fleet";
      const uploaded = await uploadImageFromUrl(parsed.toString(), folder);
      return NextResponse.json({ success: true, ...uploaded, public_id: uploaded.publicId });
    } catch (error) {
      console.error("Remote import error:", error);
      return NextResponse.json({ success: false, error: "Import de l'image distante impossible." }, { status: 400 });
    }
  }

  try {
    const formData = await request.formData();
    const file = formData.get("file");
    const folderParam = String(formData.get("folder") || "fleet");
    const folder: CloudinaryFolderKey = folderParam in CLOUDINARY_FOLDERS ? (folderParam as CloudinaryFolderKey) : "fleet";

    if (!(file instanceof File)) {
      return NextResponse.json({ success: false, error: "Aucun fichier fourni." }, { status: 400 });
    }
    if (!ALLOWED_IMAGE_TYPES.includes(file.type)) {
      return NextResponse.json(
        { success: false, error: "Format non supporté (JPG, PNG, WebP, AVIF ou SVG uniquement)." },
        { status: 415 }
      );
    }
    if (file.size > MAX_UPLOAD_BYTES) {
      return NextResponse.json({ success: false, error: "Image trop volumineuse (8 Mo maximum)." }, { status: 413 });
    }

    const uploaded = await uploadImageBuffer(Buffer.from(await file.arrayBuffer()), folder);
    return NextResponse.json({
      success: true,
      ...uploaded,
      // Backward-compatible field names used by older callers.
      public_id: uploaded.publicId,
    });
  } catch (error) {
    console.error("Upload error:", error);
    return NextResponse.json({ success: false, error: "Échec du téléversement." }, { status: 500 });
  }
}

/**
 * DELETE /api/upload  { publicIds: string[] }
 * Removes images that were uploaded but discarded before saving (e.g. modal cancelled).
 * Only images inside our managed folders can be deleted.
 */
export async function DELETE(request: NextRequest) {
  const guard = await requirePermission("media", "upload");
  if (!guard.ok) return guard.response;

  const body = await request.json().catch(() => ({}));
  const publicIds: string[] = Array.isArray(body.publicIds) ? body.publicIds.map(String) : [];
  const managed = publicIds.filter(isManagedPublicId).slice(0, 50);
  if (!managed.length) {
    return NextResponse.json({ success: true, deleted: [], failed: [] });
  }
  // Never delete an image still referenced by a vehicle or an option.
  await connectDB();
  const [usedByVehicles, usedByOptions] = await Promise.all([
    Vehicle.find({ "images.publicId": { $in: managed } }).select("images.publicId").lean(),
    Extra.find({ iconPublicId: { $in: managed } }).select("iconPublicId").lean(),
  ]);
  const inUse = new Set<string>([
    ...usedByVehicles.flatMap((v) => (v.images || []).map((i) => i.publicId)),
    ...usedByOptions.map((o) => String((o as { iconPublicId?: string }).iconPublicId || "")),
  ]);
  const deletable = managed.filter((id) => !inUse.has(id));

  const result = await deleteImages(deletable);
  return NextResponse.json({
    success: result.failed.length === 0,
    ...result,
    skippedInUse: managed.filter((id) => inUse.has(id)),
  });
}
