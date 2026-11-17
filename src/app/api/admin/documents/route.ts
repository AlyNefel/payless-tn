import { NextRequest, NextResponse } from "next/server";
import { can, requirePermission } from "@/lib/permissions";
import { getSessionRole } from "@/lib/apiAuth";
import connectDB from "@/lib/db";
import { StoredFile } from "@/models";

export const dynamic = "force-dynamic";

const MAX_BYTES = 8 * 1024 * 1024;
const TYPES = ["application/pdf", "image/jpeg", "image/png", "image/webp"] as const;

/** The real type, read from the first bytes — the browser-declared type is not trusted. */
function sniff(buf: Buffer): (typeof TYPES)[number] | null {
  if (buf.length < 12) return null;
  if (buf.subarray(0, 5).toString("latin1") === "%PDF-") return "application/pdf";
  if (buf[0] === 0xff && buf[1] === 0xd8 && buf[2] === 0xff) return "image/jpeg";
  if (buf.subarray(0, 8).equals(Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]))) return "image/png";
  if (buf.subarray(0, 4).toString("latin1") === "RIFF" && buf.subarray(8, 12).toString("latin1") === "WEBP") return "image/webp";
  return null;
}

/** POST multipart { file } → private document (PDF or photo, 8 MB max). Returns its internal URL. */
export async function POST(request: NextRequest) {
  // Contracts of insurance (garage), expense receipts (accounting) and inspection photos (counter).
  const { session, role } = await getSessionRole();
  if (!session || !role || role === "client") return NextResponse.json({ success: false, error: "Unauthorized" }, { status: 401 });
  const allowed = (await can(role, "garage", "edit")) || (await can(role, "accounting", "create")) || (await can(role, "bookings", "edit"));
  if (!allowed) return NextResponse.json({ success: false, error: "Accès limité : votre rôle ne permet pas cette action." }, { status: 403 });
  const guard = { session };
  try {
    const form = await request.formData();
    const file = form.get("file");
    if (!(file instanceof File)) return NextResponse.json({ success: false, error: "Aucun fichier fourni." }, { status: 400 });
    if (file.size > MAX_BYTES) return NextResponse.json({ success: false, error: "Fichier trop volumineux (8 Mo maximum)." }, { status: 413 });
    const data = Buffer.from(await file.arrayBuffer());
    const contentType = sniff(data);
    if (!contentType) {
      return NextResponse.json({ success: false, error: "Format non supporté : PDF, JPG, PNG ou WebP uniquement." }, { status: 415 });
    }
    await connectDB();
    const doc = await StoredFile.create({
      filename: (file.name || "document").replace(/[^\w.\- ()]+/g, "_").slice(0, 150),
      contentType,
      size: data.length,
      data,
      purpose: ["insurance", "expense", "inspection", "signature"].includes(String(form.get("purpose"))) ? String(form.get("purpose")) : "insurance",
      uploadedBy: guard.session.user?.email || undefined,
    });
    return NextResponse.json(
      { success: true, url: `/api/admin/documents/${doc._id}`, filename: doc.filename, contentType, size: doc.size },
      { status: 201 }
    );
  } catch (error) {
    console.error("Document upload error:", error);
    return NextResponse.json({ success: false, error: "Échec du téléversement." }, { status: 500 });
  }
}
