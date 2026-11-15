"use client";

import React, { useMemo, useState } from "react";
import {
  KeyRound,
  LogIn,
  LogOut,
  CalendarPlus,
  Loader2,
  CheckCircle2,
  AlertCircle,
  RefreshCw,
  MessageCircle,
  X,
} from "lucide-react";

export interface UnitOption {
  unitId: string;
  licensePlate: string;
  label: string;
  status: string;
  mileage: number;
  free: boolean;
}

interface AssignedUnit {
  vehicleId: string;
  unitId?: string;
  licensePlate: string;
  auto?: boolean;
}

interface Props {
  bookingId: string;
  bookingReference: string;
  bookingStatus: string;
  returnDate: string;
  returnTime?: string;
  pickupMileage?: number;
  /** Booked models: [{ vehicleId, label }] in booking order (a model can appear twice). */
  models: { vehicleId: string; label: string; baseDailyTND: number }[];
  assignedUnits: AssignedUnit[];
  unitOptions: Record<string, UnitOption[]>;
  customerPhone?: string;
  customerName?: string;
  onChanged: () => void;
}

const card =
  "p-5 rounded-2xl bg-white dark:bg-[#0f141f] border border-slate-200 dark:border-slate-800 shadow-xs space-y-4";
const btn =
  "inline-flex items-center justify-center gap-1.5 px-3.5 py-2.5 rounded-xl text-xs font-bold transition-all disabled:opacity-50";
const input =
  "w-full h-10 px-3 rounded-xl border border-slate-200 dark:border-slate-700 bg-slate-50 dark:bg-slate-900 text-xs font-semibold text-slate-900 dark:text-white outline-none focus:ring-2 focus:ring-blue-500";

function toISODate(d: string | Date) {
  const x = new Date(d);
  return `${x.getFullYear()}-${String(x.getMonth() + 1).padStart(2, "0")}-${String(x.getDate()).padStart(2, "0")}`;
}

