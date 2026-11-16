import { NextResponse } from "next/server";
import { getRentalRules } from "@/lib/rentalRules";

export const dynamic = "force-dynamic";

/** Public, never cached: the date pickers read the fleet-wide rules before any car is chosen. */
export async function GET() {
  const rules = await getRentalRules();
  return NextResponse.json(
    { success: true, ...rules },
    { headers: { "Cache-Control": "no-store, no-cache, must-revalidate, max-age=0" } }
  );
}
