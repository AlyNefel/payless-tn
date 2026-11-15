import { NextRequest, NextResponse } from "next/server";
import { requireManager, requireStaff } from "@/lib/apiAuth";
import { getAlertSettings, runFleetAlerts, saveAlertSettings } from "@/lib/notify";
import { requirePermission } from "@/lib/permissions";

export const dynamic = "force-dynamic";

export async function GET() {
  const guard = await requirePermission("notifications", "view");
  if (!guard.ok) return guard.response;
  return NextResponse.json({ success: true, settings: await getAlertSettings() });
}

export async function PUT(request: NextRequest) {
  const guard = await requirePermission("notifications", "edit");
  if (!guard.ok) return guard.response;
  const body = await request.json().catch(() => ({}));
  const settings = await saveAlertSettings(body, guard.session.user?.id);
  runFleetAlerts({ force: true }).catch(() => {});
  return NextResponse.json({ success: true, settings });
}
