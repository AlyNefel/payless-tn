import { NextRequest, NextResponse } from "next/server";
import connectDB from "@/lib/db";
import { Vehicle, VehicleCategory } from "@/models";
import { getFleetStockMap, stockWithoutDates } from "@/lib/availability";
import { sanitizeVehicleForClient } from "@/lib/sanitize";
import { escapeRegex, isStaffRequest } from "@/lib/apiAuth";
import mongoose from "mongoose";
import { applyRules, getRentalRules, migrateGlobalPricingToModels } from "@/lib/rentalRules";
import { calculateSeasonalRentalTotal, getVehicleEffectiveDailyRate, pricingPeriodName } from "@/lib/seasonalPricing";

export const dynamic = "force-dynamic";

/** Vehicles visible on the public site (archived / withdrawn cars are hidden). */
const PUBLIC_VEHICLE_FILTER = { isActive: true, status: { $nin: ["archived", "unavailable"] } };

export async function GET(request: NextRequest) {
  try {
    await connectDB();

    const { searchParams } = new URL(request.url);

    // Check if requester is authenticated admin
    const isAdmin = await isStaffRequest();
    const visibility = isAdmin ? {} : PUBLIC_VEHICLE_FILTER;

    // Old fleet-wide rules are copied into the models before any car is read.
    await migrateGlobalPricingToModels();
    const vehicleId = searchParams.get("vehicleId") || searchParams.get("id");
    const brandParam = searchParams.get("brand");
    const modelParam = searchParams.get("model");

    if (vehicleId || (brandParam && modelParam)) {
      let singleVehicle: any = null;
      if (vehicleId && mongoose.Types.ObjectId.isValid(vehicleId)) {
        singleVehicle = await Vehicle.findOne({ _id: vehicleId, ...visibility })
          .populate("categoryId")
          .populate("location")
          .lean();
      }

      if (!singleVehicle && vehicleId) {
        // Try finding by slug, or matching model name from ID like "car-suzuki-swift-bva"
        const cleanModel = escapeRegex(vehicleId.replace(/^car-/, "").replace(/-/g, " "));
        singleVehicle = await Vehicle.findOne({
          ...visibility,
          $or: [
            { slug: vehicleId },
            { model: { $regex: cleanModel, $options: "i" } },
            ...(brandParam && modelParam
              ? [{ brand: { $regex: escapeRegex(brandParam), $options: "i" }, model: { $regex: escapeRegex(modelParam), $options: "i" } }]
              : []),
          ],
        })
          .populate("categoryId")
          .populate("location")
          .lean();
      }

      if (!singleVehicle && brandParam && modelParam) {
        singleVehicle = await Vehicle.findOne({
          ...visibility,
          brand: { $regex: `^${escapeRegex(brandParam)}$`, $options: "i" },
          model: { $regex: `^${escapeRegex(modelParam)}$`, $options: "i" },
        })
          .populate("categoryId")
          .populate("location")
          .lean();
      }

      if (singleVehicle) {
        const finalDoc = isAdmin ? singleVehicle : sanitizeVehicleForClient(singleVehicle);
        return NextResponse.json({
          success: true,
          vehicle: finalDoc,
          vehicles: [finalDoc],
          data: [finalDoc],
          total: 1,
        });
      }
    }

    const categoryParam = searchParams.get("category");
    const transmission = searchParams.get("transmission");
    const fuelType = searchParams.get("fuelType");
    const seats = searchParams.get("seats");
    const minPrice = searchParams.get("minPrice");
    const maxPrice = searchParams.get("maxPrice");
    const pickupDate = searchParams.get("pickupDate");
    /** With dates: keep the cars with no free unit in the period (flagged isAvailable=false, listed last). */
    const includeSoldOut = searchParams.get("includeSoldOut") === "1";
    const returnDate = searchParams.get("returnDate");
    const search = searchParams.get("search");
    const location = searchParams.get("location");
    const status = searchParams.get("status");
    const sort = searchParams.get("sort") || "price_asc";
    const page = Math.max(1, parseInt(searchParams.get("page") || "1", 10));
    const limit = Math.min(100, Math.max(1, parseInt(searchParams.get("limit") || "20", 10)));

    const query: Record<string, unknown> = {
      isActive: true,
    };

    // Filter by vehicle status
    // Admin can filter by any status (maintenance, rented, etc.);
    // For clients, all non-archived vehicles are shown (availability is strictly time-based)
    if (isAdmin && status) {
      query.status = status;
    } else {
      query.status = { $nin: ["archived", "unavailable"] };
    }

    // Filter by Category: accepts Category ID or Category Slug
    if (categoryParam) {
      if (mongoose.Types.ObjectId.isValid(categoryParam)) {
        query.categoryId = new mongoose.Types.ObjectId(categoryParam);
      } else {
        const categoryDoc = await VehicleCategory.findOne({
          slug: categoryParam.toLowerCase().trim(),
        }).lean();
        if (categoryDoc) {
          query.categoryId = categoryDoc._id;
        } else {
          return NextResponse.json(
            {
              success: true,
              data: [],
              pagination: { total: 0, page, limit, totalPages: 0 },
            },
            { status: 200 }
          );
        }
      }
    }

    // Filter by Transmission
    if (transmission && ["automatic", "manual"].includes(transmission.toLowerCase())) {
      query.transmission = transmission.toLowerCase();
    }

    // Filter by Fuel Type
    if (
      fuelType &&
      ["gasoline", "diesel", "electric", "hybrid"].includes(fuelType.toLowerCase())
    ) {
      query.fuelType = fuelType.toLowerCase();
    }

    // Filter by Seats (minimum seats)
    if (seats) {
      const seatsCount = parseInt(seats, 10);
      if (!isNaN(seatsCount) && seatsCount > 0) {
        query.seats = { $gte: seatsCount };
      }
    }

    // Filter by Location — ADMIN ONLY
    // Clients see ALL vehicles regardless of their physical garage/branch location.
    // The fleet is treated as a single unified pool (e.g. car in Sfax is visible for Tunis search).
    if (location && mongoose.Types.ObjectId.isValid(location) && isAdmin) {
      query.location = new mongoose.Types.ObjectId(location);
    }

    // With a rental period, prices depend on the dates (seasons, degressive tariff): the price
    // filter and the price sort are applied on the computed period price, after the query.
    const day = /^\d{4}-\d{2}-\d{2}/;
    const hasPeriod = Boolean(pickupDate && returnDate && day.test(pickupDate) && day.test(returnDate) && returnDate > pickupDate);
    const priceFilter: Record<string, number> = {};

    // Filter by Price range (TND / minor units resilient)
    if (minPrice || maxPrice) {
      if (minPrice) {
        const minVal = parseFloat(minPrice);
        if (!isNaN(minVal) && minVal >= 0) {
          priceFilter.$gte = minVal < 10000 ? Math.round(minVal * 100) : minVal;
        }
      }
      if (maxPrice) {
        const maxVal = parseFloat(maxPrice);
        if (!isNaN(maxVal) && maxVal > 0) {
          priceFilter.$lte = maxVal < 10000 ? Math.round(maxVal * 100) : maxVal;
        }
      }
      if (Object.keys(priceFilter).length > 0 && !hasPeriod) {
        query["pricing.daily"] = priceFilter;
      }
    }

    // Text search on brand and model
    if (search && search.trim().length > 0) {
      const regex = new RegExp(escapeRegex(search.trim()), "i");
      query.$or = [{ brand: regex }, { model: regex }];
    }

    // Real-time fleet stock availability mapping
    let fleetStockMap: Record<string, { totalUnits: number; bookedUnits: number; availableUnits: number; isAvailable: boolean }> = {};
    const hasDateWindow = Boolean(pickupDate && returnDate);

    if (hasDateWindow) {
      const pDate = new Date(pickupDate as string);
      const rDate = new Date(returnDate as string);

      if (!isNaN(pDate.getTime()) && !isNaN(rDate.getTime()) && rDate > pDate) {
        fleetStockMap = await getFleetStockMap(pDate, rDate);
        // Exclude vehicles that have 0 units available during this date window — unless the page
        // asks to show them as "sold out for these dates" (includeSoldOut=1).
        const unavailableIds = Object.keys(fleetStockMap).filter((id) => !fleetStockMap[id].isAvailable);
        if (unavailableIds.length > 0 && !includeSoldOut) {
          const unavailableObjectIds = unavailableIds
            .filter((id) => mongoose.Types.ObjectId.isValid(id))
            .map((id) => new mongoose.Types.ObjectId(id));

          query._id = { $nin: unavailableObjectIds };
        }
      }
    }

    // Sorting
    let sortOptions: Record<string, 1 | -1> = { "pricing.daily": 1 };
    switch (sort) {
      case "price_desc":
        sortOptions = { "pricing.daily": -1 };
        break;
      case "price_asc":
        sortOptions = { "pricing.daily": 1 };
        break;
      case "newest":
        sortOptions = { year: -1, createdAt: -1 };
        break;
      case "seats_desc":
        sortOptions = { seats: -1 };
        break;
      default:
        sortOptions = { "pricing.daily": 1 };
    }

    const skip = (page - 1) * limit;

    const [vehicles, total] = await Promise.all([
      Vehicle.find(query)
        .populate("categoryId")
        .populate("location")
        .sort(sortOptions)
        .skip(hasPeriod ? 0 : skip)
        .limit(hasPeriod ? 500 : limit)
        .lean(),
      Vehicle.countDocuments(query),
    ]);

    // Fleet-wide minimum rental period (a vehicle's own minimum wins when higher).
    const rules = await getRentalRules();

    // Format & Enrich with stock counters, and sanitize for non-admin
    let processedVehicles = vehicles.map((v: any) => {
      const vId = v._id.toString();
      // With a date window: exact stock for that window. Without: cars currently in service.
      const stock = fleetStockMap[vId] || stockWithoutDates(v);

      // Fleet-wide rules ("Tarifs par période") merged in: same numbers on every step of the site.
      const ruled = applyRules(v, rules, hasPeriod ? pickupDate! : undefined) as any;
      const priceDay = hasPeriod ? pickupDate! : undefined;
      const quote = hasPeriod ? calculateSeasonalRentalTotal(ruled, pickupDate!, returnDate!) : null;
      const enriched = {
        ...ruled,
        periodPricing: {
          // Daily rate in force on the pickup day (or today without dates), minor units.
          dailyRate: quote ? quote.averageDailyRate : getVehicleEffectiveDailyRate(ruled, priceDay),
          baseDailyRate: Number(v.pricing?.daily || 0),
          days: quote ? quote.days : null,
          total: quote ? quote.subtotal : null,
          periodName: pricingPeriodName(ruled, priceDay),
          discountPercent: quote?.discountPercent || 0,
          minDays: ruled.minRentalDaysForPeriod,
          meetsMinimum: quote ? quote.days >= ruled.minRentalDaysForPeriod : true,
        },
        totalUnits: stock.totalUnits,
        availableUnits: stock.availableUnits,
        bookedUnits: stock.bookedUnits,
        isAvailable: stock.isAvailable,
      };

      return isAdmin ? enriched : sanitizeVehicleForClient(enriched);
    });

    let periodTotal = total;
    if (hasPeriod) {
      const rate = (v: any) => Number(v.periodPricing?.dailyRate || 0);
      processedVehicles = processedVehicles.filter(
        (v: any) => (priceFilter.$gte === undefined || rate(v) >= priceFilter.$gte) && (priceFilter.$lte === undefined || rate(v) <= priceFilter.$lte)
      );
      if (!["newest", "seats_desc"].includes(sort)) {
        processedVehicles.sort((a: any, b: any) => (sort === "price_desc" ? rate(b) - rate(a) : rate(a) - rate(b)));
      }
      // Sold-out cars (shown on request) always come after the cars that can be booked.
      if (includeSoldOut) {
        processedVehicles = [...processedVehicles.filter((v: any) => v.isAvailable), ...processedVehicles.filter((v: any) => !v.isAvailable)];
      }
      periodTotal = processedVehicles.length;
      processedVehicles = processedVehicles.slice(skip, skip + limit);
    }

    return NextResponse.json(
      {
        success: true,
        data: processedVehicles,
        vehicles: processedVehicles,
        total: periodTotal,
        pagination: {
          total: periodTotal,
          page,
          limit,
          totalPages: Math.ceil(periodTotal / limit),
        },
      },
      {
        status: 200,
        headers: {
          "Cache-Control": "no-store, no-cache, must-revalidate, max-age=0",
        },
      }
    );
  } catch (error) {
    console.error("Error fetching vehicles:", error);
    return NextResponse.json(
      {
        success: false,
        error: error instanceof Error ? error.message : "Failed to fetch vehicles",
      },
      { status: 500 }
    );
  }
}
