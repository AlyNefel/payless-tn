import { NextRequest, NextResponse } from "next/server";
import { requirePermission } from "@/lib/permissions";
import { ensureInvoiceNumber, invoiceData, loadBookingForDocs } from "@/lib/bookingDocs";
import { generateInvoicePDF } from "@/lib/pdfDocs";
import { logAudit } from "@/lib/audit";

export const dynamic = "force-dynamic";

/** GET → the invoice as PDF. The invoice number is assigned once, in sequence, on first issue. */
export async function GET(_request: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const guard = await requirePermission("payments", "view");
  if (!guard.ok) return guard.response;
  const { id } = await params;
  const booking = await loadBookingForDocs(id);
  if (!booking) return NextResponse.json({ success: false, error: "Réservation introuvable" }, { status: 404 });
  if (["cancelled", "rejected", "pending"].includes(booking.bookingStatus)) {
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
