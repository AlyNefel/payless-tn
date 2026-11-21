import { NextRequest, NextResponse } from "next/server";
import { requirePermission } from "@/lib/permissions";
import { getDurationDiscounts, getGlobalMinRentalDays, getGlobalSeasons, normalizeDiscounts, normalizeSeasons, setDurationDiscounts, setGlobalMinRentalDays, setGlobalSeasons } from "@/lib/rentalRules";
import { logAudit } from "@/lib/audit";

export const dynamic = "force-dynamic";

export async function GET() {
  const guard = await requirePermission("pricing", "view");
  if (!guard.ok) return guard.response;
  return NextResponse.json({
    success: true,
    minRentalDaysGlobal: await getGlobalMinRentalDays(),
    seasons: await getGlobalSeasons(),
    durationDiscounts: await getDurationDiscounts(),
  });
}

/** Fleet-wide rules. Each field is optional: only what is sent is changed. Applied to the site at once. */
export async function PUT(request: NextRequest) {
  const guard = await requirePermission("pricing", "edit");
  if (!guard.ok) return guard.response;
  const body = await request.json().catch(() => ({}));
  const userId = guard.session.user?.id;
  // Periods and minimum durations are set per model (Tarifs par période → each car).
  if (body.seasons !== undefined || body.minRentalDaysGlobal !== undefined) {
    return NextResponse.json(
      { success: false, error: "Les périodes et la durée minimale se règlent maintenant par modèle de voiture.", code: "PER_MODEL" },
      { status: 410 }
    );
  }

  let seasons;
  if (body.seasons !== undefined) {
    const res = normalizeSeasons(body.seasons);
    if (res.error) return NextResponse.json({ success: false, error: res.error }, { status: 400 });
    seasons = res.seasons;
  }
  let tiers;
  if (body.durationDiscounts !== undefined) {
    const res = normalizeDiscounts(body.durationDiscounts);
    if (res.error) return NextResponse.json({ success: false, error: res.error }, { status: 400 });
    tiers = res.tiers;
  }
  if (body.minRentalDaysGlobal !== undefined) {
    const n = Number(body.minRentalDaysGlobal);
    if (!Number.isFinite(n) || n < 1 || n > 365) {
      return NextResponse.json({ success: false, error: "Valeur entre 1 et 365 jours." }, { status: 400 });
    }
    await setGlobalMinRentalDays(n, userId);
  }
  if (seasons) await setGlobalSeasons(seasons, userId);
  if (tiers) await setDurationDiscounts(tiers, userId);
  await logAudit(guard.session, "pricing.rules", "pricing", undefined, {
    after: {
      ...(body.minRentalDaysGlobal !== undefined ? { minRentalDaysGlobal: Number(body.minRentalDaysGlobal) } : {}),
      ...(seasons ? { seasons: seasons.map((x) => `${x.name} ${x.adjustPercent}% min ${x.minDays || 0}j${x.active === false ? " (off)" : ""}`) } : {}),
      ...(tiers ? { durationDiscounts: tiers.map((t) => `${t.minDays}j+ -${t.percent}%`) } : {}),
    },
  });

  return NextResponse.json({
    success: true,
    minRentalDaysGlobal: await getGlobalMinRentalDays(),
    seasons: await getGlobalSeasons(),
    durationDiscounts: await getDurationDiscounts(),
  });
}
