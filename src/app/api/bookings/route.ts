import { NextRequest, NextResponse } from "next/server";
import connectDB from "@/lib/db";
import {
  Booking,
  Vehicle,
  Customer,
  Location,
  Extra,
  Coupon,
  Notification,
  User,
  AgencySetting,
} from "@/models";
import { getVehicleStockAvailability } from "@/lib/availability";
import {
  generateBookingReference,
  calculateRentalPrice,
  formatDate,
} from "@/lib/utils";
import { calculateSeasonalRentalTotal } from "@/lib/seasonalPricing";
import { computeRentalDays, extraLineTotal, normalizePricingType, snapAmount, type ExtraPricingType } from "@/lib/extras";
import { sendEmail, buildBookingConfirmationEmail } from "@/lib/email";
import { generateBookingPDF } from "@/lib/pdf";
import { sendBookingWhatsAppNotification } from "@/lib/whatsapp";
import { matchZone } from "@/lib/locationFees";
import { getLocationFeeConfig } from "@/lib/locationFeesServer";
import { sanitizeBookingForClient } from "@/lib/sanitize";
import { escapeRegex, isStaffRequest } from "@/lib/apiAuth";
import { canAccessBooking } from "@/lib/bookingAccess";
import { withExtraIcons } from "@/lib/extrasServer";
import { releaseBooking, syncBookingAssignment } from "@/lib/fleetUnits";
import { effectiveMinDays, getGlobalMinRentalDays } from "@/lib/rentalRules";
import { notifyStaff } from "@/lib/notify";
import { z } from "zod";
import mongoose from "mongoose";

export const dynamic = "force-dynamic";

const createBookingSchema = z.object({
  vehicleId: z.string().optional(),
  vehicles: z
    .array(
      z.object({
        vehicleId: z.string().min(1),
        extras: z
          .array(
            z.object({
              extraId: z.string().min(1),
              quantity: z.number().int().min(1).default(1),
              /** Amount options (e.g. fuel): chosen amount in minor units. */
              amount: z.number().int().min(0).max(10_000_000).optional(),
            })
          )
          .optional()
          .default([]),
      })
    )
    .optional(),
  pickupLocationId: z.string().min(1, "Pickup location is required"),
  returnLocationId: z.string().min(1, "Return location is required"),
  pickupDate: z.string().refine((val) => !isNaN(Date.parse(val)), {
    message: "Format de date de départ invalide",
  }),
  returnDate: z.string().refine((val) => !isNaN(Date.parse(val)), {
    message: "Format de date de retour invalide",
  }),
  pickupTime: z.string().regex(/^([01]\d|2[0-3]):[0-5]\d$/).optional(),
  returnTime: z.string().regex(/^([01]\d|2[0-3]):[0-5]\d$/).optional(),
  extras: z
    .array(
      z.object({
        extraId: z.string().min(1),
        quantity: z.number().int().min(1).default(1),
        amount: z.number().int().min(0).max(10_000_000).optional(),
      })
    )
    .optional()
    .default([]),
  couponCode: z.string().optional().nullable(),
  customer: z.object({
    firstName: z.string().min(1, "Prénom requis").trim(),
    lastName: z.string().min(1, "Nom requis").trim(),
    email: z.string().trim().toLowerCase().email("Adresse email invalide"),
    phone: z.string().trim().min(6, "Numéro de téléphone requis").max(30),
    country: z.string().optional().default("Tunisie"),
    city: z.string().optional(),
    address: z.string().optional(),
    passportNumber: z.string().optional(),
    drivingLicence: z
      .object({
        number: z.string().optional(),
        country: z.string().optional().default("Tunisie"),
        issueYear: z.union([z.string(), z.number()]).optional(),
        expiryDate: z.string().optional(),
      })
      .optional()
      .nullable(),
    preferredLanguage: z.string().optional().default("fr"),
  }),
  customerNotes: z.string().max(2000).optional().default(""),
  customerLanguage: z.string().optional().default("fr"),
  accountOption: z.string().optional().default("guest"),
  accountPassword: z.string().optional(),
  paymentMethod: z.string().optional().default("cash"),
  termsAccepted: z.boolean().optional(),
});

