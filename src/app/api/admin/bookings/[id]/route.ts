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
import { getRentalRules, priceSource } from "@/lib/rentalRules";
import { bookingMoney, recordPayment, resyncAfterPriceChange } from "@/lib/ledger";
import { logAudit } from "@/lib/audit";
import { getVehicleStockAvailability } from "@/lib/availability";
import {
  assignUnitManually,
  autoAssignUnits,
  canKeepUnitsUntil,
  releaseBooking,
  holdDays,
  reassignBookingsOfUnit,
  syncBookingAssignment,
  listUnitAvailability,
} from "@/lib/fleetUnits";
import { notifyStaff } from "@/lib/notify";
import { modelsOfBooking } from "@/lib/bookingOverlap";

async function checkAdmin(level: string = "edit") {
  const guard = await requirePermission("bookings", level);
  return guard;
}

export async function GET(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  const guard = await checkAdmin("view");
  if (!guard.ok) return guard.response;
  const session = guard.session;

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
  const guard = await checkAdmin();
  if (!guard.ok) return guard.response;
  const session = guard.session;

  const { id } = await params;
  if (!mongoose.Types.ObjectId.isValid(id)) {
    return NextResponse.json({ error: "Booking not found" }, { status: 404 });
  }
  try {
    await connectDB();
    const body = await request.json();

    if (typeof body.action === "string") {
      // A custom price for extra days is a pricing decision: reserved to roles allowed to edit prices.
      if (body.dailyRateTND !== undefined && body.dailyRateTND !== null) {
        const priceGuard = await requirePermission("pricing", "edit");
        if (!priceGuard.ok) {
          return NextResponse.json(
            { success: false, error: "Votre rôle ne permet pas de modifier le prix. Le tarif standard s'applique.", code: "PRICE_NOT_ALLOWED" },
            { status: 403 }
          );
        }
      }
      const res = await handleAction(id, body, session.user?.email || "Admin");
      if (res.status < 300 && ["change_return", "extend", "record_pickup", "record_return", "assign_unit", "inspection"].includes(body.action)) {
        const { action, damages, photos, checklist, signatureUrl, ...detail } = body as Record<string, unknown>;
        void damages; void photos; void checklist; void signatureUrl;
        await logAudit(session, `booking.${action}`, "booking", id, { after: detail });
      }
      return res;
    }

    const parsed = updateSchema.safeParse(body);

    // Cancelling / refusing a booking is its own permission ("bookings.cancel").
    if (parsed.success && (parsed.data.status === "cancelled" || parsed.data.status === "rejected")) {
      const cancelGuard = await requirePermission("bookings", "cancel");
      if (!cancelGuard.ok) return cancelGuard.response;
    }

    if (!parsed.success) {
      return NextResponse.json({ error: parsed.error.issues[0]?.message || "Validation error" }, { status: 400 });
    }

    // Strict whitelist: amounts, options, deposit, customer and audit data can never be written
    // through the generic update (prices are always recomputed by the server).
    const EDITABLE = [
      "internalNote", "internalNotes", "adminNotes", "vehicleId",
      "pickupDate", "returnDate", "pickupTime", "returnTime", "actualPickupDate", "actualReturnDate",
    ] as const;
    const updates: Record<string, unknown> = {};
    for (const k of EDITABLE) {
      const v = (parsed.data as Record<string, unknown>)[k];
      if (v !== undefined && (typeof v === "string" || typeof v === "number")) updates[k] = v;
    }
    if (parsed.data.status) {
      updates.bookingStatus = parsed.data.status;
    }

    const currentBooking = await Booking.findById(id).populate("vehicleId").populate("customerId");
    if (!currentBooking) return NextResponse.json({ error: "Booking not found" }, { status: 404 });

    // The payment status follows the ledger. "Payé" from the booking form records the remaining
    // balance as a payment (so there is always a receipt and a name behind the money).
    if (parsed.data.paymentStatus && parsed.data.paymentStatus !== currentBooking.paymentStatus) {
      const money = await bookingMoney(id, currentBooking.pricingBreakdown?.totalAmount || 0);
      if (parsed.data.paymentStatus === "paid") {
        if (money.remaining > 0) {
          const payGuard = await requirePermission("payments", "create");
          if (!payGuard.ok) return payGuard.response;
          const method = ["cash", "card", "bank_transfer", "cheque", "online"].includes(String(currentBooking.paymentMethod)) ? String(currentBooking.paymentMethod) : "cash";
          await recordPayment({ bookingId: id, kind: "payment", amount: money.remaining, method: method as "cash", recordedBy: session.user?.email || "Admin", notes: "Solde marqué payé depuis la réservation" });
        }
      } else if (money.paid === 0 && money.depositHeld === 0) {
        // No movement in the ledger: the manual status (legacy bookings) is still accepted.
        updates.paymentStatus = parsed.data.paymentStatus;
      } else {
        return NextResponse.json(
          { error: "Des paiements sont enregistrés pour cette réservation : annulez ou remboursez-les dans Encaissements, le statut suivra." },
          { status: 409 }
        );
      }
    }

    // Manual date / model change by the admin: the new window must be really available.
    {
      const nextPickup = typeof updates.pickupDate === "string" ? new Date(updates.pickupDate) : null;
      const nextReturn = typeof updates.returnDate === "string" ? new Date(updates.returnDate) : null;
      const nextModel = typeof updates.vehicleId === "string" && mongoose.Types.ObjectId.isValid(updates.vehicleId) ? updates.vehicleId : null;
      if ((nextPickup && Number.isNaN(nextPickup.getTime())) || (nextReturn && Number.isNaN(nextReturn.getTime()))) {
        return NextResponse.json({ error: "Dates invalides" }, { status: 400 });
      }
      const currentModel = String((currentBooking.vehicleId as any)?._id || currentBooking.vehicleId || "");
      if (nextPickup || nextReturn || (nextModel && nextModel !== currentModel)) {
        const p0 = nextPickup || currentBooking.pickupDate;
        const r0 = nextReturn || currentBooking.returnDate;
        if (r0 <= p0) return NextResponse.json({ error: "Le retour doit être après le départ." }, { status: 400 });
        const models = nextModel && nextModel !== currentModel ? [nextModel] : modelsOfBooking(currentBooking as never);
        const wanted = new Map<string, number>();
        models.forEach((mId) => wanted.set(mId, (wanted.get(mId) || 0) + 1));
        for (const [mId, count] of wanted) {
          const stock = await getVehicleStockAvailability(mId, p0, r0, id);
          if (stock.availableUnits < count) {
            return NextResponse.json({ error: "Aucun véhicule de ce modèle n'est libre sur cette période." }, { status: 409 });
          }
        }
        if (nextPickup) updates.pickupDate = nextPickup;
        if (nextReturn) updates.returnDate = nextReturn;
        if (nextPickup || nextReturn) updates.rentalDuration = computeRentalDays(p0, r0);
      }
    }

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
        // Approving new dates requires real availability on those dates.
        if (mod.pickupDate && mod.returnDate) {
          const wanted = new Map<string, number>();
          for (const mId of modelsOfBooking(currentBooking as never)) wanted.set(mId, (wanted.get(mId) || 0) + 1);
          for (const [mId, count] of wanted) {
            const stock = await getVehicleStockAvailability(mId, new Date(mod.pickupDate), new Date(mod.returnDate), id);
            if (stock.availableUnits < count) {
              return NextResponse.json(
                { error: "Impossible d'accepter : le véhicule n'est pas disponible sur les dates demandées." },
                { status: 409 }
              );
            }
          }
        }
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
              ? calculateSeasonalRentalTotal(priceSource(veh, await getRentalRules()), iso(mod.pickupDate), iso(mod.returnDate)).subtotal
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
    if (updates.pricingBreakdown) await resyncAfterPriceChange(id);
    await logAudit(session, updates.pricingBreakdown ? "booking.price" : "booking.update", "booking", id, {
      before: {
        status: oldBooking.bookingStatus,
        pickup: oldBooking.pickupDate?.toISOString().slice(0, 10),
        return: oldBooking.returnDate?.toISOString().slice(0, 10),
        total: oldBooking.pricingBreakdown?.totalAmount,
      },
      after: {
        status: booking?.bookingStatus,
        pickup: booking?.pickupDate?.toISOString().slice(0, 10),
        return: booking?.returnDate?.toISOString().slice(0, 10),
        total: booking?.pricingBreakdown?.totalAmount,
      },
    });

    if (!booking) return NextResponse.json({ error: "Booking not found" }, { status: 404 });

    // Every change (dates, model, status) goes through the assignment engine:
    // cancelled / completed bookings release their car, the others keep or get one unique car.
    await syncBookingAssignment(id).catch((e) => console.error("syncBookingAssignment:", e));

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
  const guard = await checkAdmin("delete");
  if (!guard.ok) return guard.response;
  const session = guard.session;

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
    await releaseBooking(id);
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

const hhmm = z.string().regex(/^([01]\d|2[0-3]):[0-5]\d$/);
const changeReturn = {
  newReturnDate: z.string().regex(/^\d{4}-\d{2}-\d{2}$/),
  newReturnTime: hhmm.optional(),
  /** Daily price applied to extra days, in TND. Defaults to the model's base daily price. */
  dailyRateTND: z.number().min(0).max(100000).optional(),
  notes: z.string().max(1000).optional(),
};

/** Only documents stored by our own private upload route. */
const docUrl = z.string().regex(/^\/api\/admin\/documents\/[a-f0-9]{24}$/, "Document invalide");

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
    /** State of the car after the return: back in service, or sent to the garage. */
    unitStatus: z.enum(["active", "maintenance"]).optional(),
  }),
  // "extend" kept for older clients; change_return handles both extension and reduction.
  z.object({ action: z.literal("extend"), ...changeReturn }),
  z.object({ action: z.literal("change_return"), ...changeReturn }),
  z.object({ action: z.literal("add_note"), note: z.string().trim().min(1).max(1000) }),
  // Vehicle condition report at departure or return.
  z.object({
    action: z.literal("inspection"),
    stage: z.enum(["pickup", "return"]),
    mileage: z.number().min(0).max(2_000_000).optional(),
    fuelLevel: z.number().int().min(0).max(8).optional(),
    cleanliness: z.enum(["clean", "acceptable", "dirty"]).optional(),
    damages: z.array(z.object({ zone: z.string().trim().min(1).max(60), description: z.string().trim().max(300).default(""), photoUrl: docUrl.optional() })).max(30).default([]),
    photos: z.array(docUrl).max(20).default([]),
    checklist: z.record(z.string().max(30), z.boolean()).optional(),
    signatureUrl: docUrl.optional(),
    customerName: z.string().trim().max(120).optional(),
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

  if (a.action === "add_note") {
    const stamp = `[${new Date().toLocaleString("fr-FR")} — ${by}] ${a.note}`;
    booking.internalNotes = [booking.internalNotes, stamp].filter(Boolean).join("\n").slice(-4000);
    booking.auditHistory.push({ action: "Note ajoutée", performedBy: by, performedByRole: "staff", timestamp: new Date(), notes: a.note });
    await booking.save();
    return NextResponse.json({ success: true, booking });
  }

  if (a.action === "inspection") {
    const key = a.stage === "pickup" ? "pickupInspection" : "returnInspection";
    if (a.stage === "return" && typeof a.mileage === "number" && typeof booking.pickupMileage === "number" && a.mileage < booking.pickupMileage) {
      return NextResponse.json({ error: `Kilométrage retour inférieur au kilométrage de départ (${booking.pickupMileage} km).` }, { status: 400 });
    }
    booking.set(key, {
      at: new Date(),
      by,
      mileage: a.mileage,
      fuelLevel: a.fuelLevel,
      cleanliness: a.cleanliness,
      damages: a.damages,
      photos: a.photos,
      checklist: a.checklist,
      signatureUrl: a.signatureUrl,
      customerName: a.customerName,
      notes: a.notes,
    });
    booking.auditHistory.push({
      action: a.stage === "pickup" ? "État des lieux de départ" : "État des lieux de retour",
      performedBy: by,
      performedByRole: "staff",
      timestamp: new Date(),
      notes: `${a.damages.length} dommage(s), carburant ${a.fuelLevel ?? "?"}/8${typeof a.mileage === "number" ? `, ${a.mileage} km` : ""}`,
    });
    await booking.save();
    // New damage found at return: the manager must know before the deposit is given back.
    if (a.stage === "return") {
      const known = new Set((booking.pickupInspection?.damages || []).map((d) => `${d.zone}|${d.description}`.toLowerCase()));
      const fresh = a.damages.filter((d) => !known.has(`${d.zone}|${d.description}`.toLowerCase()));
      const lessFuel = typeof a.fuelLevel === "number" && typeof booking.pickupInspection?.fuelLevel === "number" && a.fuelLevel < booking.pickupInspection.fuelLevel;
      if (fresh.length > 0 || lessFuel) {
        notifyStaff({
          type: "return_issue",
          category: "booking",
          severity: "warning",
          title: {
            fr: `Retour avec réserve — ${booking.bookingReference}`,
            en: `Return with issues — ${booking.bookingReference}`,
            ar: `إرجاع مع ملاحظات — ${booking.bookingReference}`,
          },
          message: {
            fr: `${carLabel} : ${[fresh.length ? `${fresh.length} nouveau(x) dommage(s) (${fresh.map((d) => d.zone).join(", ")})` : "", lessFuel ? `carburant ${a.fuelLevel}/8 au lieu de ${booking.pickupInspection?.fuelLevel}/8` : ""].filter(Boolean).join(" ; ")}. À traiter avant de restituer la caution.`,
            en: `${carLabel}: ${fresh.length} new damage(s)${lessFuel ? ", less fuel" : ""}. Check before giving the deposit back.`,
            ar: `${carLabel}`,
          },
          link: `/admin/bookings/${id}`,
          dedupeKey: `return_issue:${id}:${fresh.length}:${a.fuelLevel ?? ""}`,
        }).catch(() => {});
      }
    }
    return NextResponse.json({ success: true, booking });
  }

  if (a.action === "record_pickup") {
    if (!["confirmed", "awaiting_payment", "paid", "pending"].includes(booking.bookingStatus)) {
      return NextResponse.json({ error: "Le départ ne peut être enregistré que sur une réservation confirmée." }, { status: 409 });
    }
    // A departure needs one unique physical car per booked car (a plate is not required).
    const sync = await syncBookingAssignment(id);
    if (sync.unassigned > 0) {
      return NextResponse.json(
        { error: "Aucun véhicule physique libre pour ce départ : tous les véhicules de ce modèle sont déjà affectés sur ces dates." },
        { status: 409 }
      );
    }
    booking.bookingStatus = "active";
    booking.pickupRecordedAt = new Date();
    if (a.mileage !== undefined) {
      booking.pickupMileage = a.mileage;
      await updateUnitMileage({ assignedUnits: sync.assigned.map((u) => ({ vehicleId: new mongoose.Types.ObjectId(u.vehicleId), unitId: u.unitId ? new mongoose.Types.ObjectId(u.unitId) : undefined })) }, a.mileage);
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
      return NextResponse.json({ error: `Kilométrage retour inférieur au kilométrage de départ (${booking.pickupMileage} km).` }, { status: 400 });
    }
    const returnedAt = a.returnedAt && !Number.isNaN(Date.parse(a.returnedAt)) ? new Date(a.returnedAt) : new Date();
    booking.bookingStatus = "completed";
    booking.returnRecordedAt = returnedAt;
    booking.returnRecordedBy = by;
    if (a.notes) booking.returnNotes = a.notes;
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
        a.unitStatus === "maintenance" ? "Véhicule envoyé au garage" : "",
        a.notes || "",
      ]
        .filter(Boolean)
        .join(" · "),
    });
    await booking.save();
    await syncBookingAssignment(id); // frees the car for the next customer
    if (a.unitStatus === "maintenance") {
      for (const u of booking.assignedUnits || []) {
        if (!u.unitId) continue;
        await Vehicle.updateOne({ _id: u.vehicleId, "units._id": u.unitId }, { $set: { "units.$.status": "maintenance" } });
        await reassignBookingsOfUnit(String(u.unitId));
      }
    }
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

  // ── Change of return date: extension (later) or reduction (earlier) ──────────────
  if (!["active", "confirmed", "paid", "awaiting_payment", "pending"].includes(booking.bookingStatus)) {
    return NextResponse.json({ error: "Seule une réservation en cours ou à venir peut être modifiée." }, { status: 409 });
  }
  const previousReturn = new Date(booking.returnDate);
  const [y, m, d] = a.newReturnDate.split("-").map(Number);
  const newReturn = new Date(previousReturn);
  newReturn.setUTCFullYear(y, m - 1, d);
  if (holdDays(previousReturn, previousReturn)[0] === a.newReturnDate && !a.newReturnTime) {
    return NextResponse.json({ error: "La date de retour est identique." }, { status: 400 });
  }
  const pb = booking.pricingBreakdown;
  const oldDays = pb.rentalDays || booking.rentalDuration || 1;
  const newDays = computeRentalDays(booking.pickupDate, newReturn);
  if (newReturn <= new Date(booking.pickupDate)) {
    return NextResponse.json({ error: "Le retour doit rester après la date de départ." }, { status: 400 });
  }
  const delta = newDays - oldDays;
  const perDayContrib = oldDays > 0 ? Math.round((pb.contributionLF2026 || 0) / oldDays) : 0;
  const perDayExtras = (days: number) =>
    onlySelected(booking.extras)
      .filter((ex) => isPerDayPricing(ex.pricingType))
      .reduce((acc, ex) => acc + extraLineTotal(ex.price || 0, ex.quantity || 1, days, "per_day"), 0);
  let amount = 0;
  let dailyUsed = 0;

  if (delta > 0) {
    // The SAME physical car must be free for the extra days.
    const keep = await canKeepUnitsUntil(id, newReturn);
    if (!keep.ok) {
      return NextResponse.json(
        {
          error: `Extension impossible. Véhicule déjà réservé${keep.blockedBy ? ` (réservation ${keep.blockedBy})` : ""}.`,
          code: "VEHICLE_ALREADY_RESERVED",
        },
        { status: 409 }
      );
    }
    dailyUsed = a.dailyRateTND !== undefined ? Math.round(a.dailyRateTND * 100) : Number(vehicle?.pricing?.daily || 0);
    const rental = dailyUsed * delta * Math.max(1, booking.vehicles?.length || 1);
    const extras = perDayExtras(delta);
    amount = rental + extras + perDayContrib * delta;
    pb.subtotal = (pb.subtotal || 0) + rental;
    pb.extrasTotal = (pb.extrasTotal || 0) + extras;
  } else if (delta < 0) {
    // Reduction: the removed days are refunded at the booking's average daily price.
    const removed = -delta;
    dailyUsed = Math.round((pb.subtotal || 0) / oldDays);
    const rental = Math.round(((pb.subtotal || 0) * removed) / oldDays);
    const extras = perDayExtras(removed);
    amount = -(rental + extras + perDayContrib * removed);
    pb.subtotal = Math.max(0, (pb.subtotal || 0) - rental);
    pb.extrasTotal = Math.max(0, (pb.extrasTotal || 0) - extras);
  }
  pb.contributionLF2026 = Math.max(0, perDayContrib * newDays);
  pb.rentalDays = newDays;
  pb.totalAmount = Math.max(0, (pb.totalAmount || 0) + amount);
  booking.rentalDuration = newDays;
  booking.returnDate = newReturn;
  if (a.newReturnTime) booking.returnTime = a.newReturnTime;
  for (const ex of booking.extras || []) {
    if (isPerDayPricing(ex.pricingType) && (ex.quantity || 0) > 0) {
      ex.lineTotal = extraLineTotal(ex.price || 0, ex.quantity || 1, newDays, "per_day");
    }
  }
  if (delta > 0 && booking.paymentStatus === "paid") booking.paymentStatus = "partial";
  booking.extensions = [
    ...(booking.extensions || []),
    { previousReturnDate: previousReturn, newReturnDate: newReturn, extraDays: delta, dailyRate: dailyUsed, amount, at: new Date(), by },
  ];
  const fmtAmt = `${amount >= 0 ? "+" : "−"}${(Math.abs(amount) / 100).toFixed(3)} DT`;
  booking.auditHistory.push({
    action: delta > 0 ? "Prolongation de location" : delta < 0 ? "Réduction de la durée" : "Heure de retour modifiée",
    performedBy: by,
    performedByRole: "staff",
    timestamp: new Date(),
    previousValue: { returnDate: previousReturn },
    newValue: { returnDate: newReturn },
    notes: `${delta > 0 ? "+" : ""}${delta} jour(s) · ${fmtAmt}${a.notes ? ` · ${a.notes}` : ""}`,
  });
  booking.markModified("pricingBreakdown");
  await booking.save();
  await resyncAfterPriceChange(id);
  // Claims the extra days (or frees the removed ones): calendar and availability follow immediately.
  await syncBookingAssignment(id);

  await notifyStaff({
    type: "booking_extension",
    severity: "info",
    title: {
      fr: `${delta >= 0 ? "Prolongation" : "Réduction"} — ${booking.bookingReference}`,
      en: `${delta >= 0 ? "Extension" : "Shortened"} — ${booking.bookingReference}`,
      ar: `تعديل — ${booking.bookingReference}`,
    },
    message: {
      fr: `${carLabel} : retour le ${newReturn.toLocaleDateString("fr-FR")} (${delta > 0 ? "+" : ""}${delta} j, ${fmtAmt}).`,
      en: `${carLabel}: return on ${newReturn.toLocaleDateString("en-GB")} (${delta > 0 ? "+" : ""}${delta} d, ${fmtAmt}).`,
      ar: `${carLabel}`,
    },
    link: `/admin/bookings/${id}`,
    data: { bookingId: id, licensePlate: plates, extraDays: delta, amount },
  });

  return NextResponse.json({ success: true, booking, extraDays: delta, amount });
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
