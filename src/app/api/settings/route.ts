import { NextResponse } from "next/server";
import { getPublicSettings } from "@/lib/publicSettings";

export const dynamic = "force-dynamic";

/**
 * Public agency settings (contact details, fiscal constants, payment methods).
 * Only allowlisted keys are returned — see lib/publicSettings.ts.
 */
export async function GET() {
  try {
    const settings = await getPublicSettings();
    return NextResponse.json(
      { success: true, settings },
      {
        headers: {
          // Short shared cache: settings change rarely, and admin saves push updates client-side.
          "Cache-Control": "public, s-maxage=60, stale-while-revalidate=300",
        },
      }
    );
  } catch (error) {
    console.error("GET /api/settings error:", error);
    return NextResponse.json({ success: false, error: "Failed to fetch settings" }, { status: 500 });
  }
}
