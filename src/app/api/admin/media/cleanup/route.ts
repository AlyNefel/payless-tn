import { NextRequest, NextResponse } from "next/server";
import connectDB from "@/lib/db";
import { Extra, Vehicle } from "@/models";
import { requirePermission } from "@/lib/permissions";
import { deleteImages, listPendingUploads } from "@/lib/cloudinary";

export const dynamic = "force-dynamic";

/**
 * Deletes Cloudinary uploads that were never attached to a vehicle/option
 * (tag "pending", older than 24h, not referenced in the database).
 * Callable by a manager, or by Vercel Cron with `Authorization: Bearer $CRON_SECRET`.
 */
async function run() {
  const candidates = await listPendingUploads(24);
  if (!candidates.length) return { scanned: 0, deleted: [] as string[], failed: [] as string[] };

  await connectDB();
  const [vehicles, options] = await Promise.all([
    Vehicle.find({ "images.publicId": { $in: candidates } }).select("images.publicId").lean(),
    Extra.find({ iconPublicId: { $in: candidates } }).select("iconPublicId").lean(),
  ]);
  const referenced = new Set<string>([
    ...vehicles.flatMap((v) => (v.images || []).map((i) => i.publicId)),
    ...options.map((o) => String((o as { iconPublicId?: string }).iconPublicId || "")),
  ]);
  const orphans = candidates.filter((id) => !referenced.has(id));
  const result = await deleteImages(orphans);
  return { scanned: candidates.length, ...result };
}

export async function GET(request: NextRequest) {
  const cronSecret = process.env.CRON_SECRET;
  const isCron = Boolean(cronSecret) && request.headers.get("authorization") === `Bearer ${cronSecret}`;
  if (!isCron) {
    const guard = await requirePermission("media", "delete");
    if (!guard.ok) return guard.response;
  }
  try {
    return NextResponse.json({ success: true, ...(await run()) });
  } catch (error) {
    console.error("Media cleanup failed:", error);
    return NextResponse.json({ success: false, error: "Cleanup failed" }, { status: 500 });
  }
}
