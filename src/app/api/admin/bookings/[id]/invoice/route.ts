import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { requirePermission } from "@/lib/permissions";
import { Booking } from "@/models";
import { billingDefaults, ensureInvoiceNumber, invoiceData, loadBookingForDocs } from "@/lib/bookingDocs";
import { generateInvoicePDF } from "@/lib/pdfDocs";
import { logAudit } from "@/lib/audit";

export const dynamic = "force-dynamic";

const NOT_INVOICEABLE = ["cancelled", "rejected", "pending"];

/**
 * GET         → the invoice as PDF. The invoice number is assigned once, in sequence, on first issue.
 * GET ?data=1 → the invoice content (lines, totals, recipient) for the edit page, without numbering it.
 */
export async function GET(request: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const guard = await requirePermission("payments", "view");
  if (!guard.ok) return guard.response;
  const { id } = await params;
  const booking = await loadBookingForDocs(id);
  if (!booking) return NextResponse.json({ success: false, error: "Réservation introuvable" }, { status: 404 });
  if (new URL(request.url).searchParams.get("data")) {
    const data = await invoiceData(booking);
    return NextResponse.json({
      success: true,
      invoiceable: !NOT_INVOICEABLE.includes(booking.bookingStatus),
      status: booking.bookingStatus,
      billing: billingDefaults(booking),
      invoice: { ...data, company: undefined },
    });
  }
  if (NOT_INVOICEABLE.includes(booking.bookingStatus)) {
    return NextResponse.json({ success: false, error: "Une facture ne peut être émise que pour une réservation confirmée." }, { status: 409 });
  }
  const first = !booking.invoiceNumber;
  await ensureInvoiceNumber(booking);
  if (first) await logAudit(guard.session, "invoice.issue", "booking", id, { after: { invoice: booking.invoiceNumber, booking: booking.bookingReference } });
  const pdf = generateInvoicePDF(await invoiceData(booking));
  return new NextResponse(new Uint8Array(pdf), {
    headers: {
      "Content-Type": "application/pdf",
      "Content-Disposition": `inline; filename="facture-${booking.invoiceNumber}.pdf"`,
      "Cache-Control": "private, no-store",
    },
  });
}

const text = (max: number) => z.string().trim().max(max).optional().default("");
const billingSchema = z.object({
  name: text(160),
  address: text(300),
  idNumber: text(60),
  taxId: text(60),
  notes: text(800),
});

/**
 * PUT { name, address, idNumber, taxId, notes } → invoice recipient. Amounts are never editable here:
 * they come from the booking pricing and the payment ledger.
 */
export async function PUT(request: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const guard = await requirePermission("bookings", "edit");
  if (!guard.ok) return guard.response;
  const { id } = await params;
  const parsed = billingSchema.safeParse(await request.json().catch(() => ({})));
  if (!parsed.success) return NextResponse.json({ success: false, error: parsed.error.issues[0]?.message || "Données invalides" }, { status: 400 });
  const booking = await loadBookingForDocs(id);
  if (!booking) return NextResponse.json({ success: false, error: "Réservation introuvable" }, { status: 404 });
  await Booking.updateOne({ _id: booking._id }, { $set: { billing: parsed.data } });
  await logAudit(guard.session, "invoice.billing", "booking", id, {
    before: JSON.parse(JSON.stringify(booking.billing || {})),
    after: { ...parsed.data, invoice: booking.invoiceNumber || undefined },
  });
  return NextResponse.json({ success: true });
}
