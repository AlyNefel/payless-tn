import { NextRequest, NextResponse } from "next/server";
import connectDB from "@/lib/db";
import { Customer } from "@/models";
import { escapeRegex } from "@/lib/apiAuth";
import mongoose from "mongoose";
import { requireStaff } from "@/lib/apiAuth";

export async function GET(request: NextRequest) {
  const guard = await requireStaff();
  if (!guard.ok) return guard.response;

  try {
    await connectDB();
    const { searchParams } = new URL(request.url);
    const search = searchParams.get("search");
    const page = parseInt(searchParams.get("page") || "1");
    const limit = parseInt(searchParams.get("limit") || "30");
    const isBlacklisted = searchParams.get("isBlacklisted");

    const query: Record<string, unknown> = {};

    if (search) {
      const q = escapeRegex(search);
      query.$or = [
        { firstName: { $regex: q, $options: "i" } },
        { lastName: { $regex: q, $options: "i" } },
        { email: { $regex: q, $options: "i" } },
        { phone: { $regex: q, $options: "i" } },
        { city: { $regex: q, $options: "i" } },
      ];
    }

    if (isBlacklisted === "true") query.isBlacklisted = true;
    else if (isBlacklisted === "false") query.isBlacklisted = false;

    const [customers, total] = await Promise.all([
      Customer.find(query)
        .sort({ totalSpent: -1 })
        .skip((page - 1) * limit)
        .limit(limit)
        .lean(),
      Customer.countDocuments(query),
    ]);

    return NextResponse.json({ success: true, customers, total, page, limit });
  } catch (error) {
    console.error("GET /api/admin/customers error:", error);
    return NextResponse.json(
      { success: false, error: "Failed to fetch customers" },
      { status: 500 }
    );
  }
}

export async function PATCH(request: NextRequest) {
  const guard = await requireStaff();
  if (!guard.ok) return guard.response;

  try {
    await connectDB();
    const body = await request.json();
    const { id, ...raw } = body;
    if (!id || !mongoose.Types.ObjectId.isValid(String(id))) {
      return NextResponse.json({ success: false, error: "Missing id" }, { status: 400 });
    }

    // Whitelist editable fields (no mass assignment of userId, totals, etc.).
    const EDITABLE = ["firstName", "lastName", "phone", "email", "city", "address", "country", "isBlacklisted", "isVip", "notes", "tags", "preferredLanguage"];
    const updates = Object.fromEntries(Object.entries(raw).filter(([k]) => EDITABLE.includes(k)));

    const customer = await Customer.findByIdAndUpdate(id, { $set: updates }, { returnDocument: "after" }).lean();
    return NextResponse.json({ success: true, customer });
  } catch (error) {
    console.error("PATCH /api/admin/customers error:", error);
    return NextResponse.json({ success: false, error: "Failed to update customer" }, { status: 500 });
  }
}
