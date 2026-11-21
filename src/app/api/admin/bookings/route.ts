import { NextRequest, NextResponse } from "next/server";
import { connectDB } from "@/lib/db";
import { Booking, Vehicle, Customer, Location } from "@/models";
import { sanitizeQuery } from "@/lib/utils";
import { requirePermission } from "@/lib/permissions";
import { releaseBooking } from "@/lib/fleetUnits";

async function checkAdmin(level: string = "edit") {
  const guard = await requirePermission("bookings", level);
  return guard;
}

export async function GET(request: NextRequest) {
  const guard = await checkAdmin("view");
  if (!guard.ok) return guard.response;
  const session = guard.session;

  try {
    await connectDB();
    const { searchParams } = new URL(request.url);
    const search = searchParams.get("search");
    const status = searchParams.get("status");
    const fromDate = searchParams.get("from");
    const toDate = searchParams.get("to");
    /** pickup (default) | return | created | overlap (rentals running at some point of the period). */
    const dateField = searchParams.get("dateField") || "pickup";
    const sortParam = searchParams.get("sort") || "created_desc";
    const page = parseInt(searchParams.get("page") || "1");
    const limit = Math.min(200, Math.max(1, parseInt(searchParams.get("limit") || "100", 10) || 100));

    const query: Record<string, unknown> = {};

    const and: Record<string, unknown>[] = [];

    if (search) {
      const q = sanitizeQuery(search);
      // Find matching customers first
      const matchedCustomers = await Customer.find({
        $or: [
          { firstName: { $regex: q, $options: "i" } },
          { lastName: { $regex: q, $options: "i" } },
          { email: { $regex: q, $options: "i" } },
          { phone: { $regex: q, $options: "i" } },
        ],
      }).select("_id");
      const customerIds = matchedCustomers.map((c) => c._id);

      // Find matching vehicles
      const matchedVehicles = await Vehicle.find({
        $or: [
          { brand: { $regex: q, $options: "i" } },
          { model: { $regex: q, $options: "i" } },
          { licensePlate: { $regex: q, $options: "i" } },
        ],
      }).select("_id");
      const vehicleIds = matchedVehicles.map((v) => v._id);

      and.push({
        $or: [
          { bookingReference: { $regex: q, $options: "i" } },
          { customerId: { $in: customerIds } },
          { vehicleId: { $in: vehicleIds } },
          { "vehicles.vehicleId": { $in: vehicleIds } },
          // Plates live on the physical cars assigned to the booking.
          { "assignedUnits.licensePlate": { $regex: q, $options: "i" } },
          { "contract.number": { $regex: q, $options: "i" } },
          { invoiceNumber: { $regex: q, $options: "i" } },
        ],
      });
    }
    // Period filter, by day (inclusive), on the chosen date.
    const day = /^\d{4}-\d{2}-\d{2}/;
    const from = fromDate && day.test(fromDate) ? new Date(`${fromDate.slice(0, 10)}T00:00:00.000Z`) : null;
    const to = toDate && day.test(toDate) ? new Date(`${toDate.slice(0, 10)}T23:59:59.999Z`) : null;
    if (from || to) {
      if (dateField === "overlap") {
        // Rentals that are running at some point of the period (started before its end, end after its start).
        if (to) and.push({ pickupDate: { $lte: to } });
        if (from) and.push({ returnDate: { $gte: from } });
      } else {
        const field = dateField === "return" ? "returnDate" : dateField === "created" ? "createdAt" : "pickupDate";
        and.push({ [field]: { ...(from ? { $gte: from } : {}), ...(to ? { $lte: to } : {}) } });
      }
    }

    // Counts per status for the tabs: same search and period, every status.
    const baseQuery: Record<string, unknown> = and.length ? { $and: [...and] } : {};
    if (status && status !== "All") {
      const st = status.toLowerCase();
      and.push(
        st === "cancelled"
          ? { bookingStatus: { $in: ["cancelled", "rejected"] } }
          : st === "confirmed"
            ? { bookingStatus: { $in: ["confirmed", "awaiting_payment", "paid"] } }
            : { bookingStatus: st }
      );
    }
    // Combine filters with $and so status and search no longer overwrite each other.
    if (and.length) query.$and = and;

    const [rawBookings, total] = await Promise.all([
      // Only the fields the list needs (vehicles carry their whole fleet of plates otherwise).
      Booking.find(query)
        .select("-auditHistory")
        .populate("vehicleId", "brand model year images licensePlate")
        .populate("vehicles.vehicleId", "brand model")
        .populate("customerId", "firstName lastName email phone")
        .populate("pickupLocationId", "name city")
        .populate("returnLocationId", "name city")
        .sort(
          sortParam === "pickup_asc"
            ? { pickupDate: 1, _id: 1 }
            : sortParam === "pickup_desc"
              ? { pickupDate: -1, _id: -1 }
              : sortParam === "return_asc"
                ? { returnDate: 1, _id: 1 }
                : { createdAt: -1, _id: -1 }
        )
        .skip((page - 1) * limit)
        .limit(limit)
        .lean(),
      Booking.countDocuments(query),
    ]);
    const statusRows = await Booking.aggregate<{ _id: string; n: number; amount: number }>([
      { $match: baseQuery },
      { $group: { _id: "$bookingStatus", n: { $sum: 1 }, amount: { $sum: "$pricingBreakdown.totalAmount" } } },
    ]);
    const counts: Record<string, number> = { All: 0, pending: 0, confirmed: 0, active: 0, completed: 0, cancelled: 0 };
    let periodAmount = 0;
    for (const r of statusRows) {
      counts.All += r.n;
      const k = r._id === "rejected" ? "cancelled" : r._id === "awaiting_payment" || r._id === "paid" ? "confirmed" : r._id;
      counts[k] = (counts[k] || 0) + r.n;
      if (!["cancelled", "rejected"].includes(r._id)) periodAmount += r.amount || 0;
    }

    // Format bookings with friendly normalized properties
    const bookings = rawBookings.map((b: any) => {
      const cust = b.customerId;
      const veh = b.vehicleId;
      const pLoc = b.pickupLocationId;
      const rLoc = b.returnLocationId;

      const multiVehName = b.vehicles?.length
        ? b.vehicles
            .map((v: any) => `${v.brand || v.vehicleId?.brand || ""} ${v.model || v.vehicleId?.model || ""}`.trim())
            .filter(Boolean)
            .join(" + ")
        : "";

      return {
        id: b._id.toString(),
        _id: b._id.toString(),
        reference: b.bookingReference,
        bookingReference: b.bookingReference,
        status: b.bookingStatus || "pending",
        bookingStatus: b.bookingStatus || "pending",
        paymentStatus: b.paymentStatus || "unpaid",
        customerName: cust ? `${cust.firstName || ""} ${cust.lastName || ""}`.trim() : "Client Payless",
        customerPhone: cust?.phone || "",
        customerEmail: cust?.email || "",
        vehicles: b.vehicles || [],
        vehicleId: veh?._id?.toString() || (typeof b.vehicleId === "string" ? b.vehicleId : ""),
        vehicleName: multiVehName || (veh ? `${veh.brand} ${veh.model}` : "Véhicule"),
        licensePlate: (b.assignedUnits || []).filter((u: any) => !u.to).map((u: any) => u.licensePlate || "immat. à saisir").join(", "),
        vehicleImage: veh?.images?.find((i: any) => i.isPrimary)?.url || veh?.images?.[0]?.url || "",
        pickupDate: b.pickupDate ? new Date(b.pickupDate).toISOString().split("T")[0] : "",
        returnDate: b.returnDate ? new Date(b.returnDate).toISOString().split("T")[0] : "",
        rentalDuration: b.rentalDuration || 1,
        pickupLocation: pLoc?.name?.fr || pLoc?.name?.en || pLoc?.city || "Aéroport Tunis-Carthage",
        returnLocation: rLoc?.name?.fr || rLoc?.name?.en || rLoc?.city || "Aéroport Tunis-Carthage",
        totalAmount: b.pricingBreakdown?.totalAmount || 0,
        currency: b.pricingBreakdown?.currency || "TND",
        dailyRate: b.pricingBreakdown?.dailyRate || 0,
        timbreFiscal: b.pricingBreakdown?.timbreFiscal ?? 100,
        contributionLF2026: b.pricingBreakdown?.contributionLF2026 ?? (200 * (b.rentalDuration || 1)),
        outOfTownFee: b.pricingBreakdown?.outOfTownFee || 0,
        depositAmount: b.pricingBreakdown?.depositAmount || 0,
        extras: (b.extras || []).filter((e: any) => (e.quantity || 0) > 0),
        pickupTime: b.pickupTime || "",
        returnTime: b.returnTime || "",
        customerNotes: b.customerNotes || "",
        isManualBooking: Boolean(b.isManualBooking),
        pickupMileage: b.pickupMileage ?? null,
        returnMileage: b.returnMileage ?? null,
        internalNotes: b.internalNotes || "",
        hasCar: (b.assignedUnits || []).some((u: any) => u.unitId && !u.to),
        carChanged: (b.vehicleChanges || []).length > 0,
        amountPaid: b.amountPaid || 0,
        depositHeld: b.depositHeld || 0,
        depositDue: b.pricingBreakdown?.depositAmount || 0,
        contractNumber: b.contract?.number || "",
        invoiceNumber: b.invoiceNumber || "",
        hasPickupInspection: Boolean(b.pickupInspection?.at),
        hasReturnInspection: Boolean(b.returnInspection?.at),
        customerLanguage: b.customerLanguage || "fr",
        createdAt: b.createdAt,
      };
    });

    return NextResponse.json({ success: true, bookings, total, page, limit, counts, periodAmount });
  } catch (error) {
    console.error("GET /api/admin/bookings error:", error);
    return NextResponse.json({ error: "Failed to fetch bookings" }, { status: 500 });
  }
}

