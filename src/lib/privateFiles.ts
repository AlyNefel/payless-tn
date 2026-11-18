import { v2 as cloudinary, type UploadApiResponse } from "cloudinary";
import { isCloudinaryConfigured } from "@/lib/cloudinary";
import { StoredFile } from "@/models";
import type { IStoredFile } from "@/models/StoredFile";

/**
 * Private back-office files (inspection photos, signatures, expense receipts, insurance PDFs).
 *
 * They live on Cloudinary as "authenticated" assets: no public URL exists, every read goes through
 * a short-lived signed download made by the server. The app keeps serving them from the same
 * internal URL (/api/admin/documents/<id>), so references stored in bookings never change.
 * When Cloudinary is not configured or the upload fails, the bytes are kept in MongoDB instead —
 * an upload is never lost. Files stored before the switch keep being served from MongoDB.
 */

const FOLDER = "payless-private";
const DOWNLOAD_TTL_SECONDS = 120;

export const DOCUMENT_URL = /^\/api\/admin\/documents\/([a-f0-9]{24})$/;

/** Cloudinary only treats real images as images; PDFs go as raw files (not subject to the PDF delivery restriction). */
const resourceTypeFor = (contentType: string) => (contentType.startsWith("image/") ? "image" : "raw");

async function uploadToCloudinary(data: Buffer, contentType: string, purpose: string): Promise<UploadApiResponse> {
  return new Promise<UploadApiResponse>((resolve, reject) => {
    const stream = cloudinary.uploader.upload_stream(
      {
        folder: `${FOLDER}/${purpose}`,
        type: "authenticated",
        resource_type: resourceTypeFor(contentType),
        tags: [FOLDER, `${FOLDER}-${purpose}`],
        unique_filename: true,
        overwrite: false,
      },
      (error, res) => (error || !res ? reject(error || new Error("Upload failed")) : resolve(res))
    );
    stream.end(data);
  });
}

export interface SaveInput {
  data: Buffer;
  filename: string;
  contentType: string;
  purpose: string;
  uploadedBy?: string;
}

/** Stores a private file and returns its record (Cloudinary first, MongoDB as fallback). */
export async function savePrivateFile(input: SaveInput): Promise<IStoredFile> {
  const base = { filename: input.filename, contentType: input.contentType, size: input.data.length, purpose: input.purpose, uploadedBy: input.uploadedBy };
  if (isCloudinaryConfigured()) {
    try {
      const res = await uploadToCloudinary(input.data, input.contentType, input.purpose);
      return await StoredFile.create({
        ...base,
        storage: "cloudinary",
        publicId: res.public_id,
        resourceType: res.resource_type,
        format: res.format || undefined,
      });
    } catch (err) {
      console.error("Cloudinary private upload failed, keeping the file in MongoDB:", err);
    }
  }
  return StoredFile.create({ ...base, storage: "db", data: input.data });
}

function signedDownloadUrl(doc: Pick<IStoredFile, "publicId" | "resourceType" | "format">): string {
  return cloudinary.utils.private_download_url(doc.publicId as string, doc.format || "", {
    resource_type: (doc.resourceType || "image") as "image" | "raw",
    type: "authenticated",
    expires_at: Math.floor(Date.now() / 1000) + DOWNLOAD_TTL_SECONDS,
    attachment: false,
  });
}

/** Bytes of a stored file, wherever they live. `doc` must have been loaded with `+data`. */
export async function readPrivateFile(doc: IStoredFile): Promise<Buffer> {
  if (doc.publicId) {
    const res = await fetch(signedDownloadUrl(doc), { cache: "no-store" });
    if (!res.ok) throw new Error(`Cloudinary download failed (${res.status})`);
    return Buffer.from(await res.arrayBuffer());
  }
  if (!doc.data) throw new Error("Stored file has no content");
  return Buffer.from(doc.data);
}

/** Loads a file by its internal URL (/api/admin/documents/<id>). */
export async function readPrivateFileByUrl(url?: string | null): Promise<{ doc: IStoredFile; data: Buffer } | null> {
  const m = DOCUMENT_URL.exec(String(url || ""));
  if (!m) return null;
  const doc = await StoredFile.findById(m[1]).select("+data");
  if (!doc) return null;
  return { doc, data: await readPrivateFile(doc) };
}

/** Deletes the record and, when it lives on Cloudinary, the asset itself. */
export async function deletePrivateFile(id: string): Promise<void> {
  const doc = await StoredFile.findById(id).select("publicId resourceType");
  if (!doc) return;
  if (doc.publicId && isCloudinaryConfigured()) {
    try {
      await cloudinary.uploader.destroy(doc.publicId, { resource_type: doc.resourceType || "image", type: "authenticated", invalidate: true });
    } catch (err) {
      // The record goes anyway: an unreferenced authenticated asset is unreachable, only storage is lost.
      console.error("Cloudinary private delete failed:", doc.publicId, err);
    }
  }
  await StoredFile.deleteOne({ _id: doc._id });
}
