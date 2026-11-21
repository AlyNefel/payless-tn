"use client";

import { useEffect, useState } from "react";
import Link from "next/link";
import { SquarePen, MessageCircle, FileText, Loader2, User, Car, CalendarDays, CreditCard, StickyNote, Package } from "lucide-react";
import { QuickView, Field, Section, StatusBadge, btn } from "./ui";
import { OptionIcon } from "@/components/ui/OptionIcon";

/** Minimal data available from a list row (shown instantly while the full record loads). */
export interface BookingSummary {
  _id: string;
  reference: string;
  status?: string;
  paymentStatus?: string;
  customerName?: string;
  customerPhone?: string;
  customerEmail?: string;
  vehicleName?: string;
  licensePlate?: string;
  pickupDate?: string;
  returnDate?: string;
  pickupLocation?: string;
  returnLocation?: string;
  totalAmount?: number;
}

interface FullBooking {
  bookingReference: string;
  bookingStatus: string;
  paymentStatus: string;
  paymentMethod?: string;
  pickupDate: string;
  returnDate: string;
  pickupTime?: string;
  returnTime?: string;
  rentalDuration: number;
  customerNotes?: string;
  internalNotes?: string;
  customerId?: { firstName?: string; lastName?: string; phone?: string; email?: string; country?: string };
  vehicleId?: { brand?: string; model?: string; year?: number };
  vehicles?: { brand?: string; model?: string; vehicleId?: { brand?: string; model?: string } }[];
  pickupLocationId?: { name?: { fr?: string }; city?: string };
  returnLocationId?: { name?: { fr?: string }; city?: string };
  pricingBreakdown?: { totalAmount?: number; subtotal?: number; extrasTotal?: number; depositAmount?: number; discountAmount?: number };
  extras?: { name: string; quantity: number; icon?: string; lineTotal?: number; price?: number }[];
  assignedUnits?: { licensePlate?: string; to?: string }[];
}

const dt = (d?: string, t?: string) =>
  d ? `${new Date(d).toLocaleDateString("fr-FR", { weekday: "short", day: "2-digit", month: "short", year: "numeric" })}${t ? ` · ${t}` : ""}` : "—";
const money = (minor?: number) => `${((minor || 0) / 100).toLocaleString("fr-FR", { maximumFractionDigits: 3 })} TND`;

/**
 * "View" panel for a reservation (Fleet Calendar, Reservations list, Dashboard).
 * Shows everything an agent needs and leads to the edit page with one prominent button.
 */
