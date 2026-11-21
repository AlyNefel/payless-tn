import mongoose from "mongoose";
import connectDB from "./db";
import Booking from "@/models/Booking";
import Payment, { type IPayment, type PaymentKind, type PaymentMethod } from "@/models/Payment";
import AgencySetting from "@/models/AgencySetting";
import { nextNumber } from "@/models/Counter";

export const PAYMENT_KIND_LABELS: Record<PaymentKind, string> = {
  payment: "Paiement",
  deposit: "Caution encaissée",
  refund: "Remboursement",
  deposit_refund: "Caution restituée",
};
export const PAYMENT_METHOD_LABELS: Record<string, string> = {
  cash: "Espèces",
  card: "Carte bancaire",
  bank_transfer: "Virement",
  cheque: "Chèque",
  online: "Paiement en ligne",
  other: "Autre",
};

export interface BookingMoney {
  total: number;
  paid: number;
  remaining: number;
  /** Paid more than the (new) total: amount owed back to the customer. */
  refundDue: number;
  depositHeld: number;
  paymentStatus: "unpaid" | "partial" | "paid" | "refunded";
}

/** Totals of a booking from the ledger (voided movements ignored). */
export async function bookingMoney(bookingId: string, total: number): Promise<BookingMoney> {
  const rows = await Payment.aggregate<{ _id: PaymentKind; sum: number }>([
    { $match: { bookingId: new mongoose.Types.ObjectId(bookingId), status: "completed" } },
    { $group: { _id: "$kind", sum: { $sum: "$amount" } } },
  ]);
  const by = Object.fromEntries(rows.map((r) => [r._id, r.sum])) as Partial<Record<PaymentKind, number>>;
  const paid = (by.payment || 0) - (by.refund || 0);
  const depositHeld = (by.deposit || 0) - (by.deposit_refund || 0);
  const paymentStatus = paid <= 0 ? ((by.refund || 0) > 0 ? "refunded" : "unpaid") : paid >= total ? "paid" : "partial";
  return { total, paid, remaining: Math.max(0, total - paid), refundDue: Math.max(0, paid - total), depositHeld, paymentStatus };
}

/** Recomputes and stores the payment state of a booking. The ledger is the single source of truth. */
export async function syncBookingMoney(bookingId: string): Promise<BookingMoney | null> {
  await connectDB();
  const booking = await Booking.findById(bookingId).select("pricingBreakdown.totalAmount paymentStatus");
  if (!booking) return null;
  const money = await bookingMoney(bookingId, booking.pricingBreakdown?.totalAmount || 0);
  await Booking.updateOne(
    { _id: booking._id },
    { $set: { amountPaid: money.paid, depositHeld: money.depositHeld, paymentStatus: money.paymentStatus } }
  );
  return money;
}

/** Re-syncs a booking whose total changed (extension, new dates) — only when it has ledger movements. */
export async function resyncAfterPriceChange(bookingId: string): Promise<void> {
  try {
    if (await Payment.exists({ bookingId, status: "completed" })) await syncBookingMoney(bookingId);
  } catch (err) {
    console.error("resyncAfterPriceChange:", err);
  }
}

export class LedgerError extends Error {
  status: number;
  constructor(message: string, status = 400) {
    super(message);
    this.status = status;
  }
}

export interface PaymentInput {
  bookingId: string;
  kind: PaymentKind;
  amount: number; // minor units
  method: PaymentMethod;
  reference?: string;
  notes?: string;
  paidAt?: Date;
  recordedBy: string;
}

/**
 * Records one money movement and returns it with the booking's new totals.
 * Refuses amounts that cannot be right: paying more than what is due, refunding more than what was
 * paid, giving back more deposit than what is held.
 */
