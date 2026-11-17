import { NextRequest, NextResponse } from "next/server";
import connectDB from "@/lib/db";
import { requirePermission } from "@/lib/permissions";
import { AuditLog } from "@/models";
import { periodFromQuery } from "@/lib/ledger";

export const dynamic = "force-dynamic";

/** Audit journal: who did what. Read-only — there is no way to edit or delete a line. */
export async function GET(request: NextRequest) {
  const guard = await requirePermission("audit", "view");
  if (!guard.ok) return guard.response;
  await connectDB();
  const sp = new URL(request.url).searchParams;
  const now = new Date();
  const monthAgo = new Date(now.getTime() - 30 * 86_400_000).toISOString().slice(0, 10);
  const { from, to, fromStr, toStr } = periodFromQuery(sp.get("from") || monthAgo, sp.get("to") || now.toISOString().slice(0, 10));
  const filter: Record<string, unknown> = { createdAt: { $gte: from, $lte: to } };
  if (sp.get("user")) filter.userEmail = sp.get("user");
  if (sp.get("resource")) filter.resource = sp.get("resource");
  const q = (sp.get("q") || "").trim();
  if (q) {
    const rx = new RegExp(q.replace(/[.*+?^${}()|[\]\\]/g, "\\$&"), "i");
    filter.$or = [{ action: rx }, { userEmail: rx }, { resourceId: rx }];
  }
  const [logs, users, resources] = await Promise.all([
    AuditLog.find(filter).sort({ createdAt: -1 }).limit(500).lean(),
    AuditLog.distinct("userEmail"),
    AuditLog.distinct("resource"),
  ]);
  return NextResponse.json({ success: true, period: { from: fromStr, to: toStr }, logs, users, resources });
}
