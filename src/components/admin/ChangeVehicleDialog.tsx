"use client";

import { useEffect, useMemo, useState } from "react";
import { ArrowRight, Car, Loader2, MessageCircle } from "lucide-react";
import { btn } from "@/components/admin/ui";
import { dt } from "@/lib/accountingLabels";
import { ErrorNote, Modal, inputCls, labelCls } from "@/components/admin/accounting/shared";

interface ModelOption {
  _id: string;
  brand: string;
  model: string;
  pricing?: { daily?: number };
}
interface Quote {
  oldModel: string;
  newModel: string;
  effectiveDate: string;
  split: boolean;
  totalDays: number;
  daysChanged: number;
  oldDailyRate: number;
  newDailyRate: number;
  listDailyRate: number;
  amount: number;
  oldTotal: number;
  newTotal: number;
  paid: number;
  remaining: number;
  refundDue: number;
  newDeposit: number;
  depositHeld: number;
  unit: { unitId: string; label: string } | null;
  units: { unitId: string; label: string; free: boolean; status: string; mileage: number }[];
}

const today = () => {
  const d = new Date();
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
};
const dayOf = (s: string) => new Date(s).toISOString().slice(0, 10);

/**
 * Car change for a booking, possibly in the middle of the rental. The server computes the quote
 * (days concerned, price difference, balance or refund) live; nothing is saved before "Confirmer".
 */
