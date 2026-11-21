import { NextRequest, NextResponse } from "next/server";
import { requirePermission } from "@/lib/permissions";
import { runReminders } from "@/lib/reminders";

export const dynamic = "force-dynamic";

/**
 * Day-before customer reminders. Called by Vercel Cron with `Authorization: Bearer $CRON_SECRET`
 * (see vercel.json), or manually by a manager.
 */
export async function GET(request: NextRequest) {
  const secret = process.env.CRON_SECRET;
  const isCron = Boolean(secret) && request.headers.get("authorization") === `Bearer ${secret}`;
  if (!isCron) {
    const guard = await requirePermission("notifications", "edit");
    if (!guard.ok) return guard.response;
  }
  try {
    return NextResponse.json({ success: true, ...(await runReminders()) });
  } catch (err) {
    console.error("cron reminders:", err);
    return NextResponse.json({ success: false, error: "Rappels impossibles" }, { status: 500 });
  }
}
