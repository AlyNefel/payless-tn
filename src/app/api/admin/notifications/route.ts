import { NextRequest, NextResponse } from "next/server";
import mongoose from "mongoose";
import { z } from "zod";
import connectDB from "@/lib/db";
import { Notification } from "@/models";
import { requireStaff } from "@/lib/apiAuth";
import { notifyStaff, runFleetAlerts } from "@/lib/notify";
import { requirePermission } from "@/lib/permissions";

export const dynamic = "force-dynamic";

/** Notifications visible now: not scheduled, or scheduled in the past. */
const visibleNow = () => ({ hidden: { $ne: true }, $or: [{ scheduledFor: { $exists: false } }, { scheduledFor: null }, { scheduledFor: { $lte: new Date() } }] });

export async function GET(request: NextRequest) {
  const guard = await requirePermission("notifications", "view");
  if (!guard.ok) return guard.response;

  try {
    await connectDB();
    const { searchParams } = new URL(request.url);
    const page = Math.max(1, parseInt(searchParams.get("page") || "1", 10) || 1);
    const limit = Math.min(200, Math.max(1, parseInt(searchParams.get("limit") || "50", 10) || 50));
    const unreadOnly = searchParams.get("unreadOnly") === "true";
    const since = searchParams.get("since");
    const scheduled = searchParams.get("scheduled") === "true";

    // Fleet / booking alerts are generated lazily (throttled + deduplicated) on polling.
    await runFleetAlerts().catch((e) => console.error("runFleetAlerts:", e));

    const query: Record<string, unknown> = scheduled
      ? { scheduledFor: { $gt: new Date() } }
      : visibleNow();
    if (unreadOnly) query.isRead = false;
    if (since && !Number.isNaN(Date.parse(since))) {
      // A reminder becomes "new" when its scheduled time is reached, not when it was written.
      query.$and = [
        { $or: [{ createdAt: { $gt: new Date(since) } }, { scheduledFor: { $gt: new Date(since), $lte: new Date() } }] },
      ];
    }

    const [notifications, total, unreadCount] = await Promise.all([
      Notification.find(query)
        .sort({ createdAt: -1 })
        .skip((page - 1) * limit)
        .limit(limit)
        .lean(),
      Notification.countDocuments(query),
      Notification.countDocuments({ ...visibleNow(), isRead: false }),
    ]);

    return NextResponse.json({
      success: true,
      notifications,
      total,
      unreadCount,
      page,
      limit,
      serverTime: new Date().toISOString(),
    });
  } catch (error) {
    console.error("GET /api/admin/notifications error:", error);
    return NextResponse.json({ success: false, error: "Failed to fetch notifications" }, { status: 500 });
  }
}

const reminderSchema = z.object({
  title: z.string().trim().min(2).max(160),
  message: z.string().trim().max(1000).optional().default(""),
  scheduledFor: z.string().optional(),
  severity: z.enum(["info", "warning", "critical"]).optional().default("info"),
  licensePlate: z.string().trim().max(30).optional(),
  link: z.string().max(300).optional(),
});

/** Custom reminder written by the team (e.g. "Car 123 TU 4567: change tyres"), optionally scheduled. */
export async function POST(request: NextRequest) {
  const guard = await requirePermission("notifications", "edit");
  if (!guard.ok) return guard.response;

  const parsed = reminderSchema.safeParse(await request.json().catch(() => ({})));
  if (!parsed.success) {
    return NextResponse.json({ success: false, error: "Titre requis (2 caractères min.)" }, { status: 400 });
  }
  const d = parsed.data;
  const when = d.scheduledFor && !Number.isNaN(Date.parse(d.scheduledFor)) ? new Date(d.scheduledFor) : undefined;
  const title = d.licensePlate ? `${d.title} — ${d.licensePlate.toUpperCase()}` : d.title;
  const ok = await notifyStaff({
    type: "custom_reminder",
    category: "reminder",
    severity: d.severity,
    title: { fr: title, en: title, ar: title },
    message: { fr: d.message || title, en: d.message || title, ar: d.message || title },
    link: d.link?.startsWith("/admin") ? d.link : undefined,
    scheduledFor: when && when > new Date() ? when : undefined,
    createdBy: guard.session.user?.email || undefined,
    data: d.licensePlate ? { licensePlate: d.licensePlate.toUpperCase() } : undefined,
  });
  return NextResponse.json({ success: ok }, { status: ok ? 201 : 500 });
}

export async function PATCH(request: NextRequest) {
  const guard = await requirePermission("notifications", "edit");
  if (!guard.ok) return guard.response;

  try {
    await connectDB();
    const body = await request.json().catch(() => ({}));
    if (body.markAllRead) {
      await Notification.updateMany({ ...visibleNow(), isRead: false }, { $set: { isRead: true, readAt: new Date() } });
    } else if (body.id && mongoose.Types.ObjectId.isValid(body.id)) {
      const isRead = body.isRead ?? true;
      await Notification.findByIdAndUpdate(body.id, isRead
        ? { $set: { isRead: true, readAt: new Date() } }
        : { $set: { isRead: false }, $unset: { readAt: 1 } });
    } else {
      return NextResponse.json({ success: false, error: "id requis" }, { status: 400 });
    }
    return NextResponse.json({ success: true });
  } catch (error) {
    console.error("PATCH /api/admin/notifications error:", error);
    return NextResponse.json({ success: false }, { status: 500 });
  }
}

export async function DELETE(request: NextRequest) {
  const guard = await requirePermission("notifications", "edit");
  if (!guard.ok) return guard.response;

  try {
    await connectDB();
    const body = await request.json().catch(() => ({}));
    if (body.deleteReadAll) {
      // Alerts keep their dedupe key on purpose (soft-hide would re-trigger them otherwise):
      // only notifications without a key, or whose condition is past, are physically removed.
      await Notification.deleteMany({ isRead: true, dedupeKey: { $exists: false } });
      await Notification.updateMany({ isRead: true, dedupeKey: { $exists: true } }, { $set: { hidden: true } });
    } else if (body.id && mongoose.Types.ObjectId.isValid(body.id)) {
      const n = await Notification.findById(body.id).select("dedupeKey").lean();
      if (n?.dedupeKey) {
        await Notification.findByIdAndUpdate(body.id, { $set: { hidden: true, isRead: true } });
      } else {
        await Notification.findByIdAndDelete(body.id);
      }
    } else {
      return NextResponse.json({ success: false, error: "id requis" }, { status: 400 });
    }
    return NextResponse.json({ success: true });
  } catch (error) {
    console.error("DELETE /api/admin/notifications error:", error);
    return NextResponse.json({ success: false }, { status: 500 });
  }
}
