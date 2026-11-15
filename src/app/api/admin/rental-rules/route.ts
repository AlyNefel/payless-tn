import { NextRequest, NextResponse } from "next/server";
import { requirePermission } from "@/lib/permissions";
import { getGlobalMinRentalDays, setGlobalMinRentalDays } from "@/lib/rentalRules";

export const dynamic = "force-dynamic";

export async function GET() {
  const guard = await requirePermission("pricing", "view");
  if (!guard.ok) return guard.response;
  return NextResponse.json({ success: true, minRentalDaysGlobal: await getGlobalMinRentalDays() });
}

export async function PUT(request: NextRequest) {
  const guard = await requirePermission("pricing", "edit");
  if (!guard.ok) return guard.response;
  const body = await request.json().catch(() => ({}));
  const n = Number(body.minRentalDaysGlobal);
  if (!Number.isFinite(n) || n < 1 || n > 365) {
    return NextResponse.json({ success: false, error: "Valeur entre 1 et 365 jours." }, { status: 400 });
  }
  const value = await setGlobalMinRentalDays(n, guard.session.user?.id);
  return NextResponse.json({ success: true, minRentalDaysGlobal: value });
}
