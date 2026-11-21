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
import { quoteBookingDates } from "@/lib/rentalQuote";
import { rentalDaysPrice } from "@/lib/seasonalPricing";
import { getRentalRules, priceSource } from "@/lib/rentalRules";
import { bookingMoney, recordPayment, resyncAfterPriceChange } from "@/lib/ledger";
import { logAudit } from "@/lib/audit";
import { ChangeError, changeVehicle } from "@/lib/vehicleChange";
import { notifyCustomerOfChange } from "@/lib/customerNotify";
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
      if (res.status < 300 && ["change_return", "extend", "record_pickup", "record_return", "assign_unit", "inspection", "change_vehicle"].includes(body.action) && !body.dryRun) {
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
        if (nextPickup || nextReturn) {
          updates.rentalDuration = computeRentalDays(p0, r0);
          // The price follows the dates (the agency may go below the minimum duration).
          const q = await quoteBookingDates(currentBooking, p0, r0);
          const pb = (currentBooking.pricingBreakdown as any).toObject ? (currentBooking.pricingBreakdown as any).toObject() : currentBooking.pricingBreakdown;
          updates.pricingBreakdown = { ...pb, rentalDays: q.days, subtotal: q.subtotal, extrasTotal: q.extrasTotal, dailyRate: q.lines[0]?.dailyRate ?? pb.dailyRate, contributionLF2026: q.contribution, totalAmount: q.total };
        }
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
      // A model change moves money (price difference, refund or balance): it has its own action.
      return NextResponse.json(
        { error: "Pour changer de voiture, utilisez « Changer de voiture » : le prix et le client sont mis à jour.", code: "USE_CHANGE_VEHICLE" },
        { status: 409 }
      );
    }
    // After a car change the rental is split between two cars: the start date can no longer move.
    if (updates.pickupDate && (currentBooking.vehicleChanges || []).length > 0) {
      return NextResponse.json({ error: "La voiture a été changée pendant cette location : la date de départ ne peut plus être modifiée." }, { status: 409 });
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
          // Same rules as a new booking: period price, model and period minimum, every fee kept.
          if ((currentBooking.vehicleChanges || []).length > 0) {
            return NextResponse.json({ error: "La voiture a été changée pendant cette location : modifiez les dates avec « Prolonger / réduire »." }, { status: 409 });
          }
          const q = await quoteBookingDates(currentBooking, new Date(mod.pickupDate), new Date(mod.returnDate));
          if (q.minError) return NextResponse.json({ error: `Impossible d'accepter : ${q.minError}` }, { status: 409 });
          updates.rentalDuration = q.days;
          const pb = (currentBooking.pricingBreakdown as any).toObject ? (currentBooking.pricingBreakdown as any).toObject() : currentBooking.pricingBreakdown;
          updates.pricingBreakdown = {
            ...pb,
            rentalDays: q.days,
            subtotal: q.subtotal,
            extrasTotal: q.extrasTotal,
            dailyRate: q.lines[0]?.dailyRate ?? pb.dailyRate,
            contributionLF2026: q.contribution,
            totalAmount: q.total,
          };
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
    // Cancelled while money is held: the team must give it back (or record a cancellation fee).
    if (booking && ["cancelled", "rejected"].includes(booking.bookingStatus) && !["cancelled", "rejected"].includes(oldBooking.bookingStatus)) {
      const held = await bookingMoney(id, 0);
      if (held.paid > 0 || held.depositHeld > 0) {
        await notifyStaff({
          type: "cancel_with_money",
          category: "payment",
          severity: "warning",
          title: { fr: `Annulée avec argent encaissé — ${booking.bookingReference}`, en: `Cancelled with money held — ${booking.bookingReference}`, ar: `ملغاة مع مبلغ مقبوض — ${booking.bookingReference}` },
          message: {
            fr: `Encaissé : ${(held.paid / 100).toFixed(3)} DT${held.depositHeld ? `, caution : ${(held.depositHeld / 100).toFixed(3)} DT` : ""}. Enregistrez le remboursement (ou les frais d'annulation) dans Encaissements.`,
            en: `Paid: ${(held.paid / 100).toFixed(3)} DT. Record the refund in Payments.`,
            ar: `${(held.paid / 100).toFixed(3)} DT`,
          },
          link: `/admin/accounting?tab=payments`,
          dedupeKey: `cancel_money:${id}`,
        });
      }
    }
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
  /** Email + WhatsApp link to the customer with the new total (default yes). */
  notifyCustomer: z.boolean().optional(),
  /** Price preview: nothing is saved. */
  dryRun: z.boolean().optional(),
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
  // Car change, possibly in the middle of the rental (breakdown, upgrade, customer request).
  z.object({
    action: z.literal("change_vehicle"),
    lineIndex: z.number().int().min(0).max(20).default(0),
    effectiveDate: z.string().regex(/^\d{4}-\d{2}-\d{2}$/),
    newVehicleId: z.string(),
    newUnitId: z.string().optional(),
    priceMode: z.enum(["recalculate", "keep"]).default("recalculate"),
    oldCarMileage: z.number().min(0).max(2_000_000).optional(),
    newCarMileage: z.number().min(0).max(2_000_000).optional(),
    oldCarToGarage: z.boolean().optional(),
    reason: z.string().trim().max(500).default(""),
    notifyCustomer: z.boolean().default(true),
    dryRun: z.boolean().optional(),
  }),
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

  if (a.action === "change_vehicle") {
    try {
      const res = await changeVehicle(id, a, by);
      if (!("money" in res)) return NextResponse.json({ success: true, quote: res.quote });
      return NextResponse.json({ success: true, quote: res.quote, money: res.money, customer: res.customer, movedElsewhere: res.movedElsewhere, booking: res.booking });
    } catch (err) {
      if (err instanceof ChangeError) return NextResponse.json({ error: err.message, code: err.code }, { status: err.status });
      throw err;
    }
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
  const plates = (booking.assignedUnits || []).filter((u) => !u.to).map((u) => u.licensePlate).filter(Boolean).join(", ");
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
    // Editing a report must never silently drop the customer's signature: keep the previous one
    // unless a new one was drawn.
    const previous = booking.get(key) as { signatureUrl?: string } | undefined;
    booking.set(key, {
      at: new Date(),
      by,
      mileage: a.mileage,
      fuelLevel: a.fuelLevel,
      cleanliness: a.cleanliness,
      damages: a.damages,
      photos: a.photos,
      checklist: a.checklist,
      signatureUrl: a.signatureUrl || previous?.signatureUrl,
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
        // Only the car brought back now (a car replaced earlier was handled at the change).
        if (!u.unitId || u.to) continue;
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
  // After a car change the new car must keep at least one day.
  const lastSwitch = (booking.assignedUnits || [])
    .filter((x) => !x.to && x.from)
    .map((x) => new Date(x.from as Date))
    .sort((x, y) => y.getTime() - x.getTime())[0];
  if (lastSwitch && holdDays(newReturn, newReturn)[0] <= holdDays(lastSwitch, lastSwitch)[0]) {
    return NextResponse.json(
      { error: `La voiture a été changée le ${lastSwitch.toLocaleDateString("fr-FR", { timeZone: "UTC" })} : le retour doit être après cette date.` },
      { status: 409 }
    );
  }
  // Rate of the car the customer has now (it can differ from the start of the rental after a car change).
  const changes = booking.vehicleChanges || [];
  const currentRate = changes.length && (booking.vehicles?.length || 1) === 1 ? changes[changes.length - 1].newDailyRate : null;
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
    // Mixed price: each extra day at the rate of the period it falls in (same rule as a booking
    // spanning two periods), for the car the customer has now (after a car change: the new model),
    // with the model's degressive tariff for the new total duration. Each car of a multi-car
    // booking at its own model's rate. A custom price (pricing.edit) wins.
    const ids = booking.vehicles && booking.vehicles.length > 0 ? booking.vehicles.map((v) => String(v.vehicleId)) : [String(vehicle?._id || booking.vehicleId)];
    let rental: number;
    if (a.dailyRateTND !== undefined) {
      dailyUsed = Math.round(a.dailyRateTND * 100);
      rental = dailyUsed * delta * ids.length;
    } else {
      const models = await Vehicle.find({ _id: { $in: ids } }).lean();
      const rules = await getRentalRules();
      const pickupDay = holdDays(booking.pickupDate, booking.pickupDate)[0];
      const rate = (vid: string) => {
        const m = models.find((x) => String(x._id) === vid);
        return m
          ? rentalDaysPrice(priceSource(m, rules), pickupDay, oldDays, newDays, newDays)
          : Number(currentRate ?? vehicle?.pricing?.daily ?? 0) * delta;
      };
      rental = ids.reduce((acc, vid) => acc + rate(vid), 0);
      dailyUsed = Math.round(rental / delta / ids.length);
    }
    const extras = perDayExtras(delta);
    amount = rental + extras + perDayContrib * delta;
    pb.subtotal = (pb.subtotal || 0) + rental;
    pb.extrasTotal = (pb.extrasTotal || 0) + extras;
  } else if (delta < 0) {
    // Reduction: the removed days are the last ones. After a car change they are at the current
    // car's rate. Otherwise each removed day is refunded at the share of the price it really cost:
    // with a mixed price (two periods) a high-season day weighs more than a low-season day.
    const removed = -delta;
    let refundRental: number;
    if (currentRate !== null) {
      refundRental = currentRate * removed;
    } else {
      const ids = booking.vehicles && booking.vehicles.length > 0 ? booking.vehicles.map((v) => String(v.vehicleId)) : [String(vehicle?._id || booking.vehicleId)];
      const models = await Vehicle.find({ _id: { $in: ids } }).lean();
      const rules = await getRentalRules();
      const pickupDay = holdDays(booking.pickupDate, booking.pickupDate)[0];
      let part = 0;
      let all = 0;
      for (const vid of ids) {
        const m = models.find((x) => String(x._id) === vid);
        if (!m) continue;
        const src = priceSource(m, rules);
        part += rentalDaysPrice(src, pickupDay, newDays, oldDays, oldDays);
        all += rentalDaysPrice(src, pickupDay, 0, oldDays, oldDays);
      }
      refundRental = all > 0 ? Math.round(((pb.subtotal || 0) * part) / all) : Math.round(((pb.subtotal || 0) * removed) / oldDays);
    }
    const rental = Math.min(pb.subtotal || 0, refundRental);
    dailyUsed = Math.round(rental / removed);
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
  // Preview for the form: nothing is saved.
  if (a.dryRun) {
    return NextResponse.json({ success: true, quote: { extraDays: delta, dailyRate: dailyUsed, amount, newTotal: pb.totalAmount } });
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

  // The customer is told about the new date and the new amount (email + ready WhatsApp link).
  let customer: { emailSent: boolean; whatsappUrl: string | null } = { emailSent: false, whatsappUrl: null };
  const money = await bookingMoney(id, pb.totalAmount || 0);
  if (a.notifyCustomer !== false && delta !== 0) {
    const fr = newReturn.toLocaleDateString("fr-FR", { day: "numeric", month: "long", year: "numeric", timeZone: "UTC" });
    const en = newReturn.toLocaleDateString("en-GB", { day: "numeric", month: "long", year: "numeric", timeZone: "UTC" });
    const abs = `${(Math.abs(amount) / 100).toFixed(3)} DT`;
    customer = await notifyCustomerOfChange(id, {
      kind: "dates_change",
      lines: {
        fr: [`Nouvelle date de retour : ${fr}${booking.returnTime ? ` à ${booking.returnTime}` : ""} (${delta > 0 ? "prolongation" : "réduction"} de ${Math.abs(delta)} jour(s)).`, `${delta > 0 ? "Supplément" : "Montant déduit"} : ${abs}.`],
        en: [`New return date: ${en}${booking.returnTime ? ` at ${booking.returnTime}` : ""} (${delta > 0 ? "extended" : "shortened"} by ${Math.abs(delta)} day(s)).`, `${delta > 0 ? "Extra charge" : "Amount deducted"}: ${abs}.`],
        ar: [`تاريخ الإرجاع الجديد: ${en}`, `${delta > 0 ? "مبلغ إضافي" : "مبلغ مخصوم"}: ${abs}`],
      },
      total: money.total,
      paid: money.paid,
      remaining: money.remaining,
      refundDue: money.refundDue,
    });
  }
  return NextResponse.json({ success: true, booking, extraDays: delta, amount, money, customer });
}

/** Records the odometer on the assigned physical car(s) (never decreases it). */
async function updateUnitMileage(
  booking: { assignedUnits?: { vehicleId: mongoose.Types.ObjectId; unitId?: mongoose.Types.ObjectId; to?: Date }[] },
  mileage: number
) {
  for (const a of booking.assignedUnits || []) {
    if (!a.unitId || a.to) continue;
    await Vehicle.updateOne(
      { _id: a.vehicleId, "units._id": a.unitId, "units.mileage": { $lt: mileage } },
      { $set: { "units.$.mileage": mileage } }
    ).catch(() => {});
    break; // the odometer value belongs to the first (main) car
  }
}