export async function POST(request: NextRequest) {
  try {
    await connectDB();

    const rawBody = await request.json();
    const body = { ...rawBody };

    // Auto-normalize flat customer fields if not nested under `customer`
    if (!body.customer && (body.firstName || body.email)) {
      body.customer = {
        firstName: body.firstName || "",
        lastName: body.lastName || "",
        email: body.email || "",
        phone: body.phone || "",
        country: body.country || "Tunisie",
        city: body.city,
        address: body.address,
        passportNumber: body.passportNumber,
        drivingLicence: body.licenceNumber ? { number: body.licenceNumber, country: body.country || "Tunisie" } : undefined,
        preferredLanguage: body.customerLanguage || "fr",
      };
    } else if (body.customer && !body.customer.country) {
      body.customer.country = "Tunisie";
    }

    if (!body.customerNotes && body.notes) {
      body.customerNotes = body.notes;
    }

    // Auto-normalize multi-car and single-car payload
    if (body.vehicles && Array.isArray(body.vehicles) && body.vehicles.length > 0 && !body.vehicleId) {
      body.vehicleId = body.vehicles[0].vehicleId;
    } else if (body.vehicleId && (!body.vehicles || !Array.isArray(body.vehicles) || body.vehicles.length === 0)) {
      body.vehicles = [{ vehicleId: body.vehicleId, extras: body.extras || [] }];
    }

    const validationResult = createBookingSchema.safeParse(body);

    if (!validationResult.success) {
      const issueDetails = validationResult.error.issues
        .map((issue) => `${issue.path.join(".")}: ${issue.message}`)
        .join("; ");
      console.error("Booking validation failed:", issueDetails);
      return NextResponse.json(
        {
          success: false,
          error: `Données de réservation invalides (${issueDetails})`,
          details: validationResult.error.format(),
        },
        { status: 400 }
      );
    }

    const {
      vehicleId,
      pickupLocationId,
      returnLocationId,
      pickupDate: pickupDateStr,
      returnDate: returnDateStr,
      extras: selectedExtras,
      couponCode,
      customer: custInput,
      customerNotes,
      customerLanguage: rawCustomerLanguage,
      accountOption,
      accountPassword,
    } = validationResult.data;

    const customerLanguage: "fr" | "en" | "ar" =
      rawCustomerLanguage === "ar" || rawCustomerLanguage === "en" ? rawCustomerLanguage : "fr";

    const pickupDate = new Date(pickupDateStr);
    const returnDate = new Date(returnDateStr);

    // Reject bookings starting in the past (1-day tolerance for timezone differences).
    if (pickupDate.getTime() < Date.now() - 24 * 60 * 60 * 1000) {
      return NextResponse.json(
        { success: false, error: "La date de départ ne peut pas être dans le passé." },
        { status: 400 }
      );
    }

    if (returnDate <= pickupDate) {
      return NextResponse.json(
        {
          success: false,
          error: "La date de retour doit être postérieure à la date de départ.",
        },
        { status: 400 }
      );
    }

    // Same function as the booking wizard, so the displayed total equals the invoiced total.
    const rentalDays = computeRentalDays(pickupDateStr, returnDateStr);
    if (rentalDays < 1) {
      return NextResponse.json(
        {
          success: false,
          error: "La durée minimale de location est de 1 jour.",
        },
        { status: 400 }
      );
    }

    // 1. Resolve pickup and return locations
    async function resolveLocationDoc(idOrCode: string) {
      if (mongoose.Types.ObjectId.isValid(idOrCode)) {
        const found = await Location.findOne({ _id: idOrCode, isActive: true });
        if (found) return found;
      }
      // Legacy client fallback ids (e.g. "tun-airport") are matched by city/name, safely escaped.
      const term = escapeRegex(String(idOrCode).replace(/-(airport|city|agency)$/i, "").replace(/-/g, " "));
      if (!term) return null;
      return Location.findOne({
        isActive: true,
        $or: [
          { city: { $regex: `^${term}$`, $options: "i" } },
          { "name.fr": { $regex: term, $options: "i" } },
          { "name.en": { $regex: term, $options: "i" } },
        ],
      });
    }

    const [pickupLoc, returnLoc] = await Promise.all([
      resolveLocationDoc(pickupLocationId),
      resolveLocationDoc(returnLocationId),
    ]);

    if (!pickupLoc || !returnLoc) {
      return NextResponse.json(
        {
          success: false,
          error: "L'agence de départ ou de retour sélectionnée est introuvable.",
        },
        { status: 400 }
      );
    }

    // 2. Fetch and Validate all Vehicles (Multi-car system)
    const rawVehicles = validationResult.data.vehicles;
    const vehicleListInputs =
      rawVehicles && rawVehicles.length > 0
        ? rawVehicles
        : [{ vehicleId: vehicleId || "", extras: selectedExtras || [] }];

    type BookingExtraSnapshot = {
      extraId: mongoose.Types.ObjectId;
      name: string;
      price: number;
      quantity: number;
      icon?: string;
      pricingType: ExtraPricingType;
      lineTotal: number;
    };

    const processedVehicles: Array<{
      vehicle: any;
      dailyRate: number;
      subtotal: number;
      depositAmount: number;
      extras: BookingExtraSnapshot[];
      extrasTotal: number;
    }> = [];

    const globalMinDays = await getGlobalMinRentalDays();
    for (const vInput of vehicleListInputs) {
      // Never substitute another vehicle: the customer books the exact model they selected.
      const vDoc = mongoose.Types.ObjectId.isValid(vInput.vehicleId)
        ? await Vehicle.findById(vInput.vehicleId).populate("categoryId")
        : null;

      if (!vDoc || !vDoc.isActive || ["archived", "unavailable"].includes(vDoc.status)) {
        return NextResponse.json(
          {
            success: false,
            error: "Le véhicule sélectionné n'est pas disponible à la location.",
          },
          { status: 404 }
        );
      }

      // Minimum rental period check (fleet-wide minimum or the vehicle's own, whichever is higher)
      const requiredMinDays = effectiveMinDays(vDoc, globalMinDays);
      if (rentalDays < requiredMinDays) {
        return NextResponse.json(
          {
            success: false,
            error: `Le véhicule ${vDoc.brand} ${vDoc.model} exige une durée minimum de location de ${requiredMinDays} jour${requiredMinDays > 1 ? "s" : ""} (votre durée: ${rentalDays} jour${rentalDays > 1 ? "s" : ""}).`,
          },
          { status: 400 }
        );
      }

      // Concurrency Anti-Double Booking Check for each vehicle
      const stockInfo = await getVehicleStockAvailability(vDoc._id.toString(), pickupDate, returnDate);
      if (!stockInfo.isAvailable || stockInfo.availableUnits <= 0) {
        return NextResponse.json(
          {
            success: false,
            error: `Le véhicule ${vDoc.brand} ${vDoc.model} n'est plus disponible pour les dates sélectionnées (stock épuisé).`,
            stock: stockInfo,
          },
          { status: 409 }
        );
      }

      const { subtotal: seasonalSubtotal, averageDailyRate } = calculateSeasonalRentalTotal(
        vDoc,
        pickupDateStr,
        returnDateStr
      );
      const vDailyRate = averageDailyRate || vDoc.pricing.daily;
      const vSubtotal = seasonalSubtotal || calculateRentalPrice(vDoc.pricing, rentalDays);
      let vExtrasTotal = 0;
      const vBookingExtras: BookingExtraSnapshot[] = [];

      // Merge duplicate lines for the same option, ignore zero quantities.
      const requested = new Map<string, number>();
      const requestedAmount = new Map<string, number>();
      for (const item of vInput.extras || []) {
        if (!mongoose.Types.ObjectId.isValid(item.extraId) || !(item.quantity > 0)) continue;
        requested.set(item.extraId, (requested.get(item.extraId) || 0) + item.quantity);
        if (typeof (item as { amount?: number }).amount === "number") {
          requestedAmount.set(item.extraId, (item as { amount?: number }).amount as number);
        }
      }

      if (requested.size > 0) {
        const extraDocs = await Extra.find({ _id: { $in: [...requested.keys()] }, isActive: true });
        for (const extraDoc of extraDocs) {
          // Amount option (prepaid fuel…): one line, price = amount chosen on the slider (validated server-side).
          if (extraDoc.selectionMode === "amount") {
            const amount = snapAmount(
              requestedAmount.get(String(extraDoc._id)) ?? extraDoc.amountMin ?? 0,
              extraDoc.amountMin ?? 0,
              extraDoc.amountMax ?? 0,
              extraDoc.amountStep ?? 1
            );
            if (amount <= 0) continue;
            vExtrasTotal += amount;
            vBookingExtras.push({
              extraId: extraDoc._id,
              name: `${extraDoc.name[customerLanguage] || extraDoc.name.fr || extraDoc.name.en} (${(amount / 100).toLocaleString("fr-FR")} DT)`,
              price: amount,
              quantity: 1,
              icon: extraDoc.icon,
              pricingType: "per_rental",
              lineTotal: amount,
            });
            continue;
          }
          const qty = Math.min(requested.get(String(extraDoc._id)) || 1, extraDoc.maxQuantity || 5);
          const pricingType = normalizePricingType(extraDoc.pricingType);
          const lineTotal = extraLineTotal(extraDoc.price, qty, rentalDays, pricingType);

          vExtrasTotal += lineTotal;
          vBookingExtras.push({
            extraId: extraDoc._id,
            name: extraDoc.name[customerLanguage] || extraDoc.name.fr || extraDoc.name.en,
            price: extraDoc.price,
            quantity: qty,
            icon: extraDoc.icon,
            pricingType,
            lineTotal,
          });
        }
      }

      processedVehicles.push({
        vehicle: vDoc,
        dailyRate: vDailyRate,
        subtotal: vSubtotal,
        depositAmount: vDoc.pricing.deposit || 0,
        extras: vBookingExtras,
        extrasTotal: vExtrasTotal,
      });
    }

    const vehicle = processedVehicles[0].vehicle;
    const dailyRate = processedVehicles[0].dailyRate;
    const subtotal = processedVehicles.reduce((acc, pv) => acc + pv.subtotal, 0);
    const extrasTotal = processedVehicles.reduce((acc, pv) => acc + pv.extrasTotal, 0);
    const bookingExtras = processedVehicles.flatMap((pv) => pv.extras);

    // 6. Validate and apply coupon if provided
    let discountAmount = 0;
    let appliedCouponCode: string | undefined = undefined;

    if (couponCode && couponCode.trim().length > 0) {
      const cleanCoupon = couponCode.toUpperCase().trim();
      let couponDoc = await Coupon.findOne({ code: cleanCoupon });

      // Bootstrap the advertised launch code only if it was never created —
      // a coupon deactivated by an admin must stay deactivated.
      if (!couponDoc && cleanCoupon === "PAYLESS2026") {
        couponDoc = await Coupon.findOneAndUpdate(
          { code: "PAYLESS2026" },
          {
            $set: {
              code: "PAYLESS2026",
              type: "percentage",
              value: 10,
              minimumDays: 1,
              minimumAmount: 0,
              isActive: true,
            },
          },
          { upsert: true, returnDocument: "after", setDefaultsOnInsert: true }
        );
      }

      if (couponDoc && couponDoc.isActive) {
        const now = new Date();
        const isNotExpired =
          (!couponDoc.startDate || now >= new Date(couponDoc.startDate)) &&
          (!couponDoc.endDate || now <= new Date(couponDoc.endDate));
        const withinLimits =
          !couponDoc.usageLimit || couponDoc.usageCount < couponDoc.usageLimit;
        const minDaysMet =
          !couponDoc.minimumDays || rentalDays >= couponDoc.minimumDays;
        const minAmountMet =
          !couponDoc.minimumAmount || subtotal >= couponDoc.minimumAmount;

        let categoryApplicable = true;
        if (
          couponDoc.applicableCategories &&
          couponDoc.applicableCategories.length > 0
        ) {
          const vehicleCategoryId = vehicle.categoryId?._id || vehicle.categoryId;
          categoryApplicable = couponDoc.applicableCategories.some(
            (cId: any) => cId.toString() === vehicleCategoryId.toString()
          );
        }

        if (isNotExpired && withinLimits && minDaysMet && minAmountMet && categoryApplicable) {
          if (couponDoc.type === "percentage") {
            discountAmount = Math.round((subtotal * couponDoc.value) / 100);
          } else if (couponDoc.type === "fixed") {
            discountAmount = Math.min(couponDoc.value, subtotal);
          }
          appliedCouponCode = couponDoc.code;
        }
      }
    }

    // 7. Configurable Delivery & Collection / Ramassage Fees & Taxes
    const feeConfig = await getLocationFeeConfig();
    const pickupZone = matchZone(pickupLoc, feeConfig.zones);
    const returnZone = matchZone(returnLoc, feeConfig.zones);

    // Delivery fee (Livraison / Prise en charge)
    let pickupLocationFee = 0;
    if (pickupLoc.pickupFee && pickupLoc.pickupFee > 0) {
      pickupLocationFee = pickupLoc.pickupFee;
    } else if (pickupZone && feeConfig.enabled) {
      pickupLocationFee = Math.round(pickupZone.deliveryFee * 100);
    }

    // Collection / Ramassage fee (Restitution)
    let returnLocationFee = 0;
    if (returnLoc.returnFee && returnLoc.returnFee > 0) {
      returnLocationFee = returnLoc.returnFee;
    } else if (returnLoc.customReturnFee && returnLoc.customReturnFee > 0) {
      returnLocationFee = returnLoc.customReturnFee;
    } else if (returnZone && feeConfig.enabled) {
      returnLocationFee = Math.round(returnZone.returnFee * 100);
    }

    // Inter-agency return fee (Aller-simple): 0 per policy (no extra 50 DT charged for different agency)
    const differentLocationFee = 0;

    const outOfTownFee = returnLocationFee;

    // Fiscal requirements
    let timbreFiscalSetting = 1; // 1 DT
    let contributionSetting = 2; // 2 DT/day
    try {
      const fiscalSettings = await AgencySetting.find({
        key: { $in: ["timbreFiscal", "contributionLF2026"] },
      }).lean();
      fiscalSettings.forEach((s) => {
        if (s.key === "timbreFiscal" && s.value !== undefined) timbreFiscalSetting = Number(s.value);
        if (s.key === "contributionLF2026" && s.value !== undefined) contributionSetting = Number(s.value);
      });
    } catch {}

    const taxRate = 0;
    const taxAmount = 0;
    const timbreFiscal = Math.round(timbreFiscalSetting * 100); // 1 timbre fiscal unique pour toute la facture
    const contributionLF2026 =
      Math.round(contributionSetting * 100) * rentalDays * processedVehicles.length;

    const depositAmount = processedVehicles.reduce((acc, pv) => acc + pv.depositAmount, 0);
    const totalAmount = Math.max(
      0,
      subtotal +
        extrasTotal -
        discountAmount +
        taxAmount +
        timbreFiscal +
        contributionLF2026 +
        pickupLocationFee +
        returnLocationFee +
        differentLocationFee
    );
    const currency = vehicle.pricing.currency || "TND";

    const pricingBreakdown = {
      dailyRate,
      rentalDays,
      subtotal,
      extrasTotal,
      discountAmount,
      taxAmount,
      taxRate,
      timbreFiscal,
      contributionLF2026,
      outOfTownFee,
      pickupLocationFee,
      returnLocationFee,
      differentLocationFee,
      depositAmount,
      totalAmount,
      currency,
    };

    // 8. Handle Client Account Option
    let linkedUserId: mongoose.Types.ObjectId | undefined = undefined;

    if (accountOption === "create" && accountPassword && accountPassword.trim().length >= 6) {
      try {
        let existingUser = await User.findOne({ email: custInput.email });
        if (existingUser && existingUser.role !== "client") {
          existingUser = null; // never attach customer bookings to back-office accounts
        } else if (!existingUser) {
          existingUser = await User.create({
            name: `${custInput.firstName} ${custInput.lastName}`.trim(),
            email: custInput.email,
            password: accountPassword,
            role: "client",
            phone: custInput.phone,
            preferences: { language: customerLanguage, notifications: true },
          });
        }
        if (existingUser) linkedUserId = existingUser._id;
      } catch (userErr) {
        console.error("Account creation error during booking:", userErr);
      }
    } else if (accountOption === "existing" && accountPassword) {
      try {
        // Only link the booking to an account when the customer proves they own it.
        const existingUser = await User.findOne({ email: custInput.email, role: "client" }).select("+password");
        if (existingUser && (await existingUser.comparePassword(accountPassword))) {
          linkedUserId = existingUser._id;
        }
      } catch (err) {
        console.error("Error looking up existing user:", err);
      }
    }

    // 9. Find or create Customer record
    let customer = await Customer.findOne({ email: custInput.email });
    if (!customer) {
      customer = await Customer.create({
        userId: linkedUserId,
        firstName: custInput.firstName,
        lastName: custInput.lastName,
        email: custInput.email,
        phone: custInput.phone,
        country: custInput.country || "Tunisie",
        city: custInput.city,
        address: custInput.address,
        passportNumber: custInput.passportNumber,
        drivingLicence: custInput.drivingLicence
          ? {
              number: custInput.drivingLicence.number || "",
              country: custInput.drivingLicence.country || custInput.country || "Tunisie",
              issueYear: custInput.drivingLicence.issueYear ? Number(custInput.drivingLicence.issueYear) : undefined,
              expiryDate: custInput.drivingLicence.expiryDate
                ? new Date(custInput.drivingLicence.expiryDate)
                : undefined,
            }
          : undefined,
        preferredLanguage: customerLanguage,
        totalBookings: 1,
        totalSpent: totalAmount,
        isBlacklisted: false,
        notes: "Client créé via réservation web.",
        tags: ["Web Booking"],
      });
    } else {
      if (linkedUserId && !customer.userId) {
        customer.userId = linkedUserId;
      }
      customer.totalBookings = (customer.totalBookings || 0) + 1;
      customer.totalSpent = (customer.totalSpent || 0) + totalAmount;
      if (custInput.phone) customer.phone = custInput.phone;
      if (custInput.city && !customer.city) customer.city = custInput.city;
      if (custInput.passportNumber && !customer.passportNumber) {
        customer.passportNumber = custInput.passportNumber;
      }
      await customer.save();
    }

    // 10. Generate Reference & CREATE BOOKING WITH INSTANT AUTO-CONFIRMATION
    const bookingReference = generateBookingReference();

    const vehicleTitle = processedVehicles.map((pv) => `${pv.vehicle.brand} ${pv.vehicle.model}`).join(" + ");

    // Counter / phone bookings created from the back-office.
    const staffCreated = await isStaffRequest();

    const booking = await Booking.create({
      bookingReference,
      customerId: customer._id,
      createdBy: linkedUserId,
      vehicleId: vehicle._id,
      vehicles: processedVehicles.map((pv) => ({
        vehicleId: pv.vehicle._id,
        brand: pv.vehicle.brand,
        model: pv.vehicle.model,
        dailyRate: pv.dailyRate,
        subtotal: pv.subtotal,
        depositAmount: pv.depositAmount,
        extras: pv.extras,
      })),
      pickupLocationId: pickupLoc._id,
      returnLocationId: returnLoc._id,
      pickupDate,
      returnDate,
      pickupTime: validationResult.data.pickupTime,
      returnTime: validationResult.data.returnTime,
      rentalDuration: rentalDays,
      pricingBreakdown,
      extras: bookingExtras,
      couponCode: appliedCouponCode,
      bookingStatus: "confirmed", // <-- AUTO-CONFIRMED DIRECTEMENT (Suppression validation agence)
      paymentStatus: "unpaid",
      paymentMethod: body.paymentMethod || "cash",
      customerLanguage,
      internalNotes: "Réservation confirmée automatiquement par le système. Véhicule garanti.",
      customerNotes: customerNotes || "",
      isManualBooking: staffCreated,
      auditHistory: [
        {
          action: "auto_confirmed",
          performedBy: customer._id,
          performedByRole: "system",
          timestamp: new Date(),
          notes: "Réservation confirmée immédiatement en ligne sans délai de validation agence. Stock verrouillé.",
        },
      ],
    });

    // Link the booking to ONE unique physical car per booked car (a plate is not required).
    // The claim is atomic: if every car of the model is already held on one of the days,
    // the booking is refused instead of sharing a car with another reservation.
    let assignedPlates = "";
    try {
      const sync = await syncBookingAssignment(String(booking._id));
      if (sync.unassigned > 0) {
        await Booking.deleteOne({ _id: booking._id });
        await releaseBooking(String(booking._id));
        return NextResponse.json(
          { success: false, error: `Le véhicule ${vehicle.brand} ${vehicle.model} n'est plus disponible pour les dates sélectionnées.` },
          { status: 409 }
        );
      }
      assignedPlates = sync.assigned.map((a) => a.licensePlate || "sans immat.").join(", ");
    } catch (assignErr) {
      console.error("Vehicle assignment failed:", assignErr);
      await Booking.deleteOne({ _id: booking._id });
      await releaseBooking(String(booking._id));
      return NextResponse.json(
        { success: false, error: "L'affectation du véhicule a échoué. Veuillez réessayer." },
        { status: 500 }
      );
    }

    // Record coupon usage
    if (appliedCouponCode) {
      await Coupon.findOneAndUpdate(
        { code: appliedCouponCode },
        {
          $inc: { usageCount: 1 },
          $push: {
            usedBy: {
              customerId: customer._id,
              bookingId: booking._id,
              usedAt: new Date(),
            },
          },
        }
      );
    }

    // 11. Real-time notification for the back-office
    try {
      const vehicleTitle = `${vehicle.brand} ${vehicle.model}`;
      const customerFullName = `${customer.firstName} ${customer.lastName}`;
      const plateFr = assignedPlates ? ` (véhicule ${assignedPlates})` : " (aucun véhicule libre à assigner — à vérifier)";
      const plateEn = assignedPlates ? ` (car ${assignedPlates})` : " (no free car to assign — check)";
      await notifyStaff({
        type: "new_booking",
        severity: assignedPlates ? "info" : "warning",
        title: {
          fr: `Nouvelle réservation - ${bookingReference}`,
          en: `New booking - ${bookingReference}`,
          ar: `حجز جديد - ${bookingReference}`,
        },
        message: {
          fr: `${customerFullName} a réservé ${vehicleTitle}${plateFr} du ${formatDate(pickupDate, "fr-FR")} au ${formatDate(returnDate, "fr-FR")}.`,
          en: `${customerFullName} booked ${vehicleTitle}${plateEn} from ${formatDate(pickupDate, "en-US")} to ${formatDate(returnDate, "en-US")}.`,
          ar: `قام ${customerFullName} بحجز ${vehicleTitle} من ${formatDate(pickupDate, "ar-TN")} إلى ${formatDate(returnDate, "ar-TN")}.`,
        },
        link: `/admin/bookings/${booking._id}`,
        data: {
          bookingId: booking._id.toString(),
          bookingReference,
          totalAmount,
          vehicle: vehicleTitle,
          licensePlate: assignedPlates,
        },
      });
    } catch (notifErr) {
      console.error("Failed to generate admin notifications:", notifErr);
    }

    // 12. GENERATE OFFICIAL PDF VOUCHER
    const pickupLocName =
      pickupLoc.name[customerLanguage] || pickupLoc.name.fr || pickupLoc.address;
    const returnLocName =
      returnLoc.name[customerLanguage] || returnLoc.name.fr || returnLoc.address;

    let pdfBuffer: Buffer | null = null;
    try {
      pdfBuffer = generateBookingPDF({
        bookingReference,
        customerName: `${customer.firstName} ${customer.lastName}`,
        customerEmail: customer.email,
        customerPhone: customer.phone,
        customerCountry: customer.country,
        drivingLicenceYear: (customer.drivingLicence as any)?.issueYear,
        vehicleBrand: vehicle.brand,
        vehicleModel: vehicle.model,
        vehicleYear: vehicle.year,
        vehicles: processedVehicles.map((pv) => ({
          brand: pv.vehicle.brand,
          model: pv.vehicle.model,
          dailyRate: pv.dailyRate,
          subtotal: pv.subtotal,
          rentalDuration: rentalDays,
          extrasTotal: pv.extrasTotal,
          extras: pv.extras.map((ex) => ({
            name: ex.name,
            quantity: ex.quantity,
            price: ex.price,
            lineTotal: ex.lineTotal,
            pricingType: ex.pricingType,
          })),
          depositAmount: pv.depositAmount,
        })),
        pickupLocation: pickupLocName,
        returnLocation: returnLocName,
        pickupDate: `${formatDate(pickupDate, "fr-FR")}${validationResult.data.pickupTime ? ` à ${validationResult.data.pickupTime}` : ""}`,
        returnDate: `${formatDate(returnDate, "fr-FR")}${validationResult.data.returnTime ? ` à ${validationResult.data.returnTime}` : ""}`,
        bookingStatus: "confirmed",
        rentalDuration: rentalDays,
        dailyRate,
        subtotal,
        extrasTotal,
        discountAmount,
        pickupLocationFee,
        returnLocationFee,
        differentLocationFee,
        outOfTownFee,
        timbreFiscal,
        contributionLF2026,
        taxAmount,
        totalAmount,
        depositAmount,
        currency: "TND",
      });
    } catch (pdfErr) {
      console.error("PDF generation in booking flow error:", pdfErr);
    }

    // 13. SEND CONFIRMATION EMAILS WITH PDF ATTACHMENT
    const emailData = buildBookingConfirmationEmail({
      customerName: `${customer.firstName} ${customer.lastName}`,
      bookingReference,
      vehicleName: vehicleTitle,
      pickupLocation: pickupLocName,
      returnLocation: returnLocName,
      pickupDate: formatDate(pickupDate, customerLanguage === "ar" ? "ar-TN" : "fr-FR"),
      returnDate: formatDate(returnDate, customerLanguage === "ar" ? "ar-TN" : "fr-FR"),
      totalAmount: (totalAmount / 100).toLocaleString("fr-FR"),
      currency: "TND",
      language: customerLanguage,
      timbreFiscal: (timbreFiscal / 100).toLocaleString("fr-FR"),
      contributionLF2026: (contributionLF2026 / 100).toLocaleString("fr-FR"),
      pickupLocationFee: pickupLocationFee > 0 ? (pickupLocationFee / 100).toLocaleString("fr-FR") : undefined,
      differentLocationFee: differentLocationFee > 0 ? (differentLocationFee / 100).toLocaleString("fr-FR") : undefined,
      outOfTownFee: returnLocationFee > 0 ? (returnLocationFee / 100).toLocaleString("fr-FR") : undefined,
      options: bookingExtras.map((ex) => ({ name: ex.name, quantity: ex.quantity })),
    });

    const emailPromises: Promise<any>[] = [
      sendEmail({
        to: customer.email,
        toName: `${customer.firstName} ${customer.lastName}`,
        subject: emailData.subject,
        html: emailData.html,
        templateType: "booking_confirmation",
        language: customerLanguage,
        bookingId: booking._id.toString(),
        customerId: customer._id.toString(),
        attachments: pdfBuffer
          ? [
              {
                filename: `Reservation-${bookingReference}.pdf`,
                content: pdfBuffer,
                contentType: "application/pdf",
              },
            ]
          : undefined,
      }).catch((err) => console.error("Customer email dispatch error:", err)),
    ];

    const agencyEmail = process.env.AGENCY_EMAIL || process.env.SMTP_USER;
    if (agencyEmail && agencyEmail !== customer.email) {
      emailPromises.push(
        sendEmail({
          to: agencyEmail,
          toName: "Payless Administration",
          subject: `🔔 Réservation Confirmée Automatiquement - ${bookingReference}`,
          html: emailData.html,
          templateType: "admin_new_booking_alert",
          language: "fr",
          bookingId: booking._id.toString(),
          customerId: customer._id.toString(),
          attachments: pdfBuffer
            ? [
                {
                  filename: `Reservation-${bookingReference}.pdf`,
                  content: pdfBuffer,
                  contentType: "application/pdf",
                },
              ]
            : undefined,
        }).catch((err) => console.error("Agency email dispatch error:", err))
      );
    }

    Promise.race([
      Promise.allSettled(emailPromises),
      new Promise((resolve) => setTimeout(resolve, 2500)),
    ]).catch((e) => console.error("Async email error:", e));

    // 14. FORMAT WHATSAPP BUSINESS NOTIFICATION / LINK
    const siteUrl = process.env.NEXTAUTH_URL || "https://payless.tn";
    const pdfUrl = `${siteUrl}/api/bookings/pdf?ref=${bookingReference}&email=${encodeURIComponent(customer.email)}`;
    const waText = encodeURIComponent(
      `🚗 *Payless Car Rental Tunisie — Confirmation de Réservation*\n\n` +
      `Bonjour *${customer.firstName} ${customer.lastName}*,\n` +
      `Votre réservation *${bookingReference}* est ✅ *Confirmée Instantanément* !\n\n` +
      `• *Véhicule* : ${vehicle.brand} ${vehicle.model}\n` +
      `• *Prise en charge* : ${formatDate(pickupDate, "fr-FR")} (${pickupLocName})\n` +
      `• *Restitution* : ${formatDate(returnDate, "fr-FR")} (${returnLocName})\n` +
      `• *Durée* : ${rentalDays} jour(s)\n` +
      `• *Montant Total TTC* : ${(totalAmount / 100).toFixed(2)} TND\n\n` +
      `📄 *Télécharger votre bon de réservation officiel PDF* :\n${pdfUrl}\n\n` +
      `Notre équipe reste à votre entière disposition 24/7 au 80808080.`
    );
    const cleanCustPhone = customer.phone.replace(/[^0-9]/g, "");
    const whatsappUrl = `https://wa.me/${cleanCustPhone}?text=${waText}`;

    // Auto-dispatch WhatsApp confirmation if gateway is connected
    sendBookingWhatsAppNotification({
      ...(booking.toObject ? booking.toObject() : booking),
      customerName: `${customer.firstName} ${customer.lastName}`,
      customerPhone: customer.phone,
      customerEmail: customer.email,
      vehicleName: vehicleTitle,
      pickupDate,
      returnDate,
      pickupLocation: pickupLocName,
      totalAmount,
    }).catch((waErr) => {
      console.warn("Background WhatsApp dispatch non-blocking notice:", waErr);
    });

    // Return the created booking with sanitized fields
    const populatedBooking = await Booking.findById(booking._id)
      .populate("vehicleId")
      .populate("vehicles.vehicleId")
      .populate("pickupLocationId")
      .populate("returnLocationId")
      .populate("customerId")
      .lean();

    const clientSafeBooking = sanitizeBookingForClient(populatedBooking as any);

    return NextResponse.json(
      {
        success: true,
        message: "Réservation confirmée automatiquement avec succès.",
        bookingReference,
        bookingId: String(booking._id),
        // Internal fleet data (plate) only for back-office callers, never for customers.
        ...(staffCreated ? { assignedPlates } : {}),
        booking: clientSafeBooking,
        whatsappUrl,
        pdfUrl: `/api/bookings/pdf?ref=${bookingReference}&email=${encodeURIComponent(customer.email)}`,
      },
      { status: 201 }
    );
  } catch (error) {
    console.error("Booking creation error:", error);
    return NextResponse.json(
      { success: false, error: "Une erreur est survenue lors de la création de la réservation." },
      { status: 500 }
    );
  }
}

