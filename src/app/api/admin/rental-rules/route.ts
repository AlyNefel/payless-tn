import { NextRequest, NextResponse } from "next/server";
import { requirePermission } from "@/lib/permissions";
import { getGlobalMinRentalDays, getGlobalSeasons, normalizeSeasons, setGlobalMinRentalDays, setGlobalSeasons } from "@/lib/rentalRules";

export const dynamic = "force-dynamic";

export async function GET() {
  const guard = await requirePermission("pricing", "view");
  if (!guard.ok) return guard.response;
  return NextResponse.json({
    success: true,
    minRentalDaysGlobal: await getGlobalMinRentalDays(),
    seasons: await getGlobalSeasons(),
  });
}

/** Fleet-wide rules. Each field is optional: only what is sent is changed. Applied to the site at once. */
export async function PUT(request: NextRequest) {
  const guard = await requirePermission("pricing", "edit");
  if (!guard.ok) return guard.response;
  const body = await request.json().catch(() => ({}));
  const userId = guard.session.user?.id;

  let seasons;
  if (body.seasons !== undefined) {
    const res = normalizeSeasons(body.seasons);
    if (res.error) return NextResponse.json({ success: false, error: res.error }, { status: 400 });
    seasons = res.seasons;
  }
  if (body.minRentalDaysGlobal !== undefined) {
    const n = Number(body.minRentalDaysGlobal);
    if (!Number.isFinite(n) || n < 1 || n > 365) {
      return NextResponse.json({ success: false, error: "Valeur entre 1 et 365 jours." }, { status: 400 });
    }
    await setGlobalMinRentalDays(n, userId);
  }
  if (seasons) await setGlobalSeasons(seasons, userId);

  return NextResponse.json({
    success: true,
    minRentalDaysGlobal: await getGlobalMinRentalDays(),
    seasons: await getGlobalSeasons(),
  });
}