export function ChangeVehicleDialog({
  open,
  onClose,
  onDone,
  bookingId,
  bookingStatus,
  pickupDate,
  returnDate,
  pickupMileage,
  lines,
}: {
  open: boolean;
  onClose: () => void;
  onDone: (text: string, whatsappUrl: string | null) => void;
  bookingId: string;
  bookingStatus: string;
  pickupDate: string;
  returnDate: string;
  pickupMileage?: number;
  /** Cars of the booking in order. */
  lines: { vehicleId: string; label: string }[];
}) {
  const started = bookingStatus === "active";
  const first = dayOf(pickupDate);
  const last = dayOf(returnDate);
  const defaultDate = started ? (today() > first && today() < last ? today() : first) : first;
  const [lineIndex, setLineIndex] = useState(0);
  const [models, setModels] = useState<ModelOption[]>([]);
  const [newVehicleId, setNewVehicleId] = useState(lines[0]?.vehicleId || "");
  const [effectiveDate, setEffectiveDate] = useState(defaultDate);
  const [newUnitId, setNewUnitId] = useState("");
  const [priceMode, setPriceMode] = useState<"recalculate" | "keep">("recalculate");
  const [reason, setReason] = useState("");
  const [oldKm, setOldKm] = useState("");
  const [newKm, setNewKm] = useState("");
  const [toGarage, setToGarage] = useState(false);
  const [notify, setNotify] = useState(true);
  const [quote, setQuote] = useState<Quote | null>(null);
  const [quoting, setQuoting] = useState(false);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState("");

  useEffect(() => {
    if (!open) return;
    fetch("/api/admin/vehicles?limit=200", { cache: "no-store" })
      .then((r) => r.json())
      .then((d) => setModels((d.vehicles || []).filter((v: { status?: string }) => v.status !== "archived")))
      .catch(() => setModels([]));
  }, [open]);

  const body = useMemo(
    () => ({
      action: "change_vehicle",
      lineIndex,
      effectiveDate,
      newVehicleId,
      newUnitId: newUnitId || undefined,
      priceMode,
      reason,
      oldCarMileage: oldKm ? Number(oldKm) : undefined,
      newCarMileage: newKm ? Number(newKm) : undefined,
      oldCarToGarage: toGarage,
      notifyCustomer: notify,
    }),
    [lineIndex, effectiveDate, newVehicleId, newUnitId, priceMode, reason, oldKm, newKm, toGarage, notify]
  );

  // Live quote (dry run) whenever the choice changes.
  useEffect(() => {
    if (!open || !newVehicleId || !effectiveDate) return;
    let alive = true;
    const t = setTimeout(async () => {
      setQuoting(true);
      try {
        const res = await fetch(`/api/admin/bookings/${bookingId}`, {
          method: "PATCH",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ ...body, dryRun: true, reason: "" }),
        });
        const d = await res.json().catch(() => ({}));
        if (!alive) return;
        if (!res.ok) {
          setQuote(null);
          setError(d.error || "Changement impossible");
        } else {
          setQuote(d.quote);
          setError("");
        }
      } finally {
        if (alive) setQuoting(false);
      }
    }, 250);
    return () => {
      alive = false;
      clearTimeout(t);
    };
  }, [open, bookingId, body, newVehicleId, effectiveDate]);

  const confirm = async () => {
    if (!reason.trim()) return setError("Indiquez le motif (panne, surclassement, demande du client…).");
    if (!quote?.unit && !newUnitId) return setError("Aucune voiture libre pour ce modèle sur la période.");
    setSaving(true);
    setError("");
    try {
      const res = await fetch(`/api/admin/bookings/${bookingId}`, { method: "PATCH", headers: { "Content-Type": "application/json" }, body: JSON.stringify(body) });
      const d = await res.json().catch(() => ({}));
      if (!res.ok) throw new Error(d.error || "Changement refusé");
      const m = d.money || {};
      const tail = m.refundDue > 0 ? ` À rembourser au client : ${dt(m.refundDue)}.` : m.remaining > 0 ? ` Reste à encaisser : ${dt(m.remaining)}.` : "";
      const mail = notify ? (d.customer?.emailSent ? " Client prévenu par e-mail." : " E-mail non envoyé (messagerie non configurée ou pas d'adresse) : utilisez WhatsApp.") : "";
      onDone(`Voiture changée : ${d.quote.newModel} (${d.quote.unit?.label || ""}).${tail}${mail}`, notify ? d.customer?.whatsappUrl || null : null);
    } catch (e) {
      setError(e instanceof Error ? e.message : "Erreur");
    } finally {
      setSaving(false);
    }
  };

  const sameModel = newVehicleId === lines[lineIndex]?.vehicleId;
  return (
    <Modal
      open={open}
      onClose={onClose}
      wide
      title="Changer de voiture"
      footer={
        <>
          <button type="button" onClick={onClose} className={`${btn.base} ${btn.secondary}`}>Annuler</button>
          <button type="button" onClick={confirm} disabled={saving || quoting || !quote} className={`${btn.base} ${btn.primary}`}>
            {saving ? <Loader2 className="w-4 h-4 animate-spin" /> : <Car className="w-4 h-4" />} Confirmer le changement
          </button>
        </>
      }
    >
      <div className="grid sm:grid-cols-2 gap-3">
        {lines.length > 1 && (
          <label className="sm:col-span-2">
            <span className={labelCls}>Voiture de la réservation à changer</span>
            <select className={inputCls} value={lineIndex} onChange={(e) => { setLineIndex(Number(e.target.value)); setNewVehicleId(lines[Number(e.target.value)].vehicleId); setNewUnitId(""); }}>
              {lines.map((l, i) => <option key={i} value={i}>{i + 1}. {l.label}</option>)}
            </select>
          </label>
        )}
        <label>
          <span className={labelCls}>À partir du</span>
          <input type="date" className={inputCls} value={effectiveDate} min={first} max={last} onChange={(e) => setEffectiveDate(e.target.value)} />
          <span className="block mt-1 text-[11px] text-slate-500">
            {effectiveDate <= first ? "Toute la location (pas encore commencée ou dès le premier jour)." : "Location partagée : l'ancienne voiture avant cette date, la nouvelle ensuite."}
          </span>
        </label>
        <label>
          <span className={labelCls}>Nouveau modèle</span>
          <select className={inputCls} value={newVehicleId} onChange={(e) => { setNewVehicleId(e.target.value); setNewUnitId(""); }}>
            {models.map((m) => (
              <option key={m._id} value={m._id}>
                {m.brand} {m.model}{m._id === lines[lineIndex]?.vehicleId ? " (même modèle, autre voiture)" : ""} — {Math.round(Number(m.pricing?.daily || 0) / 100)} DT/j
              </option>
            ))}
          </select>
        </label>
        <label className="sm:col-span-2">
          <span className={labelCls}>Voiture (immatriculation)</span>
          <select className={inputCls} value={newUnitId} onChange={(e) => setNewUnitId(e.target.value)}>
            <option value="">Automatique : voiture libre la moins kilométrée{quote?.unit ? ` (${quote.unit.label})` : ""}</option>
            {(quote?.units || []).map((u) => (
              <option key={u.unitId} value={u.unitId} disabled={!u.free}>
                {u.label} — {u.free ? `libre · ${u.mileage.toLocaleString("fr-FR")} km` : u.status !== "active" ? "au garage / hors service" : "déjà réservée"}
              </option>
            ))}
          </select>
        </label>
        <fieldset className="sm:col-span-2">
          <span className={labelCls}>Prix</span>
          <div className="grid sm:grid-cols-2 gap-2">
            {(
              [
                ["recalculate", "Recalculer", "Les jours concernés passent au tarif du nouveau modèle (différence à payer ou à rembourser)."],
                ["keep", "Garder le prix", "Changement à l'initiative de l'agence (panne, surclassement offert) : le client paie le même prix."],
              ] as const
            ).map(([k, t, d]) => (
              <label key={k} className={`p-2.5 rounded-xl border cursor-pointer ${priceMode === k ? "border-blue-500 bg-blue-50 dark:bg-blue-500/10" : "border-slate-200 dark:border-slate-700"}`}>
                <span className="flex items-center gap-2 font-bold text-slate-900 dark:text-white">
                  <input type="radio" name="priceMode" checked={priceMode === k} onChange={() => setPriceMode(k)} /> {t}
                </span>
                <span className="block mt-0.5 text-[11px] text-slate-500">{d}</span>
              </label>
            ))}
          </div>
        </fieldset>
        {started && effectiveDate > first && (
          <>
            <label>
              <span className={labelCls}>Km de la voiture rendue</span>
              <input inputMode="numeric" className={inputCls} value={oldKm} placeholder={pickupMileage !== undefined ? `≥ ${pickupMileage}` : "km"} onChange={(e) => setOldKm(e.target.value.replace(/\D/g, ""))} />
            </label>
            <label>
              <span className={labelCls}>Km de la nouvelle voiture</span>
              <input inputMode="numeric" className={inputCls} value={newKm} placeholder="km au compteur" onChange={(e) => setNewKm(e.target.value.replace(/\D/g, ""))} />
            </label>
          </>
        )}
        <label className="sm:col-span-2">
          <span className={labelCls}>Motif *</span>
          <input className={inputCls} value={reason} placeholder="Panne, accident, surclassement, demande du client…" onChange={(e) => setReason(e.target.value)} />
        </label>
        <label className="flex items-center gap-2 font-semibold text-slate-700 dark:text-slate-200">
          <input type="checkbox" checked={toGarage} onChange={(e) => setToGarage(e.target.checked)} /> Envoyer l&apos;ancienne voiture au garage
        </label>
        <label className="flex items-center gap-2 font-semibold text-slate-700 dark:text-slate-200">
          <input type="checkbox" checked={notify} onChange={(e) => setNotify(e.target.checked)} /> Prévenir le client
        </label>
      </div>

      {sameModel && !newUnitId && !quote?.unit && <p className="text-amber-600 font-semibold">Aucune autre voiture de ce modèle n&apos;est libre sur la période.</p>}
      <ErrorNote text={error} />
      {quoting && !quote ? (
        <Loader2 className="w-5 h-5 animate-spin text-slate-400" />
      ) : quote ? (
        <div className="p-3 rounded-xl bg-slate-50 dark:bg-slate-900/60 border border-slate-200 dark:border-slate-800 space-y-2">
          <div className="flex flex-wrap items-center gap-2 font-bold text-slate-900 dark:text-white">
            {quote.oldModel} <ArrowRight className="w-4 h-4" /> {quote.newModel}
            {quote.unit && <span className="font-mono text-amber-600">{quote.unit.label}</span>}
            {quoting && <Loader2 className="w-3.5 h-3.5 animate-spin text-slate-400" />}
          </div>
          <div className="grid grid-cols-2 sm:grid-cols-4 gap-2">
            {[
              ["Jours concernés", `${quote.daysChanged} / ${quote.totalDays}`],
              ["Tarif / jour", `${dt(quote.oldDailyRate)} → ${dt(quote.newDailyRate)}`],
              ["Différence", `${quote.amount >= 0 ? "+" : "−"}${dt(Math.abs(quote.amount))}`],
              ["Nouveau total", dt(quote.newTotal)],
            ].map(([k, v]) => (
              <div key={k} className="min-w-0">
                <div className="text-[10px] font-bold uppercase tracking-wider text-slate-500">{k}</div>
                <div className="font-black tabular-nums text-slate-900 dark:text-white truncate">{v}</div>
              </div>
            ))}
          </div>
          <div className={`p-2 rounded-lg font-bold ${quote.refundDue > 0 ? "bg-amber-100 text-amber-900 dark:bg-amber-500/15 dark:text-amber-200" : quote.remaining > 0 ? "bg-red-50 text-red-700 dark:bg-red-500/10 dark:text-red-300" : "bg-emerald-50 text-emerald-700 dark:bg-emerald-500/10 dark:text-emerald-300"}`}>
            Déjà réglé : {dt(quote.paid)} ·{" "}
            {quote.refundDue > 0 ? `à rembourser au client : ${dt(quote.refundDue)}` : quote.remaining > 0 ? `reste à payer : ${dt(quote.remaining)}` : "location soldée"}
          </div>
          {quote.newDeposit !== quote.depositHeld && quote.depositHeld > 0 && (
            <p className="text-[11px] text-slate-500">Caution du nouveau modèle : {dt(quote.newDeposit)} (détenue : {dt(quote.depositHeld)}). Ajustez-la dans Encaissements si besoin.</p>
          )}
          {priceMode === "keep" && quote.listDailyRate !== quote.oldDailyRate && (
            <p className="text-[11px] text-slate-500">Tarif normal du nouveau modèle : {dt(quote.listDailyRate)}/j — l&apos;agence garde l&apos;ancien prix.</p>
          )}
        </div>
      ) : null}
      {notify && (
        <p className="flex items-center gap-1.5 text-[11px] text-slate-500">
          <MessageCircle className="w-3.5 h-3.5" /> Le client reçoit le nouveau modèle, les dates et le nouveau montant (jamais l&apos;immatriculation).
        </p>
      )}
    </Modal>
  );
}
