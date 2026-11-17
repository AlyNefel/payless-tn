import { NextRequest, NextResponse } from "next/server";
import mongoose from "mongoose";
import { can } from "@/lib/permissions";
import { getSessionRole } from "@/lib/apiAuth";
import connectDB from "@/lib/db";
import { StoredFile } from "@/models";

export const dynamic = "force-dynamic";

/** Serves a private document to signed-in staff with access to the garage section. */
export async function GET(_request: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const { session, role } = await getSessionRole();
  if (!session || !role || role === "client") return NextResponse.json({ success: false, error: "Unauthorized" }, { status: 401 });
  const { id } = await params;
  if (!mongoose.Types.ObjectId.isValid(id)) return NextResponse.json({ success: false, error: "Document invalide" }, { status: 400 });
  await connectDB();
  const doc = await StoredFile.findById(id).select("+data");
  if (!doc) return NextResponse.json({ success: false, error: "Document introuvable" }, { status: 404 });
  // Each kind of document follows the section it belongs to.
  const section = doc.purpose === "expense" ? "accounting" : doc.purpose === "inspection" || doc.purpose === "signature" ? "bookings" : "garage";
  if (!(await can(role, section, "view")) && !(await can(role, "accounting", "view"))) {
    return NextResponse.json({ success: false, error: "Accès limité : votre rôle ne permet pas cette action." }, { status: 403 });
  }
  return new NextResponse(new Uint8Array(doc.data), {
    headers: {
      "Content-Type": doc.contentType,
      "Content-Length": String(doc.size),
      "Content-Disposition": `inline; filename="${doc.filename.replace(/"/g, "")}"`,
      "Cache-Control": "private, no-store",
      "X-Content-Type-Options": "nosniff",
      "Content-Security-Policy": "default-src 'none'; style-src 'unsafe-inline'; img-src 'self' data:; object-src 'self'",
    },
  });
}
