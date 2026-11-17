import { NextRequest, NextResponse } from "next/server";
import mongoose from "mongoose";
import connectDB from "@/lib/db";
import { requirePermission } from "@/lib/permissions";
import { Booking, Payment } from "@/models";
import { PAYMENT_KIND_LABELS, PAYMENT_METHOD_LABELS, bookingMoney } from "@/lib/ledger";
import { generateReceiptPDF, getCompanyInfo } from "@/lib/pdfDocs";

export const dynamic = "force-dynamic";

export async function GET(_request: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const guard = await requirePermission("payments", "view");
  if (!guard.ok) return guard.response;
  const { id } = await params;
  await connectDB();
  if (!mongoose.Types.ObjectId.isValid(id)) return NextResponse.json({ success: false, error: "Reçu introuvable" }, { status: 404 });
  const p = await Payment.findById(id).lean();
  if (!p) return NextResponse.json({ success: false, error: "Reçu introuvable" }, { status: 404 });
  const booking = await Booking.findById(p.bookingId).select("pricingBreakdown.totalAmount").lean();
  const money = await bookingMoney(String(p.bookingId), booking?.pricingBreakdown?.totalAmount || 0);
  const pdf = generateReceiptPDF({
    company: await getCompanyInfo(),
    number: p.receiptNumber,
    date: p.paidAt,
    kindLabel: PAYMENT_KIND_LABELS[p.kind],
    customerName: p.customerName,
    bookingReference: p.bookingReference,
    amount: p.amount,
    method: PAYMENT_METHOD_LABELS[p.method] || p.method,
    reference: p.reference,
    recordedBy: p.recordedBy,
    total: money.total,
    paid: money.paid,
    depositHeld: money.depositHeld,
    voided: p.status === "voided",
  });
  return new NextResponse(new Uint8Array(pdf), {
    headers: { "Content-Type": "application/pdf", "Content-Disposition": `inline; filename="recu-${p.receiptNumber}.pdf"`, "Cache-Control": "private, no-store" },
  });
}
