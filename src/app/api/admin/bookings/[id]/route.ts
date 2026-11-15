import { NextRequest, NextResponse } from "next/server";
import { connectDB } from "@/lib/db";
import Booking from "@/models/Booking";
import Vehicle from "@/models/Vehicle";
import { sendEmail, buildBookingConfirmationEmail } from "@/lib/email";
import { formatDate } from "@/lib/utils";
import { z } from "zod";
import { requirePermission } from "@/lib/permissions";
import { withExtraIcons } from "@/lib/extrasServer";
import mongoose from "mongoose";
import { computeRentalDays, extraLineTotal, isPerDayPricing, onlySelected } from "@/lib/extras";
import { calculateSeasonalRentalTotal } from "@/lib/seasonalPricing";
import { getVehicleStockAvailability } from "@/lib/availability";
import {
  assignUnitManually,
  autoAssignUnits,
  ensureUnits,
  listUnitAvailability,
  revalidateAssignments,
} from "@/lib/fleetUnits";
import { notifyStaff } from "@/lib/notify";

async function checkAdmin(level: "view" | "edit" = "edit") {
  const guard = await requirePermission("bookings", level);
  return guard.ok ? guard.session : null;
}

export async function GET(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  const session = await checkAdmin("view");
  if (!session) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  const { id } = await params;
  if (!mongoose.Types.ObjectId.isValid(id)) {
    return NextResponse.json({ error: "Booking not found" }, { status: 404 });
  }
  try {
    await connectDB();
    const booking = await Booking.findById(id)
      .populate("vehicleId")
      .populate("vehicles.vehicleId")
      .populate("customerId")
      .populate("pickupLocationId")
      .populate("returnLocationId")
      .lean();
    if (!booking) return NextResponse.json({ error: "Booking not found" }, { status: 404 });

    // Physical cars of each booked model with their availability on the booking window (plate picker).
    const modelIds = Array.from(
      new Set(
        (booking.vehicles && booking.vehicles.length > 0
          ? booking.vehicles.map((v: any) => String(v.vehicleId?._id || v.vehicleId))
          : [String((booking.vehicleId as any)?._id || booking.vehicleId)]
        ).filter((x) => mongoose.Types.ObjectId.isValid(x))
      )
    );
    const unitOptions: Record<string, Awaited<ReturnType<typeof listUnitAvailability>>> = {};
    for (const mId of modelIds) {
      unitOptions[mId] = await listUnitAvailability(mId, booking.pickupDate, booking.returnDate, id).catch(() => []);
    }

    // Attach option icons and drop unselected (qty 0) entries.
    return NextResponse.json({ booking: await withExtraIcons(booking as any), unitOptions });
  } catch {
    return NextResponse.json({ error: "Failed to fetch booking" }, { status: 500 });
  }
}

const updateSchema = z.object({
  status: z.enum([
    "pending", "confirmed", "awaiting_payment", "paid",
    "active", "completed", "cancelled", "rejected"
  ]).optional(),
  paymentStatus: z.enum(["unpaid", "partial", "paid", "refunded"]).optional(),
  internalNote: z.string().max(2000).optional(),
  internalNotes: z.string().max(2000).optional(),
  adminNotes: z.string().max(2000).optional(),
  vehicleId: z.string().optional(),
  vehicle: z.string().optional(),
  pickupDate: z.string().optional(),
  returnDate: z.string().optional(),
  actualPickupDate: z.string().optional(),
  actualReturnDate: z.string().optional(),
  modificationDecision: z.enum(["approve", "reject"]).optional(),
  decisionNotes: z.string().max(1000).optional(),
}).passthrough();

