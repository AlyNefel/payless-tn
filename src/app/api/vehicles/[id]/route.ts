import { NextRequest, NextResponse } from "next/server";
import connectDB from "@/lib/db";
import { Vehicle } from "@/models";
import { getVehicleStockAvailability, stockWithoutDates } from "@/lib/availability";
import { sanitizeVehicleForClient } from "@/lib/sanitize";
import { isStaffRequest } from "@/lib/apiAuth";
import mongoose from "mongoose";
import { applyRules, getRentalRules } from "@/lib/rentalRules";

export const dynamic = "force-dynamic";

export async function GET(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    await connectDB();
    const { id } = await params;

    if (!id || !mongoose.Types.ObjectId.isValid(id)) {
      return NextResponse.json({ success: false, error: "Invalid vehicle ID" }, { status: 400 });
    }

    const vehicle = await Vehicle.findById(id)
      .populate("categoryId")
      .populate("location")
      .lean();

    const staff = await isStaffRequest();
    const hidden = !vehicle || !vehicle.isActive || ["archived", "unavailable"].includes(vehicle.status);
    if (!vehicle || (hidden && !staff)) {
      return NextResponse.json({ success: false, error: "Vehicle not found" }, { status: 404 });
    }

    // Check optional dates in query for real-time stock availability
    const { searchParams } = new URL(request.url);
    const pickupDateStr = searchParams.get("pickupDate");
    const returnDateStr = searchParams.get("returnDate");

    let stockInfo = stockWithoutDates(vehicle as any);

    if (pickupDateStr && returnDateStr) {
      const pDate = new Date(pickupDateStr);
      const rDate = new Date(returnDateStr);
      if (!isNaN(pDate.getTime()) && !isNaN(rDate.getTime()) && rDate > pDate) {
        stockInfo = await getVehicleStockAvailability(id, pDate, rDate);
      }
    }

    // Check admin status
    const isAdmin = staff;

    const enrichedVehicle = {
      ...applyRules(vehicle as any, await getRentalRules(), pickupDateStr || undefined),
      totalUnits: stockInfo.totalUnits,
      availableUnits: stockInfo.availableUnits,
      bookedUnits: stockInfo.bookedUnits,
      isAvailable: stockInfo.isAvailable,
    };

    const finalVehicle = isAdmin ? enrichedVehicle : sanitizeVehicleForClient(enrichedVehicle);

    return NextResponse.json({
      success: true,
      vehicle: finalVehicle,
      data: finalVehicle,
    });
  } catch (error) {
    console.error("Error fetching vehicle by id:", error);
    return NextResponse.json(
      { success: false, error: "Failed to fetch vehicle" },
      { status: 500 }
    );
  }
}
