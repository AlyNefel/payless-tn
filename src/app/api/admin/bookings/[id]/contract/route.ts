import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { requirePermission } from "@/lib/permissions";
import { Booking } from "@/models";
import { contractData, defaultDriver, ensureContractNumber, loadBookingForDocs } from "@/lib/bookingDocs";
import { generateContractPDF } from "@/lib/pdfDocs";
import { logAudit } from "@/lib/audit";

export const dynamic = "force-dynamic";

/**
 * GET            → the rental contract as PDF (numbered on first generation).
 * GET ?data=1    → the identity fields to pre-fill the contract form.
 */
export async function GET(request: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const guard = await requirePermission("bookings", "view");
  if (!guard.ok) return guard.response;
  const { id } = await params;
  const booking = await loadBookingForDocs(id);
  if (!booking) return NextResponse.json({ success: false, error: "Réservation introuvable" }, { status: 404 });
  if (new URL(request.url).searchParams.get("data")) {
    return NextResponse.json({
      success: true,
      number: booking.contract?.number || "",
      driver: defaultDriver(booking),
      secondDriver: booking.contract?.secondDriver || {},
      notes: booking.contract?.notes || "",
    });
  }
  if (["cancelled", "rejected"].includes(booking.bookingStatus)) {
    return NextResponse.json({ success: false, error: "Réservation annulée : pas de contrat." }, { status: 409 });
  }
  const first = !booking.contract?.number;
  await ensureContractNumber(booking, guard.session.user?.email || "inconnu");
  if (first) await logAudit(guard.session, "contract.issue", "booking", id, { after: { contract: booking.contract?.number, booking: booking.bookingReference } });
  const pdf = generateContractPDF(await contractData(booking));
  return new NextResponse(new Uint8Array(pdf), {
    headers: {
      "Content-Type": "application/pdf",
      "Content-Disposition": `inline; filename="contrat-${booking.contract?.number || booking.bookingReference}.pdf"`,
      "Cache-Control": "private, no-store",
    },
  });
}

const text = z.string().trim().max(160).optional().default("");
const identity = z.object({
  fullName: text, birthDate: text, birthPlace: text, nationality: text, address: text, phone: text,
  idType: z.enum(["cin", "passport"]).optional().default("cin"),
  idNumber: text, idIssuedAt: text, licenceNumber: text, licenceIssuedAt: text, licenceIssuedIn: text,
});

/** PUT { driver, secondDriver?, notes? } → identity details and special conditions printed on the contract. */
export async function PUT(request: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const guard = await requirePermission("bookings", "edit");
  if (!guard.ok) return guard.response;
  const { id } = await params;
  const parsed = z.object({ driver: identity, secondDriver: identity.optional(), notes: z.string().trim().max(1200).optional() }).safeParse(await request.json().catch(() => ({})));
  if (!parsed.success) return NextResponse.json({ success: false, error: parsed.error.issues[0]?.message || "Données invalides" }, { status: 400 });
  const booking = await loadBookingForDocs(id);
  if (!booking) return NextResponse.json({ success: false, error: "Réservation introuvable" }, { status: 404 });
  const second = parsed.data.secondDriver;
  const hasSecond = second && Object.entries(second).some(([k, v]) => k !== "idType" && v);
  const set: Record<string, unknown> = { "contract.driver": parsed.data.driver };
  if (hasSecond) set["contract.secondDriver"] = second;
  if (parsed.data.notes !== undefined) set["contract.notes"] = parsed.data.notes;
  await Booking.updateOne({ _id: booking._id }, hasSecond ? { $set: set } : { $set: set, $unset: { "contract.secondDriver": 1 } });
  await logAudit(guard.session, "contract.identity", "booking", id, {
    before: { driver: booking.contract?.driver?.fullName, notes: booking.contract?.notes },
    after: { driver: parsed.data.driver.fullName, secondDriver: hasSecond ? second?.fullName : undefined, notes: parsed.data.notes },
  });
  return NextResponse.json({ success: true });
}
