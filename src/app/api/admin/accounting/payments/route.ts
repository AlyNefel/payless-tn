import { NextRequest, NextResponse } from "next/server";
import mongoose from "mongoose";
import { z } from "zod";
import connectDB from "@/lib/db";
import { can, requirePermission } from "@/lib/permissions";
import { Booking, Payment } from "@/models";
import { LedgerError, bookingMoney, periodFromQuery, recordPayment, voidPayment } from "@/lib/ledger";
import { logAudit } from "@/lib/audit";

export const dynamic = "force-dynamic";

/**
 * GET ?bookingId=… → movements + totals of one booking (counter staff).
 * GET ?from&to&method&kind&agent&q → the ledger for a period (requires accounting access).
 */
export async function GET(request: NextRequest) {
  const guard = await requirePermission("payments", "view");
  if (!guard.ok) return guard.response;
  await connectDB();
  const sp = new URL(request.url).searchParams;
  const bookingId = sp.get("bookingId");

  if (bookingId) {
    if (!mongoose.Types.ObjectId.isValid(bookingId)) return NextResponse.json({ success: false, error: "Réservation introuvable" }, { status: 404 });
    const booking = await Booking.findById(bookingId).select("bookingReference pricingBreakdown.totalAmount pricingBreakdown.depositAmount").lean();
    if (!booking) return NextResponse.json({ success: false, error: "Réservation introuvable" }, { status: 404 });
    const payments = await Payment.find({ bookingId }).sort({ paidAt: -1 }).lean();
    const money = await bookingMoney(bookingId, booking.pricingBreakdown?.totalAmount || 0);
    return NextResponse.json({ success: true, payments, money, depositDue: booking.pricingBreakdown?.depositAmount || 0 });
  }

  // The whole ledger is accounting data.
  if (!(await can(guard.role, "accounting", "view"))) {
    return NextResponse.json({ success: false, error: "Accès limité : votre rôle ne permet pas cette action." }, { status: 403 });
  }
  const { from, to, fromStr, toStr } = periodFromQuery(sp.get("from"), sp.get("to"));
  const filter: Record<string, unknown> = { paidAt: { $gte: from, $lte: to } };
  if (sp.get("method")) filter.method = sp.get("method");
  if (sp.get("kind")) filter.kind = sp.get("kind");
  if (sp.get("agent")) filter.recordedBy = sp.get("agent");
  if (sp.get("status")) filter.status = sp.get("status");
  const q = (sp.get("q") || "").trim();
  if (q) {
    const rx = new RegExp(q.replace(/[.*+?^${}()|[\]\\]/g, "\\$&"), "i");
    filter.$or = [{ bookingReference: rx }, { customerName: rx }, { receiptNumber: rx }, { reference: rx }];
  }
  const payments = await Payment.find(filter).sort({ paidAt: -1 }).limit(1000).lean();
  const done = payments.filter((p) => p.status === "completed");
  const sum = (kind: string) => done.filter((p) => p.kind === kind).reduce((a, p) => a + p.amount, 0);
  return NextResponse.json({
    success: true,
    period: { from: fromStr, to: toStr },
    payments,
    totals: {
      payments: sum("payment"),
      refunds: sum("refund"),
      deposits: sum("deposit"),
      depositRefunds: sum("deposit_refund"),
      net: sum("payment") - sum("refund"),
    },
    agents: [...new Set(payments.map((p) => p.recordedBy))].sort(),
  });
}

const createSchema = z.object({
  bookingId: z.string(),
  kind: z.enum(["payment", "deposit", "refund", "deposit_refund"]).default("payment"),
  amountTND: z.number().positive().max(10_000_000),
  method: z.enum(["cash", "card", "bank_transfer", "cheque", "online", "other"]),
  reference: z.string().max(120).optional(),
  notes: z.string().max(500).optional(),
  paidAt: z.string().optional(),
});

export async function POST(request: NextRequest) {
  const guard = await requirePermission("payments", "create");
  if (!guard.ok) return guard.response;
  const parsed = createSchema.safeParse(await request.json().catch(() => ({})));
  if (!parsed.success) return NextResponse.json({ success: false, error: parsed.error.issues[0]?.message || "Données invalides" }, { status: 400 });
  const d = parsed.data;
  // Money going out (refunds, deposit given back) is not a counter action.
  if ((d.kind === "refund" || d.kind === "deposit_refund") && !(await can(guard.role, "payments", "delete"))) {
    return NextResponse.json({ success: false, error: "Votre rôle ne permet pas d'enregistrer une sortie d'argent." }, { status: 403 });
  }
  // Back-dating a movement is reserved to accounting.
  const backdated = Boolean(d.paidAt) && !(await can(guard.role, "accounting", "edit"));
  try {
    const { payment, money } = await recordPayment({
      bookingId: d.bookingId,
      kind: d.kind,
      amount: Math.round(d.amountTND * 100),
      method: d.method,
      reference: d.reference,
      notes: d.notes,
      paidAt: d.paidAt && !backdated ? new Date(d.paidAt) : undefined,
      recordedBy: guard.session.user?.email || "inconnu",
    });
    await logAudit(guard.session, `payment.${d.kind}`, "payment", String(payment._id), {
      after: { receipt: payment.receiptNumber, booking: payment.bookingReference, amount: payment.amount, method: payment.method },
    });
    return NextResponse.json({ success: true, payment, money }, { status: 201 });
  } catch (err) {
    if (err instanceof LedgerError) return NextResponse.json({ success: false, error: err.message }, { status: err.status });
    console.error("POST payment:", err);
    return NextResponse.json({ success: false, error: "Enregistrement impossible" }, { status: 500 });
  }
}

/** DELETE ?id=…&reason=… → voids a movement (kept in the ledger). */
export async function DELETE(request: NextRequest) {
  const guard = await requirePermission("payments", "delete");
  if (!guard.ok) return guard.response;
  const sp = new URL(request.url).searchParams;
  try {
    const money = await voidPayment(sp.get("id") || "", guard.session.user?.email || "inconnu", sp.get("reason") || "");
    await logAudit(guard.session, "payment.void", "payment", sp.get("id") || "", { after: { reason: sp.get("reason") } });
    return NextResponse.json({ success: true, money });
  } catch (err) {
    if (err instanceof LedgerError) return NextResponse.json({ success: false, error: err.message }, { status: err.status });
    console.error("DELETE payment:", err);
    return NextResponse.json({ success: false, error: "Annulation impossible" }, { status: 500 });
  }
}