export function BookingQuickView({ booking, onClose }: { booking: BookingSummary | null; onClose: () => void }) {
  const [full, setFull] = useState<FullBooking | null>(null);
  const [error, setError] = useState("");

  useEffect(() => {
    setFull(null);
    setError("");
    if (!booking?._id) return;
    let alive = true;
    fetch(`/api/admin/bookings/${booking._id}`)
      .then((r) => r.json().then((d) => ({ ok: r.ok, d })))
      .then(({ ok, d }) => {
        if (!alive) return;
        if (ok && d.booking) setFull(d.booking);
        else setError(d.error || "Détails indisponibles");
      })
      .catch(() => alive && setError("Erreur réseau"));
    return () => {
      alive = false;
    };
  }, [booking?._id]);

  if (!booking) return null;

  const status = full?.bookingStatus || booking.status;
  const payment = full?.paymentStatus || booking.paymentStatus;
  const customer = full?.customerId;
  const customerName = customer ? `${customer.firstName || ""} ${customer.lastName || ""}`.trim() : booking.customerName;
  const phone = customer?.phone || booking.customerPhone || "";
  const vehicleName =
    full?.vehicles && full.vehicles.length > 1
      ? full.vehicles.map((v) => `${v.brand || v.vehicleId?.brand || ""} ${v.model || v.vehicleId?.model || ""}`.trim()).join(" + ")
      : full?.vehicleId
      ? `${full.vehicleId.brand} ${full.vehicleId.model}${full.vehicleId.year ? ` (${full.vehicleId.year})` : ""}`
      : booking.vehicleName;
  const plates = (full?.assignedUnits || []).filter((u) => !u.to).map((u) => u.licensePlate || "immat. à saisir").join(", ");
  const extras = (full?.extras || []).filter((e) => (e.quantity || 0) > 0);
  const editHref = `/admin/bookings/${booking._id}`;

  return (
    <QuickView
      open
      onClose={onClose}
      title={<span className="font-mono">{full?.bookingReference || booking.reference}</span>}
      subtitle={vehicleName}
      badge={
        <span className="flex gap-1">
          <StatusBadge status={status} />
          <StatusBadge status={payment} kind="payment" />
        </span>
      }
      footer={
        <>
          {phone && (
            <a
              href={`https://wa.me/${phone.replace(/[^\d]/g, "")}`}
              target="_blank"
              rel="noopener noreferrer"
              className={`${btn.base} ${btn.success}`}
            >
              <MessageCircle className="w-4 h-4" /> WhatsApp
            </a>
          )}
          <a href={`/api/bookings/pdf?ref=${full?.bookingReference || booking.reference}`} target="_blank" rel="noopener noreferrer" className={`${btn.base} ${btn.secondary}`}>
            <FileText className="w-4 h-4" /> Bon PDF
          </a>
          <Link href={`${editHref}/contrat`} className={`${btn.base} ${btn.secondary}`}>
            <FileText className="w-4 h-4" /> Contrat
          </Link>
          <Link href={editHref} className={`${btn.base} ${btn.primary} px-5 h-10 text-sm`}>
            <SquarePen className="w-4 h-4" /> Voir & modifier
          </Link>
        </>
      }
    >
      {error && <p className="text-amber-600 font-semibold">{error} — informations résumées affichées.</p>}

      <Section title="Client">
        <div className="flex items-center gap-2 mb-1 font-bold text-slate-900 dark:text-white">
          <User className="w-4 h-4 text-blue-500" /> {customerName || "—"}
        </div>
        <Field label="Téléphone">{phone || "—"}</Field>
        <Field label="Email">{customer?.email || booking.customerEmail || "—"}</Field>
        {customer?.country && <Field label="Pays">{customer.country}</Field>}
      </Section>

      <Section title="Véhicule">
        <div className="flex items-center gap-2 font-bold text-slate-900 dark:text-white">
          <Car className="w-4 h-4 text-amber-500" /> {vehicleName || "—"}
        </div>
        <Field label="Immatriculation">{plates || (full ? "Non affectée" : booking.licensePlate || "—")}</Field>
      </Section>

      <Section title="Dates & agences">
        <div className="flex items-center gap-2 mb-1 text-slate-500">
          <CalendarDays className="w-4 h-4" /> {full?.rentalDuration ? `${full.rentalDuration} jour(s)` : ""}
        </div>
        <Field label="Départ">{dt(full?.pickupDate || booking.pickupDate, full?.pickupTime)}</Field>
        <Field label="Lieu de départ">{full?.pickupLocationId?.name?.fr || full?.pickupLocationId?.city || booking.pickupLocation || "—"}</Field>
        <Field label="Retour">{dt(full?.returnDate || booking.returnDate, full?.returnTime)}</Field>
        <Field label="Lieu de retour">{full?.returnLocationId?.name?.fr || full?.returnLocationId?.city || booking.returnLocation || "—"}</Field>
      </Section>

      <Section title="Paiement">
        <div className="flex items-center gap-2 mb-1 text-slate-500">
          <CreditCard className="w-4 h-4" /> {full?.paymentMethod || ""}
        </div>
        <Field label="Total TTC">{money(full?.pricingBreakdown?.totalAmount ?? booking.totalAmount)}</Field>
        {(full?.pricingBreakdown?.discountAmount || 0) > 0 && <Field label="Remise">-{money(full?.pricingBreakdown?.discountAmount)}</Field>}
        {full?.pricingBreakdown?.depositAmount !== undefined && <Field label="Caution">{money(full.pricingBreakdown.depositAmount)}</Field>}
        <Field label="Statut">
          <StatusBadge status={payment} kind="payment" />
        </Field>
      </Section>

      <Section title="Options sélectionnées">
        {!full && !error ? (
          <Loader2 className="w-4 h-4 animate-spin text-slate-400" />
        ) : extras.length === 0 ? (
          <p className="text-slate-500 flex items-center gap-1.5">
            <Package className="w-4 h-4" /> Aucune option
          </p>
        ) : (
          <ul className="space-y-1.5">
            {extras.map((e, i) => (
              <li key={i} className="flex items-center justify-between gap-2">
                <span className="flex items-center gap-2 min-w-0">
                  <OptionIcon icon={e.icon} size="sm" />
                  <span className="truncate">
                    {e.name}
                    {e.quantity > 1 ? ` ×${e.quantity}` : ""}
                  </span>
                </span>
                <span className="font-mono font-semibold">{money(e.lineTotal ?? e.price)}</span>
              </li>
            ))}
          </ul>
        )}
      </Section>

      <Section title="Notes">
        <div className="flex items-start gap-2">
          <StickyNote className="w-4 h-4 text-slate-400 shrink-0 mt-0.5" />
          <div className="space-y-2 min-w-0">
            <p>
              <span className="text-slate-500">Client : </span>
              {full?.customerNotes || "—"}
            </p>
            <p>
              <span className="text-slate-500">Interne : </span>
              {full?.internalNotes || "—"}
            </p>
          </div>
        </div>
      </Section>
    </QuickView>
  );
}
