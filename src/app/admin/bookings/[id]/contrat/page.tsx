"use client";

import { use, useCallback, useEffect, useState } from "react";
import Link from "next/link";
import { ArrowLeft, Loader2, Printer, Save } from "lucide-react";
import { btn, usePermissions } from "@/components/admin/ui";
import { IdentityFields, type Identity } from "@/components/admin/accounting/ContractForm";
import { ErrorNote, api, cardCls, inputCls, labelCls } from "@/components/admin/accounting/shared";
import { InspectionSummary } from "@/components/admin/InspectionSummary";
import type { InspectionValue } from "@/components/admin/InspectionSheet";
import { openPdf } from "@/components/admin/openPdf";

interface BookingLite {
  _id: string;
  bookingReference: string;
  bookingStatus: string;
  pickupDate: string;
  returnDate: string;
  pickupTime?: string;
  returnTime?: string;
  pickupMileage?: number;
  customerId?: { firstName?: string; lastName?: string } | null;
  vehicleId?: { brand?: string; model?: string } | null;
  assignedUnits?: { licensePlate?: string; to?: string }[];
  pickupInspection?: InspectionValue | null;
  returnInspection?: InspectionValue | null;
}

/** Rental contract: edit what is printed (drivers, special conditions, condition reports), then print. */
export default function ContractPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = use(params);
  const { can } = usePermissions();
  const canEdit = can("bookings.edit");
  const [booking, setBooking] = useState<BookingLite | null>(null);
  const [driver, setDriver] = useState<Identity>({});
  const [second, setSecond] = useState<Identity>({});
  const [withSecond, setWithSecond] = useState(false);
  const [notes, setNotes] = useState("");
  const [number, setNumber] = useState("");
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [dirty, setDirty] = useState(false);
  const [error, setError] = useState("");
  const [saved, setSaved] = useState("");

  const loadBooking = useCallback(() => api<{ booking: BookingLite }>(`/api/admin/bookings/${id}`).then((d) => setBooking(d.booking)), [id]);

  useEffect(() => {
    setLoading(true);
    Promise.all([
      loadBooking(),
      api<{ driver: Identity; secondDriver: Identity; number: string; notes: string }>(`/api/admin/bookings/${id}/contract?data=1`).then((d) => {
        setDriver(d.driver || {});
        setSecond(d.secondDriver || {});
        setWithSecond(Boolean(d.secondDriver?.fullName));
        setNotes(d.notes || "");
        setNumber(d.number || "");
      }),
    ])
      .catch((e) => setError(e instanceof Error ? e.message : "Chargement impossible"))
      .finally(() => setLoading(false));
  }, [id, loadBooking]);

  // Warn before leaving with unsaved edits.
  useEffect(() => {
    if (!dirty) return;
    const h = (e: BeforeUnloadEvent) => e.preventDefault();
    window.addEventListener("beforeunload", h);
    return () => window.removeEventListener("beforeunload", h);
  }, [dirty]);

  const edit = <T,>(set: (v: T) => void) => (v: T) => {
    set(v);
    setDirty(true);
    setSaved("");
  };

  const cancelled = booking ? ["cancelled", "rejected"].includes(booking.bookingStatus) : false;

  const save = async (thenPrint: boolean) => {
    setError("");
    // The tab must be opened inside the click, before any await, or the browser blocks it.
    const tab = thenPrint ? window.open("about:blank", "_blank") : null;
    setSaving(true);
    try {
      if (canEdit) {
        await api(`/api/admin/bookings/${id}/contract`, { method: "PUT", body: JSON.stringify({ driver, secondDriver: withSecond ? second : undefined, notes }) });
        setDirty(false);
        setSaved("Contrat enregistré.");
      }
      if (thenPrint) {
        await openPdf(tab, `/api/admin/bookings/${id}/contract`);
        const d = await api<{ number: string }>(`/api/admin/bookings/${id}/contract?data=1`);
        setNumber(d.number || "");
      }
    } catch (e) {
      tab?.close();
      setError(e instanceof Error ? e.message : "Enregistrement impossible");
    } finally {
      setSaving(false);
    }
  };

  if (loading) {
    return (
      <div className="p-10 flex justify-center">
        <Loader2 className="w-6 h-6 animate-spin text-slate-400" />
      </div>
    );
  }

  const customer = `${booking?.customerId?.firstName || ""} ${booking?.customerId?.lastName || ""}`.trim();
  const car = `${booking?.vehicleId?.brand || ""} ${booking?.vehicleId?.model || ""}`.trim();
  const plates = (booking?.assignedUnits || []).filter((u) => !u.to).map((u) => u.licensePlate).filter(Boolean).join(", ");
  const day = (d?: string) => (d ? new Date(d).toLocaleDateString("fr-FR", { timeZone: "UTC" }) : "—");

  return (
    <div className="space-y-4 max-w-4xl">
      <div className="flex items-start gap-3">
        <Link href={`/admin/bookings/${id}`} aria-label="Retour à la réservation" className="p-2 rounded-xl border border-slate-200 dark:border-slate-700 text-slate-600 dark:text-slate-300">
          <ArrowLeft className="w-5 h-5" />
        </Link>
        <div className="min-w-0">
          <h1 className="text-xl font-black text-slate-900 dark:text-white">
            Contrat de location {number ? <span className="font-mono">{number}</span> : <span className="text-sm font-semibold text-slate-500">(numéroté à la première impression)</span>}
          </h1>
          <p className="text-xs text-slate-500">
            <span className="font-mono">{booking?.bookingReference}</span> · {customer} · {car}
            {plates ? ` · ${plates}` : ""} · {day(booking?.pickupDate)} {booking?.pickupTime || ""} → {day(booking?.returnDate)} {booking?.returnTime || ""}
          </p>
        </div>
      </div>

      <ErrorNote text={error} />
      {cancelled && <ErrorNote text="Réservation annulée : le contrat ne peut pas être imprimé." />}
      {!canEdit && <p className="text-xs text-slate-500">Lecture seule : votre rôle ne permet pas de modifier le contrat.</p>}

      <fieldset disabled={!canEdit} className={`${cardCls} p-4 space-y-3 text-xs`}>
        <h2 className="text-sm font-bold text-slate-900 dark:text-white">1. Locataire (conducteur principal)</h2>
        <p className="text-slate-500">Pré-rempli depuis la fiche client. Les champs laissés vides sont imprimés en pointillés pour être complétés à la main.</p>
        <IdentityFields value={driver} onChange={edit(setDriver)} />
      </fieldset>

      <fieldset disabled={!canEdit} className={`${cardCls} p-4 space-y-3 text-xs`}>
        <label className="inline-flex items-center gap-2 text-sm font-bold text-slate-900 dark:text-white">
          <input type="checkbox" checked={withSecond} onChange={(e) => edit(setWithSecond)(e.target.checked)} /> 2. Conducteur additionnel
        </label>
        {withSecond && <IdentityFields value={second} onChange={edit(setSecond)} />}
      </fieldset>

      <fieldset disabled={!canEdit} className={`${cardCls} p-4 space-y-2 text-xs`}>
        <label className="block">
          <span className={labelCls}>Conditions particulières (imprimées sur le contrat)</span>
          <textarea className={`${inputCls} h-24 py-2`} maxLength={1200} value={notes} placeholder="Ex. livraison à l'hôtel, franchise réduite, siège bébé fourni…" onChange={(e) => edit(setNotes)(e.target.value)} />
        </label>
        <p className="text-slate-500">
          Les montants viennent de la réservation : pour les changer, utilisez « Prolonger / réduire » ou{" "}
          <Link href={`/admin/bookings/${id}/facture`} className="text-blue-600 font-semibold hover:underline">la facture</Link>.
        </p>
      </fieldset>

      {booking && (
        <InspectionSummary
          bookingId={id}
          title={`${booking.bookingReference} · ${car}`}
          pickup={booking.pickupInspection}
          back={booking.returnInspection}
          pickupMileage={booking.pickupMileage}
          customerName={customer}
          canEdit={canEdit}
          onChanged={() => loadBooking().catch(() => {})}
        />
      )}

      <div className="sticky bottom-0 z-30 -mx-1 rounded-2xl border border-slate-200 dark:border-slate-800 bg-white/95 dark:bg-[#0b0f17]/95 backdrop-blur p-3 shadow-lg">
        <div className="flex flex-wrap items-center justify-end gap-2">
          {saved && <span className="mr-auto text-xs font-semibold text-emerald-600">{saved}</span>}
          {dirty && !saved && <span className="mr-auto text-xs font-semibold text-amber-600">Modifications non enregistrées</span>}
          {canEdit && (
            <button type="button" onClick={() => save(false)} disabled={saving} className={`${btn.base} ${btn.secondary}`}>
              <Save className="w-4 h-4" /> Enregistrer
            </button>
          )}
          <button type="button" onClick={() => save(true)} disabled={saving || cancelled} className={`${btn.base} ${btn.primary}`}>
            {saving ? <Loader2 className="w-4 h-4 animate-spin" /> : <Printer className="w-4 h-4" />} {canEdit ? "Enregistrer & imprimer" : "Imprimer"}
          </button>
        </div>
      </div>
    </div>
  );
}
