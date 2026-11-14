import { v2 as cloudinary, type UploadApiResponse } from "cloudinary";

/**
 * Server-side Cloudinary integration (uploads & deletions).
 * Accepts both CLOUDINARY_CLOUD_NAME and NEXT_PUBLIC_CLOUDINARY_CLOUD_NAME (the README documents the latter).
 */
const cloudName = process.env.CLOUDINARY_CLOUD_NAME || process.env.NEXT_PUBLIC_CLOUDINARY_CLOUD_NAME;

cloudinary.config({
  cloud_name: cloudName,
  api_key: process.env.CLOUDINARY_API_KEY,
  api_secret: process.env.CLOUDINARY_API_SECRET,
  secure: true,
});

export const CLOUDINARY_FOLDERS = {
  fleet: "payless-fleet",
  options: "payless-options",
} as const;
export type CloudinaryFolderKey = keyof typeof CLOUDINARY_FOLDERS;

export const MAX_UPLOAD_BYTES = 8 * 1024 * 1024; // 8 MB
export const ALLOWED_IMAGE_TYPES = ["image/jpeg", "image/png", "image/webp", "image/avif", "image/svg+xml"];

export function isCloudinaryConfigured(): boolean {
  return Boolean(cloudName && process.env.CLOUDINARY_API_KEY && process.env.CLOUDINARY_API_SECRET);
}

export interface UploadedImage {
  url: string;
  publicId: string;
  width: number;
  height: number;
  format: string;
  bytes: number;
}

export async function uploadImageBuffer(buffer: Buffer, folderKey: CloudinaryFolderKey): Promise<UploadedImage> {
  const result = await new Promise<UploadApiResponse>((resolve, reject) => {
    const stream = cloudinary.uploader.upload_stream(
      {
        folder: CLOUDINARY_FOLDERS[folderKey],
        resource_type: "image",
        // Store a reasonably sized master; delivery-time transformations handle responsive sizes.
        transformation: [{ width: 2000, height: 2000, crop: "limit" }],
        // Lets us find (and clean up) images never attached to a vehicle.
        tags: [`payless-${folderKey}`, "pending"],
        overwrite: false,
        unique_filename: true,
      },
      (error, res) => (error || !res ? reject(error || new Error("Upload failed")) : resolve(res))
    );
    stream.end(buffer);
  });

  return {
    url: result.secure_url,
    publicId: result.public_id,
    width: result.width,
    height: result.height,
    format: result.format,
    bytes: result.bytes,
  };
}

/** Imports a remote image (e.g. legacy hmlrentcar.tn photo) into our Cloudinary folder. */
export async function uploadImageFromUrl(url: string, folderKey: CloudinaryFolderKey): Promise<UploadedImage> {
  const result = await cloudinary.uploader.upload(url, {
    folder: CLOUDINARY_FOLDERS[folderKey],
    resource_type: "image",
    transformation: [{ width: 2000, height: 2000, crop: "limit" }],
    tags: [`payless-${folderKey}`, "pending"],
  });
  return {
    url: result.secure_url,
    publicId: result.public_id,
    width: result.width,
    height: result.height,
    format: result.format,
    bytes: result.bytes,
  };
}

/** Only images inside our own folders may be deleted through the API. */
export function isManagedPublicId(publicId: string): boolean {
  return Object.values(CLOUDINARY_FOLDERS).some((f) => publicId.startsWith(`${f}/`));
}

export async function deleteImages(publicIds: string[]): Promise<{ deleted: string[]; failed: string[] }> {
  const ids = [...new Set(publicIds.filter((id) => id && isManagedPublicId(id)))];
  const deleted: string[] = [];
  const failed: string[] = [];
  if (!ids.length || !isCloudinaryConfigured()) return { deleted, failed: ids };

  for (const id of ids) {
    try {
      const res = await cloudinary.uploader.destroy(id, { resource_type: "image", invalidate: true });
      if (res.result === "ok" || res.result === "not found") deleted.push(id);
      else failed.push(id);
    } catch (err) {
      console.error("Cloudinary destroy failed:", id, err);
      failed.push(id);
    }
  }
  return { deleted, failed };
}

/** Marks uploads as attached so orphan cleanup (tag "pending") never removes them. */
export async function markImagesAttached(publicIds: string[]): Promise<void> {
  const ids = publicIds.filter((id) => id && isManagedPublicId(id));
  if (!ids.length || !isCloudinaryConfigured()) return;
  try {
    await cloudinary.uploader.remove_tag("pending", ids);
  } catch (err) {
    console.warn("Cloudinary remove_tag failed (non-blocking):", err);
  }
}

/** Lists images still tagged "pending" (uploaded but never attached) older than `minAgeHours`. */
export async function listPendingUploads(minAgeHours = 24): Promise<string[]> {
  if (!isCloudinaryConfigured()) return [];
  const cutoff = Date.now() - minAgeHours * 3600 * 1000;
  const ids: string[] = [];
  let cursor: string | undefined;
  do {
    const res = await cloudinary.api.resources_by_tag("pending", { max_results: 500, next_cursor: cursor });
    for (const r of res.resources as { public_id: string; created_at: string }[]) {
      if (new Date(r.created_at).getTime() < cutoff && isManagedPublicId(r.public_id)) ids.push(r.public_id);
    }
    cursor = res.next_cursor;
  } while (cursor);
  return ids;
}