export async function PATCH(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  const session = await checkAdmin();
  if (!session) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  const { id } = await params;
  if (!mongoose.Types.ObjectId.isValid(id)) {
    return NextResponse.json({ error: "Booking not found" }, { status: 404 });
  }
  try {
    await connectDB();
    const body = await request.json();

    if (typeof body.action === "string") {
      return handleAction(id, body, session.user?.email || "Admin");
    }

    const parsed = updateSchema.safeParse(body);

    if (!parsed.success) {
      return NextResponse.json({ error: parsed.error.issues[0]?.message || "Validation error" }, { status: 400 });
    }

    const updates: Record<string, unknown> = { ...parsed.data };
    // Never let the generic update overwrite computed / operational fields.
    for (const k of ["pricingBreakdown", "assignedUnits", "auditHistory", "extensions", "bookingReference", "customerId"]) {
      delete updates[k];
    }
    delete updates.vehicle;
    if (parsed.data.status) {
      updates.bookingStatus = parsed.data.status;
    }

    const currentBooking = await Booking.findById(id).populate("vehicleId").populate("customerId");
    if (!currentBooking) return NextResponse.json({ error: "Booking not found" }, { status: 404 });

    // Model change: the previously assigned plate belongs to the old model.
    const previousModelId = String((currentBooking.vehicleId as any)?._id || currentBooking.vehicleId || "");
    const modelChanged =
      typeof updates.vehicleId === "string" &&
      mongoose.Types.ObjectId.isValid(updates.vehicleId) &&
      updates.vehicleId !== previousModelId;
    if (typeof updates.vehicleId === "string" && !modelChanged) delete updates.vehicleId;
    if (modelChanged) {
      updates.assignedUnits = (currentBooking.assignedUnits || []).filter((a) => String(a.vehicleId) !== previousModelId);
    }

    // Handle modification request decision (approve or reject)
    if (parsed.data.modificationDecision && currentBooking.modificationRequest) {
      const decision = parsed.data.modificationDecision;
      const notes = parsed.data.decisionNotes || "";

      if (decision === "approve") {
        const mod = currentBooking.modificationRequest;
        if (mod.pickupDate) updates.pickupDate = mod.pickupDate;
        if (mod.returnDate) updates.returnDate = mod.returnDate;
        if (mod.pickupTime) updates.pickupTime = mod.pickupTime;
        if (mod.returnTime) updates.returnTime = mod.returnTime;
        if (mod.pickupLocationId) updates.pickupLocationId = mod.pickupLocationId;
        if (mod.returnLocationId) updates.returnLocationId = mod.returnLocationId;
        if (mod.customerNotes) updates.customerNotes = mod.customerNotes;

        // Recalculate duration & pricing if dates changed
        if (mod.pickupDate && mod.returnDate) {
          // Same rules as the booking wizard: calendar days + price locked on the pickup-day period.
          const days = computeRentalDays(mod.pickupDate, mod.returnDate);
          updates.rentalDuration = days;
          if (currentBooking.pricingBreakdown) {
            const pb = (currentBooking.pricingBreakdown as any).toObject
              ? (currentBooking.pricingBreakdown as any).toObject()
              : currentBooking.pricingBreakdown;
            const veh = currentBooking.vehicleId as unknown as { pricing?: { daily: number } } | null;
            const iso = (d: Date) => new Date(d).toISOString().slice(0, 10);
            const subtotal = veh?.pricing
              ? calculateSeasonalRentalTotal(veh, iso(mod.pickupDate), iso(mod.returnDate)).subtotal
              : pb.subtotal;
            const extrasTotal = onlySelected(currentBooking.extras).reduce(
              (acc, ex) => acc + extraLineTotal(ex.price || 0, ex.quantity || 1, days, ex.pricingType),
              0
            );
            const oldDays = pb.rentalDays || currentBooking.rentalDuration || 1;
            const perDayContrib = oldDays > 0 ? Math.round((pb.contributionLF2026 || 0) / oldDays) : 200;
            const contrib = perDayContrib * days;
            const fees = (pb.timbreFiscal ?? 100) + (pb.pickupLocationFee || 0) + (pb.returnLocationFee || 0) + (pb.differentLocationFee || 0);
            const total = Math.max(0, subtotal + extrasTotal + fees + contrib - (pb.discountAmount || 0));
            updates.pricingBreakdown = {
              ...pb,
              rentalDays: days,
              subtotal,
              extrasTotal,
              dailyRate: Math.round(subtotal / days),
              contributionLF2026: contrib,
              totalAmount: total,
            };
          }
        }

        updates["modificationRequest.status"] = "approved";
        updates["modificationRequest.processedAt"] = new Date();
        updates["modificationRequest.processedBy"] = session.user?.email || "Admin";
        updates["modificationRequest.decisionNotes"] = notes;

        // Notify customer via email about modification approval
        try {
          const cust = currentBooking.customerId as unknown as { email?: string; firstName?: string; lastName?: string } | null;
          if (cust?.email) {
            sendEmail({
              to: cust.email,
              toName: `${cust.firstName || ""} ${cust.lastName || ""}`.trim(),
              subject: `✅ Demande de modification ACCEPTÉE - ${currentBooking.bookingReference} | Payless`,
              html: `
                <div style="font-family: sans-serif; padding: 20px; color: #1e293b;">
                  <h2 style="color: #16a34a;">Votre demande de modification a été validée</h2>
                  <p>Bonjour ${cust.firstName || "Client"},</p>
                  <p>L'agence Payless a le plaisir de vous confirmer que votre demande de modification pour la réservation <strong>${currentBooking.bookingReference}</strong> a été <strong>acceptée</strong>.</p>
                  <p>Votre contrat et vos vouchers ont été mis à jour avec vos nouvelles dates.</p>
                  ${notes ? `<p><strong>Note de l'agence :</strong> ${notes}</p>` : ""}
                  <p><a href="${process.env.NEXT_PUBLIC_APP_URL || ""}/fr/booking/status?ref=${currentBooking.bookingReference}" style="display:inline-block; padding:12px 24px; background:#16a34a; color:#fff; text-decoration:none; border-radius:8px; font-weight:bold;">Voir mon dossier mis à jour</a></p>
                </div>
              `,
              templateType: "booking_modified",
            }).catch((e) => console.error("Email send error:", e));
          }
        } catch (mailErr) {
          console.error("Email notify customer mod approve error:", mailErr);
        }
      } else if (decision === "reject") {
        updates["modificationRequest.status"] = "rejected";
        updates["modificationRequest.processedAt"] = new Date();
        updates["modificationRequest.processedBy"] = session.user?.email || "Admin";
        updates["modificationRequest.decisionNotes"] = notes;

        // Notify customer via email about rejection
        try {
          const cust = currentBooking.customerId as unknown as { email?: string; firstName?: string; lastName?: string } | null;
          if (cust?.email) {
            sendEmail({
              to: cust.email,
              toName: `${cust.firstName || ""} ${cust.lastName || ""}`.trim(),
              subject: `ℹ️ Demande de modification non acceptée - ${currentBooking.bookingReference} | Payless`,
              html: `
                <div style="font-family: sans-serif; padding: 20px; color: #1e293b;">
                  <h2 style="color: #dc2626;">Information concernant votre demande de modification</h2>
                  <p>Bonjour ${cust.firstName || "Client"},</p>
                  <p>Nous vous informons que votre demande de modification pour la réservation <strong>${currentBooking.bookingReference}</strong> n'a pas pu être acceptée par l'agence en raison des disponibilités du parc automobile.</p>
                  <p>Votre réservation initiale reste <strong>active et confirmée</strong> selon les dates préalablement convenues.</p>
                  ${notes ? `<p><strong>Précision de l'agence :</strong> ${notes}</p>` : ""}
                  <p>Pour tout renseignement complémentaire, contactez-nous directement sur WhatsApp ou par téléphone au +216 25 120 130.</p>
                </div>
              `,
              templateType: "booking_modified",
            }).catch((e) => console.error("Email send error:", e));
          }
        } catch (mailErr) {
          console.error("Email notify customer mod reject error:", mailErr);
        }
      }
    }

    // Record audit history entry
    const auditEntry = {
      timestamp: new Date(),
      action: parsed.data.modificationDecision
        ? `Demande de modification ${parsed.data.modificationDecision === "approve" ? "ACCEPTÉE" : "REFUSÉE"} par l'admin`
        : `Statut mis à jour à ${parsed.data.status || "modifié"}`,
      performedBy: session.user?.email,
      changes: parsed.data,
    };

    const newStatus = parsed.data.status;
    const oldBooking = currentBooking;

    const booking = await Booking.findByIdAndUpdate(
      id,
      {
        $set: updates,
        $push: { auditHistory: auditEntry },
      },
      { returnDocument: "after", runValidators: true }
    )
      .populate("vehicleId")
      .populate("customerId")
      .populate("pickupLocationId")
      .populate("returnLocationId");

    if (!booking) return NextResponse.json({ error: "Booking not found" }, { status: 404 });

    if (updates.pickupDate || updates.returnDate || modelChanged) {
      await revalidateAssignments(id).catch((e) => console.error("revalidateAssignments:", e));
    } else if (newStatus && ["confirmed", "awaiting_payment", "paid", "active"].includes(newStatus)) {
      await autoAssignUnits(id).catch((e) => console.error("autoAssignUnits:", e));
    }

    // Track vehicle available units and trigger emails
    if (newStatus && oldBooking && oldBooking.bookingStatus !== newStatus) {
      const vId = booking.vehicleId?._id || booking.vehicleId;

      if (newStatus === "confirmed") {
        // Decrement available units
        if (vId) {
          await Vehicle.findByIdAndUpdate(vId, { $inc: { availableUnits: -1 } });
        }

        // Send confirmation email to customer
        try {
          const cust = booking.customerId as unknown as { email?: string; firstName?: string; lastName?: string } | null;
          const veh = booking.vehicleId as unknown as { brand?: string; model?: string; year?: number } | null;
          const pickLoc = booking.pickupLocationId as unknown as { name?: { fr?: string } } | null;
          const retLoc = booking.returnLocationId as unknown as { name?: { fr?: string } } | null;

          if (cust?.email) {
            const customerLang = (booking.customerLanguage as "fr" | "en" | "ar") || "fr";
            const emailData = buildBookingConfirmationEmail({
              customerName: `${cust.firstName || ""} ${cust.lastName || ""}`.trim() || "Client",
              bookingReference: booking.bookingReference,
              vehicleName: veh ? `${veh.brand} ${veh.model} (${veh.year || 2024})` : "Véhicule Payless",
              pickupLocation: pickLoc?.name?.fr || "Tunisie",
              returnLocation: retLoc?.name?.fr || "Tunisie",
              pickupDate: formatDate(booking.pickupDate, "fr-FR"),
              returnDate: formatDate(booking.returnDate, "fr-FR"),
              totalAmount: ((booking.pricingBreakdown?.totalAmount || 0) / 100).toLocaleString("fr-FR"),
              currency: booking.pricingBreakdown?.currency || "TND",
              language: customerLang,
              timbreFiscal: "1",
              contributionLF2026: (((booking.pricingBreakdown?.contributionLF2026 ?? (200 * (booking.rentalDuration || 1)))) / 100).toLocaleString("fr-FR"),
            });

            await sendEmail({
              to: cust.email,
              toName: `${cust.firstName || ""} ${cust.lastName || ""}`.trim(),
              subject: `✅ Réservation Confirmée - ${booking.bookingReference} | Payless Car Rental`,
              html: emailData.html,
              templateType: "booking_confirmed_by_admin",
              language: customerLang,
              bookingId: booking._id.toString(),
            });
          }
        } catch (emailErr) {
          console.error("Failed to send admin confirmation email:", emailErr);
        }
      } else if (newStatus === "cancelled" || newStatus === "rejected") {
        // Restore available unit if previously confirmed/pending
        if (vId) {
          await Vehicle.findByIdAndUpdate(vId, { $inc: { availableUnits: 1 } });
        }
      }
    }

    return NextResponse.json({ booking });
  } catch (error) {
    console.error("PATCH /api/admin/bookings/[id] error:", error);
    return NextResponse.json({ error: "Failed to update booking" }, { status: 500 });
  }
}

export async function DELETE(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  const session = await checkAdmin();
  if (!session) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  const { id } = await params;
  try {
    await connectDB();
    const booking = await Booking.findById(id);
    if (!booking) {
      return NextResponse.json({ error: "Booking not found" }, { status: 404 });
    }

    if (booking.vehicleId && ["confirmed", "active", "pending"].includes(booking.bookingStatus)) {
      await Vehicle.findByIdAndUpdate(booking.vehicleId, {
        $inc: { availableUnits: 1 },
      }).catch(() => {});
    }

    await Booking.findByIdAndDelete(id);
    return NextResponse.json({
      success: true,
      message: `Réservation ${booking.bookingReference || id} supprimée définitivement avec succès.`,
    });
  } catch (error) {
    console.error("DELETE /api/admin/bookings/[id] error:", error);
    return NextResponse.json({ error: "Failed to delete booking" }, { status: 500 });
  }
}

/* ───────────────────────── Operational actions (counter / garage) ───────────────────────── */

const actionSchema = z.discriminatedUnion("action", [
  z.object({
    action: z.literal("assign_unit"),
    vehicleId: z.string(),
    unitId: z.string(),
    index: z.number().int().min(0).max(20).optional(),
  }),
  z.object({ action: z.literal("auto_assign") }),
  z.object({
    action: z.literal("record_pickup"),
    mileage: z.number().min(0).max(2_000_000).optional(),
    notes: z.string().max(1000).optional(),
  }),
  z.object({
    action: z.literal("record_return"),
    mileage: z.number().min(0).max(2_000_000).optional(),
    returnedAt: z.string().optional(),
    notes: z.string().max(1000).optional(),
  }),
  z.object({
    action: z.literal("extend"),
    newReturnDate: z.string().regex(/^\d{4}-\d{2}-\d{2}$/),
    newReturnTime: z.string().regex(/^([01]\d|2[0-3]):[0-5]\d$/).optional(),
    /** Daily price applied to the extra days, in TND. Defaults to the model's base daily price. */
    dailyRateTND: z.number().min(0).max(100000).optional(),
    notes: z.string().max(1000).optional(),
  }),
]);

async function handleAction(id: string, body: unknown, by: string) {
  const parsed = actionSchema.safeParse(body);
  if (!parsed.success) {
    return NextResponse.json({ error: parsed.error.issues[0]?.message || "Action invalide" }, { status: 400 });
  }
  const a = parsed.data;

  if (a.action === "assign_unit") {
    if (!mongoose.Types.ObjectId.isValid(a.vehicleId) || !mongoose.Types.ObjectId.isValid(a.unitId)) {
      return NextResponse.json({ error: "Véhicule invalide" }, { status: 400 });
    }
    const res = await assignUnitManually(id, a.vehicleId, a.unitId, by, a.index ?? 0);
    if (!res.ok) return NextResponse.json({ error: res.error }, { status: 409 });
    return NextResponse.json({ success: true, licensePlate: res.licensePlate });
  }

  if (a.action === "auto_assign") {
    const assigned = await autoAssignUnits(id);
    return NextResponse.json({ success: true, assignedUnits: assigned });
  }

  const booking = await Booking.findById(id).populate("vehicleId");
  if (!booking) return NextResponse.json({ error: "Booking not found" }, { status: 404 });
  const vehicle = booking.vehicleId as unknown as {
    _id: mongoose.Types.ObjectId;
    brand: string;
    model: string;
    pricing: { daily: number };
  } | null;
  const plates = (booking.assignedUnits || []).map((u) => u.licensePlate).filter(Boolean).join(", ");
  const carLabel = `${vehicle?.brand || ""} ${vehicle?.model || ""}${plates ? ` (${plates})` : ""}`.trim();

  if (a.action === "record_pickup") {
    if (!["confirmed", "awaiting_payment", "paid", "pending"].includes(booking.bookingStatus)) {
      return NextResponse.json({ error: "Le départ ne peut être enregistré que sur une réservation confirmée." }, { status: 409 });
    }
    await autoAssignUnits(id);
    booking.bookingStatus = "active";
    booking.pickupRecordedAt = new Date();
    if (a.mileage !== undefined) {
      booking.pickupMileage = a.mileage;
      await updateUnitMileage(booking, a.mileage);
    }
    booking.auditHistory.push({
      action: "Départ enregistré (véhicule remis au client)",
      performedBy: by,
      performedByRole: "staff",
      timestamp: new Date(),
      notes: [a.mileage !== undefined ? `Kilométrage départ : ${a.mileage} km` : "", a.notes || ""].filter(Boolean).join(" · "),
    });
    await booking.save();
    return NextResponse.json({ success: true, booking });
  }

  if (a.action === "record_return") {
    if (!["active", "confirmed", "paid", "awaiting_payment"].includes(booking.bookingStatus)) {
      return NextResponse.json({ error: "Seule une réservation en cours peut être clôturée par un retour." }, { status: 409 });
    }
    if (a.mileage !== undefined && booking.pickupMileage !== undefined && a.mileage < booking.pickupMileage) {
      return NextResponse.json({ error: `Kilométrage retour inférieur au départ (${booking.pickupMileage} km).` }, { status: 400 });
    }
    const returnedAt = a.returnedAt && !Number.isNaN(Date.parse(a.returnedAt)) ? new Date(a.returnedAt) : new Date();
    booking.bookingStatus = "completed";
    booking.returnRecordedAt = returnedAt;
    if (a.mileage !== undefined) {
      booking.returnMileage = a.mileage;
      await updateUnitMileage(booking, a.mileage);
    }
    const driven =
      a.mileage !== undefined && booking.pickupMileage !== undefined ? a.mileage - booking.pickupMileage : undefined;
    booking.auditHistory.push({
      action: "Retour véhicule enregistré — location clôturée",
      performedBy: by,
      performedByRole: "staff",
      timestamp: new Date(),
      notes: [
        a.mileage !== undefined ? `Kilométrage retour : ${a.mileage} km` : "",
        driven !== undefined ? `Parcourus : ${driven} km` : "",
        a.notes || "",
      ]
        .filter(Boolean)
        .join(" · "),
    });
    await booking.save();
    if (vehicle?._id) await Vehicle.findByIdAndUpdate(vehicle._id, { $inc: { availableUnits: 1 } }).catch(() => {});
    await notifyStaff({
      type: "return_recorded",
      severity: "success",
      title: { fr: `Retour effectué — ${booking.bookingReference}`, en: `Car returned — ${booking.bookingReference}`, ar: `تم الإرجاع — ${booking.bookingReference}` },
      message: {
        fr: `${carLabel} restitué${a.mileage !== undefined ? ` à ${a.mileage.toLocaleString("fr-FR")} km` : ""}.`,
        en: `${carLabel} returned${a.mileage !== undefined ? ` at ${a.mileage} km` : ""}.`,
        ar: `${carLabel}`,
      },
      link: `/admin/bookings/${id}`,
      data: { bookingId: id, licensePlate: plates },
    });
    return NextResponse.json({ success: true, booking });
  }

  // ── Extension at the base daily price
  if (!["active", "confirmed", "paid", "awaiting_payment"].includes(booking.bookingStatus)) {
    return NextResponse.json({ error: "Seule une réservation en cours ou confirmée peut être prolongée." }, { status: 409 });
  }
  const previousReturn = new Date(booking.returnDate);
  const [y, m, d] = a.newReturnDate.split("-").map(Number);
  const newReturn = new Date(previousReturn);
  newReturn.setUTCFullYear(y, m - 1, d);
  if (newReturn <= previousReturn) {
    return NextResponse.json({ error: "La nouvelle date de retour doit être après la date actuelle." }, { status: 400 });
  }
  const extraDays = computeRentalDays(previousReturn, newReturn);

  // The car must stay free for the extra days (it is physically with the customer).
  const vehicleId = String(vehicle?._id || booking.vehicleId);
  const stock = await getVehicleStockAvailability(vehicleId, previousReturn, newReturn, id);
  if (!stock.isAvailable) {
    return NextResponse.json({ error: "Aucun véhicule de ce modèle n'est libre pour la prolongation." }, { status: 409 });
  }
  const units = await ensureUnits(vehicleId);
  const myUnitIds = (booking.assignedUnits || []).map((u) => String(u.unitId || ""));
  const conflicting = await Booking.find({
    _id: { $ne: booking._id },
    bookingStatus: { $in: ["pending", "confirmed", "awaiting_payment", "paid", "active"] },
    pickupDate: { $lt: newReturn },
    returnDate: { $gt: previousReturn },
    "assignedUnits.unitId": { $in: myUnitIds.filter((x) => mongoose.Types.ObjectId.isValid(x)).map((x) => new mongoose.Types.ObjectId(x)) },
  })
    .select("bookingReference")
    .lean();

  const baseDaily = a.dailyRateTND !== undefined ? Math.round(a.dailyRateTND * 100) : Number(vehicle?.pricing?.daily || 0);
  const pb = booking.pricingBreakdown;
  const rentalAmount = baseDaily * extraDays;
  const perDayExtras = onlySelected(booking.extras)
    .filter((ex) => isPerDayPricing(ex.pricingType))
    .reduce((acc, ex) => acc + extraLineTotal(ex.price || 0, ex.quantity || 1, extraDays, "per_day"), 0);
  const oldDays = pb.rentalDays || booking.rentalDuration || 1;
  const perDayContrib = oldDays > 0 ? Math.round((pb.contributionLF2026 || 0) / oldDays) : 0;
  const contribAmount = perDayContrib * extraDays;
  const amount = rentalAmount + perDayExtras + contribAmount;

  const newDays = oldDays + extraDays;
  pb.subtotal = (pb.subtotal || 0) + rentalAmount;
  pb.extrasTotal = (pb.extrasTotal || 0) + perDayExtras;
  pb.contributionLF2026 = (pb.contributionLF2026 || 0) + contribAmount;
  pb.rentalDays = newDays;
  pb.totalAmount = (pb.totalAmount || 0) + amount;
  booking.rentalDuration = newDays;
  booking.returnDate = newReturn;
  if (a.newReturnTime) booking.returnTime = a.newReturnTime;
  for (const ex of booking.extras || []) {
    if (isPerDayPricing(ex.pricingType) && (ex.quantity || 0) > 0) {
      ex.lineTotal = extraLineTotal(ex.price || 0, ex.quantity || 1, newDays, "per_day");
    }
  }
  if (booking.paymentStatus === "paid") booking.paymentStatus = "partial";
  booking.extensions = [
    ...(booking.extensions || []),
    { previousReturnDate: previousReturn, newReturnDate: newReturn, extraDays, dailyRate: baseDaily, amount, at: new Date(), by },
  ];
  booking.auditHistory.push({
    action: "Prolongation de location",
    performedBy: by,
    performedByRole: "staff",
    timestamp: new Date(),
    previousValue: { returnDate: previousReturn },
    newValue: { returnDate: newReturn },
    notes: `+${extraDays} jour(s) au prix de base ${(baseDaily / 100).toFixed(3)} DT/j = ${(amount / 100).toFixed(3)} DT${a.notes ? ` · ${a.notes}` : ""}`,
  });
  booking.markModified("pricingBreakdown");
  await booking.save();

  // If the car assigned is already promised to someone else on the extra days, swap the other booking's car.
  const swapped: string[] = [];
  for (const c of conflicting) {
    const dropped = await revalidateAssignments(String(c._id));
    if (dropped.length) swapped.push(c.bookingReference);
  }

  await notifyStaff({
    type: "booking_extension",
    severity: swapped.length ? "warning" : "info",
    title: { fr: `Prolongation — ${booking.bookingReference}`, en: `Extension — ${booking.bookingReference}`, ar: `تمديد — ${booking.bookingReference}` },
    message: {
      fr: `${carLabel} prolongé de ${extraDays} j jusqu'au ${newReturn.toLocaleDateString("fr-FR")} (+${(amount / 100).toFixed(3)} DT).${swapped.length ? ` Véhicule réaffecté sur : ${swapped.join(", ")}.` : ""}`,
      en: `${carLabel} extended by ${extraDays} day(s) until ${newReturn.toLocaleDateString("en-GB")} (+${(amount / 100).toFixed(3)} TND).`,
      ar: `${carLabel} +${extraDays}`,
    },
    link: `/admin/bookings/${id}`,
    data: { bookingId: id, licensePlate: plates, extraDays, amount },
  });

  void units;
  return NextResponse.json({ success: true, booking, extraDays, amount, reassignedBookings: swapped });
}

/** Records the odometer on the assigned physical car(s) (never decreases it). */
async function updateUnitMileage(
  booking: { assignedUnits?: { vehicleId: mongoose.Types.ObjectId; unitId?: mongoose.Types.ObjectId }[] },
  mileage: number
) {
  for (const a of booking.assignedUnits || []) {
    if (!a.unitId) continue;
    await Vehicle.updateOne(
      { _id: a.vehicleId, "units._id": a.unitId, "units.mileage": { $lt: mileage } },
      { $set: { "units.$.mileage": mileage } }
    ).catch(() => {});
    break; // the odometer value belongs to the first (main) car
  }
}
