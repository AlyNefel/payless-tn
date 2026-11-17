import { NextRequest, NextResponse } from "next/server";
import { requirePermission } from "@/lib/permissions";
import { periodFromQuery } from "@/lib/ledger";
import { buildSummary } from "@/lib/accountingReport";

export const dynamic = "force-dynamic";

export async function GET(request: NextRequest) {
  const guard = await requirePermission("accounting", "view");
  if (!guard.ok) return guard.response;
  const sp = new URL(request.url).searchParams;
  const { from, to, fromStr, toStr } = periodFromQuery(sp.get("from"), sp.get("to"));
  if (to < from) return NextResponse.json({ success: false, error: "Période invalide" }, { status: 400 });
  try {
    return NextResponse.json({ success: true, summary: await buildSummary(from, to, fromStr, toStr) });
  } catch (err) {
    console.error("accounting summary:", err);
    return NextResponse.json({ success: false, error: "Calcul impossible" }, { status: 500 });
  }
}
