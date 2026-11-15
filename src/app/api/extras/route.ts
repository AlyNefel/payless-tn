import { NextResponse } from "next/server";
import connectDB from "@/lib/db";
import Extra from "@/models/Extra";
import { normalizePricingType } from "@/lib/extras";

export const dynamic = "force-dynamic";

/**
 * Active rental options for the booking wizard.
 * No hardcoded fallback list: fake ids would be shown & priced in the UI but silently
 * ignored by the booking API, producing totals that differ from the invoice.
 */
export async function GET() {
  try {
    await connectDB();
    const extras = await Extra.find({ isActive: true })
      .select("name description icon price pricingType maxQuantity order selectionMode amountMin amountMax amountStep")
      .sort({ order: 1, price: 1 })
      .lean();

    return NextResponse.json(
      {
        success: true,
        extras: extras.map((e) => ({
          ...e,
          _id: String(e._id),
          pricingType: normalizePricingType(e.pricingType),
        })),
      },
      // Short cache: an option hidden by the admin must disappear from the site within seconds.
      { headers: { "Cache-Control": "public, s-maxage=5, stale-while-revalidate=10" } }
    );
  } catch (error) {
    console.error("Error fetching extras:", error);
    return NextResponse.json({ success: false, error: "Failed to fetch extras", extras: [] }, { status: 500 });
  }
}
