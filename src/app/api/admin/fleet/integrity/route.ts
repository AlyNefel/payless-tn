import { NextResponse } from "next/server";
import { requirePermission } from "@/lib/permissions";
import { auditAssignments, ensureHoldsBackfilled, repairAssignments } from "@/lib/fleetUnits";

export const dynamic = "force-dynamic";

/** Read-only audit: same car on overlapping bookings, orphan assignments, bookings without a car. */
export async function GET() {
  const guard = await requirePermission("fleet", "view");
  if (!guard.ok) return guard.response;
  await ensureHoldsBackfilled();
  return NextResponse.json({ success: true, report: await auditAssignments() });
}

/** Repairs assignments (oldest booking keeps its car, the others get another free car). */
export async function POST() {
  const guard = await requirePermission("fleet", "edit");
  if (!guard.ok) return guard.response;
  await ensureHoldsBackfilled();
  const report = await repairAssignments();
  return NextResponse.json({ success: true, report, after: await auditAssignments() });
}
