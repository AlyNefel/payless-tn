import { NextResponse } from "next/server";
import { seedDatabase } from "@/lib/seed";
import { requireSuperadmin } from "@/lib/apiAuth";
import connectDB from "@/lib/db";
import { User } from "@/models";

export const dynamic = "force-dynamic";

/**
 * Database seeding is a destructive maintenance operation.
 *
 * - Disabled in production unless ALLOW_SEED=true is set explicitly.
 * - Requires a superadmin session, except for the very first run on an
 *   empty database (bootstrap), which additionally requires SEED_TOKEN.
 * - GET is not allowed: seeding must never be triggered by a crawler or a link preview.
 */
export async function POST(request: Request) {
  if (process.env.NODE_ENV === "production" && process.env.ALLOW_SEED !== "true") {
    return NextResponse.json({ success: false, error: "Seeding is disabled in production." }, { status: 403 });
  }

  await connectDB();
  const userCount = await User.countDocuments();

  if (userCount > 0) {
    const guard = await requireSuperadmin();
    if (!guard.ok) return guard.response;
  } else {
    const expected = process.env.SEED_TOKEN;
    const provided = request.headers.get("x-seed-token");
    if (!expected || provided !== expected) {
      return NextResponse.json(
        { success: false, error: "Bootstrap seeding requires the SEED_TOKEN header." },
        { status: 401 }
      );
    }
  }

  try {
    const result = await seedDatabase();
    return NextResponse.json(result, { status: 200 });
  } catch (error) {
    console.error("Database seed failed:", error);
    return NextResponse.json({ success: false, error: "Failed to seed database" }, { status: 500 });
  }
}

export async function GET() {
  return NextResponse.json({ success: false, error: "Method not allowed. Use POST." }, { status: 405 });
}