export async function DELETE(request: NextRequest) {
  const guard = await checkAdmin("delete");
  if (!guard.ok) return guard.response;
  const session = guard.session;

  try {
    await connectDB();
    const { searchParams } = new URL(request.url);
    let id = searchParams.get("id");

    if (!id) {
      const body = await request.json().catch(() => ({}));
      id = body.id;
    }

    if (!id) {
      return NextResponse.json({ error: "Booking ID is required" }, { status: 400 });
    }

    const booking = await Booking.findById(id);
    if (!booking) {
      return NextResponse.json({ error: "Booking not found" }, { status: 404 });
    }

    // If vehicle was assigned and booking was active/confirmed, restore vehicle availability
    if (["confirmed", "active", "pending"].includes(booking.bookingStatus)) {
      if (booking.vehicles && booking.vehicles.length > 0) {
        for (const item of booking.vehicles) {
          const vId = item.vehicleId;
          if (vId) {
            await Vehicle.findByIdAndUpdate(vId, {
              $inc: { availableUnits: 1 },
            }).catch(() => {});
          }
        }
      } else if (booking.vehicleId) {
        await Vehicle.findByIdAndUpdate(booking.vehicleId, {
          $inc: { availableUnits: 1 },
        }).catch(() => {});
      }
    }

    await Booking.findByIdAndDelete(id);
    await releaseBooking(id);

    return NextResponse.json({
      success: true,
      message: `Réservation ${booking.bookingReference || id} supprimée définitivement avec succès.`,
    });
  } catch (error) {
    console.error("DELETE /api/admin/bookings error:", error);
    return NextResponse.json({ error: "Failed to delete booking" }, { status: 500 });
  }
}