export async function recordPayment(input: PaymentInput): Promise<{ payment: IPayment; money: BookingMoney }> {
  await connectDB();
  if (!mongoose.Types.ObjectId.isValid(input.bookingId)) throw new LedgerError("Réservation introuvable", 404);
  if (!Number.isInteger(input.amount) || input.amount <= 0) throw new LedgerError("Montant invalide");
  const booking = await Booking.findById(input.bookingId).populate("customerId", "firstName lastName");
  if (!booking) throw new LedgerError("Réservation introuvable", 404);
  const total = booking.pricingBreakdown?.totalAmount || 0;
  const before = await bookingMoney(input.bookingId, total);
  const tnd = (n: number) => `${(n / 100).toFixed(3)} DT`;

  if (input.kind === "payment" && input.amount > before.remaining) {
    throw new LedgerError(`Montant supérieur au reste à payer (${tnd(before.remaining)}).`);
  }
  if (input.kind === "refund" && input.amount > before.paid) {
    throw new LedgerError(`Remboursement supérieur au montant encaissé (${tnd(before.paid)}).`);
  }
  if (input.kind === "deposit_refund" && input.amount > before.depositHeld) {
    throw new LedgerError(`Restitution supérieure à la caution détenue (${tnd(before.depositHeld)}).`);
  }
  const paidAt = input.paidAt && !Number.isNaN(input.paidAt.getTime()) ? input.paidAt : new Date();
  if (paidAt.getTime() > Date.now() + 86_400_000) throw new LedgerError("La date du paiement est dans le futur.");

  const customer = booking.customerId as unknown as { _id?: mongoose.Types.ObjectId; firstName?: string; lastName?: string } | null;
  const payment = await Payment.create({
    receiptNumber: await nextNumber("REC", paidAt),
    bookingId: booking._id,
    bookingReference: booking.bookingReference,
    customerId: customer?._id,
    customerName: `${customer?.firstName || ""} ${customer?.lastName || ""}`.trim(),
    kind: input.kind,
    amount: input.amount,
    method: input.method,
    reference: input.reference?.trim() || undefined,
    notes: input.notes?.trim() || undefined,
    paidAt,
    recordedBy: input.recordedBy,
  });
  const money = (await syncBookingMoney(input.bookingId))!;
  return { payment, money };
}

/** Cancels a movement (it stays in the ledger, marked void). Movements already counted in a cash closing are locked. */
export async function voidPayment(id: string, by: string, reason: string): Promise<BookingMoney | null> {
  await connectDB();
  if (!mongoose.Types.ObjectId.isValid(id)) throw new LedgerError("Mouvement introuvable", 404);
  const payment = await Payment.findById(id);
  if (!payment) throw new LedgerError("Mouvement introuvable", 404);
  if (payment.status === "voided") throw new LedgerError("Ce mouvement est déjà annulé.");
  if (payment.closingId) throw new LedgerError("Mouvement déjà compté dans une clôture de caisse : enregistrez un remboursement à la place.", 409);
  if (!reason.trim()) throw new LedgerError("Le motif d'annulation est obligatoire.");
  payment.status = "voided";
  payment.voidedAt = new Date();
  payment.voidedBy = by;
  payment.voidReason = reason.trim().slice(0, 300);
  await payment.save();
  return syncBookingMoney(String(payment.bookingId));
}

/** VAT rate (percent) used for invoices and VAT estimates. Prices on the site are tax-included. */
export async function getVatRate(): Promise<number> {
  try {
    await connectDB();
    const row = await AgencySetting.findOne({ key: "accountingVatRate" }).lean();
    const n = Number(row?.value);
    return Number.isFinite(n) && n >= 0 && n <= 50 ? n : 19;
  } catch {
    return 19;
  }
}

/** Splits a tax-included amount into HT and VAT. */
export function splitVat(ttc: number, ratePercent: number): { ht: number; vat: number } {
  const ht = Math.round(ttc / (1 + ratePercent / 100));
  return { ht, vat: ttc - ht };
}

/** Period bounds from "YYYY-MM-DD" strings (inclusive), UTC. Defaults to the current month. */
export function periodFromQuery(from?: string | null, to?: string | null): { from: Date; to: Date; fromStr: string; toStr: string } {
  const day = /^\d{4}-\d{2}-\d{2}$/;
  const now = new Date();
  const fromStr = from && day.test(from) ? from : new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), 1)).toISOString().slice(0, 10);
  const toStr = to && day.test(to) ? to : new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth() + 1, 0)).toISOString().slice(0, 10);
  return { from: new Date(`${fromStr}T00:00:00.000Z`), to: new Date(`${toStr}T23:59:59.999Z`), fromStr, toStr };
}