export async function GET(request: NextRequest) {
  try {
    await connectDB();

    const { searchParams } = new URL(request.url);
    const reference = searchParams.get("reference")?.trim();
    const email = searchParams.get("email")?.toLowerCase().trim();
    const staff = await isStaffRequest();

    // Anonymous visitors may only look up ONE booking, proving ownership with reference + email.
    // Listing/filtering bookings is a back-office capability (see /api/admin/bookings).
    if (!staff) {
      if (!reference || !email) {
        return NextResponse.json(
          { success: false, error: "La référence et l'adresse email sont requises." },
          { status: 400 }
        );
      }
      const booking = await Booking.findOne({ bookingReference: reference.toUpperCase() })
        .populate("vehicleId")
        .populate("vehicles.vehicleId")
        .populate("pickupLocationId")
        .populate("returnLocationId")
        .populate("customerId")
        .lean();

      if (!booking || !(await canAccessBooking(booking, email))) {
        // Same response for "not found" and "wrong email" to avoid reference enumeration.
        return NextResponse.json(
          { success: true, data: [], pagination: { total: 0, page: 1, limit: 1, totalPages: 0 } },
          { status: 200 }
        );
      }

      const enriched = await withExtraIcons(booking as any);
      return NextResponse.json(
        {
          success: true,
          data: [sanitizeBookingForClient(enriched)],
          pagination: { total: 1, page: 1, limit: 1, totalPages: 1 },
        },
        { status: 200 }
      );
    }

    const status = searchParams.get("status");
    const page = Math.max(1, parseInt(searchParams.get("page") || "1", 10));
    const limit = Math.min(100, Math.max(1, parseInt(searchParams.get("limit") || "20", 10)));

    const query: Record<string, unknown> = {};
    if (reference) query.bookingReference = reference.toUpperCase();
    if (status) query.bookingStatus = String(status);
    if (email) {
      const customer = await Customer.findOne({ email }).select("_id");
      if (!customer) {
        return NextResponse.json(
          { success: true, data: [], pagination: { total: 0, page, limit, totalPages: 0 } },
          { status: 200 }
        );
      }
      query.customerId = customer._id;
    }

    const skip = (page - 1) * limit;
    const [bookings, total] = await Promise.all([
      Booking.find(query)
        .populate("vehicleId")
        .populate("pickupLocationId")
        .populate("returnLocationId")
        .populate("customerId")
        .sort({ createdAt: -1 })
        .skip(skip)
        .limit(limit)
        .lean(),
      Booking.countDocuments(query),
    ]);

    return NextResponse.json(
      {
        success: true,
        data: bookings,
        pagination: { total, page, limit, totalPages: Math.ceil(total / limit) },
      },
      { status: 200 }
    );
  } catch (error) {
    console.error("Error fetching bookings:", error);
    return NextResponse.json({ success: false, error: "Failed to fetch bookings" }, { status: 500 });
  }
}