/** Counter operations on a booking: plate assignment, pickup, return, extension. */
export function BookingOperationsPanel(props: Props) {
  const [busy, setBusy] = useState<string | null>(null);
  const [msg, setMsg] = useState<{ ok: boolean; text: string } | null>(null);
  const [modal, setModal] = useState<null | "pickup" | "return" | "extend">(null);
  const [mileage, setMileage] = useState("");
  const [notes, setNotes] = useState("");
  const [newReturnDate, setNewReturnDate] = useState(() => {
    const d = new Date(props.returnDate);
    d.setDate(d.getDate() + 1);
    return toISODate(d);
  });
  const [newReturnTime, setNewReturnTime] = useState(props.returnTime || "");
  const [dailyRate, setDailyRate] = useState(String(props.models[0]?.baseDailyTND ?? ""));

  const status = props.bookingStatus;
  const canPickup = ["pending", "confirmed", "awaiting_payment", "paid"].includes(status);
  const canReturn = ["active", "confirmed", "awaiting_payment", "paid"].includes(status);
  const canExtend = ["active", "confirmed", "awaiting_payment", "paid"].includes(status);
  const isOpen = !["completed", "cancelled", "rejected"].includes(status);

  const extraDays = useMemo(() => {
    const a = new Date(toISODate(props.returnDate)).getTime();
    const b = new Date(newReturnDate).getTime();
    return Math.max(0, Math.round((b - a) / 86_400_000));
  }, [newReturnDate, props.returnDate]);

  const call = async (key: string, body: Record<string, unknown>, okText: string) => {
    setBusy(key);
    setMsg(null);
    try {
      const res = await fetch(`/api/admin/bookings/${props.bookingId}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(body),
      });
      const data = await res.json().catch(() => ({}));
      if (!res.ok) throw new Error(data.error || "Opération refusée");
      setMsg({ ok: true, text: typeof okText === "string" ? okText : "OK" });
      setModal(null);
      setMileage("");
      setNotes("");
      props.onChanged();
      return data;
    } catch (e) {
      setMsg({ ok: false, text: e instanceof Error ? e.message : "Erreur" });
      return null;
    } finally {
      setBusy(null);
    }
  };

  // Group per model occurrence so a booking with 2× the same model shows 2 pickers.
  const occurrences = useMemo(() => {
    const seen = new Map<string, number>();
    return props.models.map((m) => {
      const idx = seen.get(m.vehicleId) || 0;
      seen.set(m.vehicleId, idx + 1);
      const assigned = props.assignedUnits.filter((a) => String(a.vehicleId) === m.vehicleId)[idx];
      return { ...m, index: idx, assigned };
    });
  }, [props.models, props.assignedUnits]);

  const whatsappHref = useMemo(() => {
    const phone = String(props.customerPhone || "").replace(/[^\d]/g, "");
    if (!phone) return "";
    const plates = props.assignedUnits.map((a) => a.licensePlate).filter(Boolean).join(", ");
    const text =
      `Bonjour ${props.customerName || ""},\n` +
      `Votre réservation Payless ${props.bookingReference} est confirmée.` +
      (plates ? `\nVéhicule : ${plates}` : "") +
      `\nRetour prévu le ${new Date(props.returnDate).toLocaleDateString("fr-FR")}${props.returnTime ? ` à ${props.returnTime}` : ""}.` +
      `\nMerci de votre confiance !`;
    return `https://wa.me/${phone}?text=${encodeURIComponent(text)}`;
  }, [props]);

  return (
    <div className={card}>
      <div className="flex items-center justify-between gap-2">
        <h2 className="text-xs font-bold uppercase tracking-wider text-slate-400 dark:text-slate-500 flex items-center gap-2">
          <KeyRound className="w-4 h-4 text-blue-500" />
          <span>Comptoir : véhicule affecté, départ, retour, prolongation</span>
        </h2>
        {whatsappHref && (
          <a
            href={whatsappHref}
            target="_blank"
            rel="noopener noreferrer"
            className={`${btn} bg-emerald-600 hover:bg-emerald-500 text-white`}
          >
            <MessageCircle className="w-4 h-4" /> WhatsApp client
          </a>
        )}
      </div>

      {msg && (
        <div
          className={`p-3 rounded-xl text-xs font-semibold flex items-center gap-2 ${
            msg.ok
              ? "bg-emerald-50 dark:bg-emerald-950/40 text-emerald-800 dark:text-emerald-300"
              : "bg-red-50 dark:bg-red-950/40 text-red-800 dark:text-red-300"
          }`}
        >
          {msg.ok ? <CheckCircle2 className="w-4 h-4" /> : <AlertCircle className="w-4 h-4" />}
          {msg.text}
        </div>
      )}

      {/* Plate assignment */}
      <div className="space-y-3">
        {occurrences.map((o) => {
          const options = props.unitOptions[o.vehicleId] || [];
          return (
            <div
              key={`${o.vehicleId}-${o.index}`}
              className="p-3.5 rounded-xl bg-slate-50 dark:bg-slate-900/60 border border-slate-200/80 dark:border-slate-800 space-y-2"
            >
              <div className="flex items-center justify-between gap-2 text-xs">
                <span className="font-bold text-slate-900 dark:text-white">{o.label}</span>
                {o.assigned?.unitId || o.assigned?.licensePlate ? (
                  <span className="font-mono font-black px-2 py-1 rounded-lg bg-slate-900 text-white dark:bg-white dark:text-slate-900 tracking-wider">
                    {o.assigned.licensePlate ||
                      options.find((u) => u.unitId === o.assigned?.unitId)?.label ||
                      "Immat. à saisir"}
                    <span className="ml-1.5 font-sans font-semibold text-[9px] opacity-70">
                      {o.assigned.auto ? "AUTO" : "MANUEL"}
                    </span>
                  </span>
                ) : (
                  <span className="text-amber-600 dark:text-amber-400 font-bold">Aucun véhicule affecté</span>
                )}
              </div>
              {isOpen && (
                <div className="flex gap-2">
                  <select
                    className={input}
                    value={o.assigned?.unitId || ""}
                    disabled={busy !== null}
                    onChange={(e) => {
                      if (!e.target.value) return;
                      call(
                        "assign",
                        { action: "assign_unit", vehicleId: o.vehicleId, unitId: e.target.value, index: o.index },
                        "Véhicule affecté"
                      );
                    }}
                  >
                    <option value="">— Choisir l&apos;immatriculation —</option>
                    {options.map((u) => (
                      <option key={u.unitId} value={u.unitId} disabled={!u.free && u.unitId !== o.assigned?.unitId}>
                        {u.label} · {u.mileage.toLocaleString("fr-FR")} km
                        {u.status !== "active" ? " · indisponible (garage)" : !u.free && u.unitId !== o.assigned?.unitId ? " · déjà loué" : ""}
                      </option>
                    ))}
                  </select>
                  {!o.assigned && (
                    <button
                      type="button"
                      onClick={() => call("auto", { action: "auto_assign" }, "Affectation automatique effectuée")}
                      className={`${btn} border border-slate-200 dark:border-slate-700 text-slate-700 dark:text-slate-200`}
                      title="Affecter automatiquement un véhicule libre"
                    >
                      <RefreshCw className="w-4 h-4" />
                    </button>
                  )}
                </div>
              )}
            </div>
          );
        })}
      </div>

      {/* Operations */}
      {isOpen && (
        <div className="grid grid-cols-1 sm:grid-cols-3 gap-2">
          <button
            type="button"
            disabled={!canPickup || busy !== null}
            onClick={() => setModal("pickup")}
            className={`${btn} bg-blue-600 hover:bg-blue-500 text-white`}
          >
            <LogOut className="w-4 h-4" /> Départ (remise clés)
          </button>
          <button
            type="button"
            disabled={!canReturn || busy !== null}
            onClick={() => setModal("return")}
            className={`${btn} bg-emerald-600 hover:bg-emerald-500 text-white`}
          >
            <LogIn className="w-4 h-4" /> Retour véhicule
          </button>
          <button
            type="button"
            disabled={!canExtend || busy !== null}
            onClick={() => setModal("extend")}
            className={`${btn} bg-amber-500 hover:bg-amber-400 text-white`}
          >
            <CalendarPlus className="w-4 h-4" /> Prolongation
          </button>
        </div>
      )}

      {modal && (
        <div className="fixed inset-0 z-50 flex items-end sm:items-center justify-center p-0 sm:p-4 bg-black/60 backdrop-blur-sm">
          <div className="w-full sm:max-w-md max-h-[92vh] overflow-y-auto rounded-t-2xl sm:rounded-2xl bg-white dark:bg-[#0f141f] border border-slate-200 dark:border-slate-700 shadow-2xl p-5 space-y-4 text-xs">
            <div className="flex items-center justify-between">
              <h3 className="text-sm font-bold text-slate-900 dark:text-white">
                {modal === "pickup" ? "Enregistrer le départ" : modal === "return" ? "Enregistrer le retour" : "Prolonger la location"}
              </h3>
              <button type="button" onClick={() => setModal(null)} className="p-1 rounded-lg text-slate-400 hover:bg-slate-100 dark:hover:bg-slate-800">
                <X className="w-4 h-4" />
              </button>
            </div>

            {modal !== "extend" ? (
              <>
                <label className="block space-y-1">
                  <span className="font-semibold text-slate-700 dark:text-slate-300">
                    Kilométrage au compteur (km){" "}
                    {modal === "return" && props.pickupMileage !== undefined && (
                      <span className="text-slate-400">— départ : {props.pickupMileage.toLocaleString("fr-FR")} km</span>
                    )}
                  </span>
                  <input type="number" min={0} inputMode="numeric" className={input} value={mileage} onChange={(e) => setMileage(e.target.value)} placeholder="ex. 45230" />
                </label>
                <label className="block space-y-1">
                  <span className="font-semibold text-slate-700 dark:text-slate-300">Remarques (état, carburant…)</span>
                  <textarea className={`${input} h-20 py-2`} value={notes} onChange={(e) => setNotes(e.target.value)} />
                </label>
              </>
            ) : (
              <>
                <div className="grid grid-cols-2 gap-2">
                  <label className="block space-y-1">
                    <span className="font-semibold text-slate-700 dark:text-slate-300">Nouvelle date de retour</span>
                    <input type="date" className={input} min={toISODate(props.returnDate)} value={newReturnDate} onChange={(e) => setNewReturnDate(e.target.value)} />
                  </label>
                  <label className="block space-y-1">
                    <span className="font-semibold text-slate-700 dark:text-slate-300">Heure</span>
                    <input type="time" className={input} value={newReturnTime} onChange={(e) => setNewReturnTime(e.target.value)} />
                  </label>
                </div>
                <label className="block space-y-1">
                  <span className="font-semibold text-slate-700 dark:text-slate-300">Prix journalier appliqué (prix de base, DT)</span>
                  <input type="number" min={0} step="0.001" className={input} value={dailyRate} onChange={(e) => setDailyRate(e.target.value)} />
                </label>
                <div className="p-3 rounded-xl bg-amber-50 dark:bg-amber-950/30 text-amber-900 dark:text-amber-200 font-semibold">
                  {extraDays} jour(s) supplémentaire(s) × {Number(dailyRate || 0).toFixed(3)} DT ={" "}
                  {(extraDays * Number(dailyRate || 0)).toFixed(3)} DT
                  <span className="block font-normal text-[11px] opacity-80">+ options facturées par jour et contribution, calculées automatiquement.</span>
                </div>
                <label className="block space-y-1">
                  <span className="font-semibold text-slate-700 dark:text-slate-300">Remarque</span>
                  <input className={input} value={notes} onChange={(e) => setNotes(e.target.value)} />
                </label>
              </>
            )}

            <div className="flex justify-end gap-2 pt-2 sticky bottom-0 bg-white dark:bg-[#0f141f]">
              <button type="button" onClick={() => setModal(null)} className={`${btn} bg-slate-100 dark:bg-slate-800 text-slate-700 dark:text-slate-300`}>
                Annuler
              </button>
              <button
                type="button"
                disabled={busy !== null || (modal === "extend" && extraDays < 1)}
                onClick={() => {
                  const km = mileage.trim() === "" ? undefined : Number(mileage);
                  if (modal === "pickup") call("pickup", { action: "record_pickup", mileage: km, notes: notes || undefined }, "Départ enregistré — location en cours");
                  else if (modal === "return") call("return", { action: "record_return", mileage: km, notes: notes || undefined }, "Retour enregistré — location clôturée");
                  else
                    call(
                      "extend",
                      {
                        action: "extend",
                        newReturnDate,
                        newReturnTime: newReturnTime || undefined,
                        dailyRateTND: dailyRate === "" ? undefined : Number(dailyRate),
                        notes: notes || undefined,
                      },
                      `Location prolongée de ${extraDays} jour(s)`
                    );
                }}
                className={`${btn} bg-blue-600 hover:bg-blue-500 text-white`}
              >
                {busy ? <Loader2 className="w-4 h-4 animate-spin" /> : <CheckCircle2 className="w-4 h-4" />}
                Confirmer
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
