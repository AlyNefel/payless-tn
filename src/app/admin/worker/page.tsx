"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import Link from "next/link";
import {
  Search,
  LogOut,
  LogIn,
  CalendarClock,
  StickyNote,
  Phone,
  Car,
  Loader2,
  CheckCircle2,
  AlertTriangle,
  X,
  RefreshCw,
  Eye,
  HandHelping,
  ClipboardCheck,
  Banknote,
  FileText,
} from "lucide-react";
import { StatusBadge, btn, usePermissions } from "@/components/admin/ui";
import { BookingQuickView } from "@/components/admin/BookingQuickView";
import { InspectionSheet } from "@/components/admin/InspectionSheet";
import { BookingPayments } from "@/components/admin/accounting/BookingPayments";
import { ContractForm } from "@/components/admin/accounting/ContractForm";
import { Modal } from "@/components/admin/accounting/shared";
import { dt } from "@/lib/accountingLabels";

interface Row {
  _id: string;
  reference: string;
  status: string;
  paymentStatus?: string;
  customerName: string;
  customerPhone: string;
  customerEmail?: string;
  vehicleName: string;
  licensePlate: string;
  hasCar: boolean;
  pickupDate: string;
  returnDate: string;
  pickupTime?: string;
  returnTime?: string;
  pickupLocation: string;
  returnLocation: string;
  totalAmount: number;
  pickupMileage: number | null;
  internalNotes: string;
  amountPaid?: number;
  depositHeld?: number;
  contractNumber?: string;
  hasPickupInspection?: boolean;
  hasReturnInspection?: boolean;
}

type Tab = "pickups" | "returns" | "all";
type Action = { kind: "pickup" | "return" | "dates" | "note"; row: Row } | null;

const inputCls =
  "w-full h-12 px-3.5 rounded-xl border border-slate-200 dark:border-slate-700 bg-white dark:bg-slate-900 text-sm font-semibold text-slate-900 dark:text-white outline-none focus:ring-2 focus:ring-blue-500";
const big = "inline-flex items-center justify-center gap-2 h-12 px-4 rounded-xl text-sm font-bold transition-colors disabled:opacity-50";
const dayStr = (offset = 0) => {
  const d = new Date();
  d.setDate(d.getDate() + offset);
  return d.toISOString().slice(0, 10);
};
const today = () => dayStr(0);
const frDate = (d: string) => new Date(`${d}T12:00:00`).toLocaleDateString("fr-FR", { weekday: "short", day: "2-digit", month: "short" });

/**
 * Worker Assistance workspace: a simplified, phone-first screen for the staff who hand over and
 * collect cars. Search a reservation, confirm the departure or the return, record the mileage,
 * add a note, extend or shorten the rental. Everything is validated by the server.
 */
export default function WorkerPage() {
  const { can, me } = usePermissions();
  const [rows, setRows] = useState<Row[]>([]);
  const [loading, setLoading] = useState(true);
  const [tab, setTab] = useState<Tab>("pickups");
  const [q, setQ] = useState("");
  const [action, setAction] = useState<Action>(null);
  const [viewing, setViewing] = useState<Row | null>(null);
  const [inspecting, setInspecting] = useState<{ row: Row; stage: "pickup" | "return" } | null>(null);
  const [paying, setPaying] = useState<Row | null>(null);
  const [contract, setContract] = useState<Row | null>(null);
  const [toast, setToast] = useState<{ ok: boolean; text: string } | null>(null);

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const res = await fetch("/api/admin/bookings?limit=200", { cache: "no-store" });
      const d = await res.json();
      if (d.success) setRows(d.bookings);
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    load();
  }, [load]);

  const notify = (ok: boolean, text: string) => {
    setToast({ ok, text });
    setTimeout(() => setToast(null), 4500);
  };

  const lists = useMemo(() => {
    const t = today();
    const tomorrow = dayStr(1);
    const pickups = rows
      .filter((r) => ["pending", "confirmed", "awaiting_payment", "paid"].includes(r.status) && r.pickupDate <= tomorrow)
      .sort((a, b) => a.pickupDate.localeCompare(b.pickupDate));
    const returns = rows.filter((r) => r.status === "active").sort((a, b) => a.returnDate.localeCompare(b.returnDate));
    return { pickups, returns, late: returns.filter((r) => r.returnDate < t).length };
  }, [rows]);

  const shown = useMemo(() => {
    const s = q.trim().toLowerCase();
    const base = s ? rows : tab === "pickups" ? lists.pickups : tab === "returns" ? lists.returns : rows;
    if (!s) return base;
    return base.filter((r) => `${r.reference} ${r.customerName} ${r.customerPhone} ${r.vehicleName} ${r.licensePlate}`.toLowerCase().includes(s));
  }, [q, rows, tab, lists]);

  const canEdit = can("bookings.edit");

  return (
    <div className="max-w-3xl mx-auto space-y-4 pb-24">
      {toast && (
        <div
          role="status"
          className={`fixed top-20 inset-x-4 sm:left-auto sm:right-4 sm:w-96 z-[90] px-4 py-3 rounded-2xl shadow-xl text-sm font-semibold flex items-start gap-2 text-white ${toast.ok ? "bg-emerald-600" : "bg-red-600"}`}
        >
          {toast.ok ? <CheckCircle2 className="w-5 h-5 shrink-0" /> : <AlertTriangle className="w-5 h-5 shrink-0" />}
          <span>{toast.text}</span>
        </div>
      )}

      <div className="flex items-center justify-between gap-3">
        <div>
          <h1 className="text-xl font-black text-slate-900 dark:text-white flex items-center gap-2">
            <HandHelping className="w-6 h-6 text-blue-600" /> Espace assistance
          </h1>
          <p className="text-xs text-slate-500">
            {me?.user?.name ? `${me.user.name} · ` : ""}Départs, retours, kilométrage et prolongations
          </p>
        </div>
        <button type="button" onClick={load} aria-label="Actualiser" className={`${btn.base} ${btn.secondary} h-11 w-11 px-0`}>
          <RefreshCw className={`w-4 h-4 ${loading ? "animate-spin" : ""}`} />
        </button>
      </div>

      <div className="relative">
        <Search className="w-5 h-5 absolute left-3.5 top-1/2 -translate-y-1/2 text-slate-400" />
        <input
          value={q}
          onChange={(e) => setQ(e.target.value)}
          placeholder="Rechercher : référence, client, téléphone, véhicule…"
          className={`${inputCls} pl-11`}
          inputMode="search"
        />
      </div>

      {!q && (
        <div className="grid grid-cols-3 gap-2">
          {(
            [
              ["pickups", "Départs", lists.pickups.length, false],
              ["returns", "Retours", lists.returns.length, lists.late > 0],
              ["all", "Toutes", rows.length, false],
            ] as const
          ).map(([id, label, n, alert]) => (
            <button
              key={id}
              type="button"
              onClick={() => setTab(id)}
              className={`h-14 rounded-xl text-sm font-bold flex flex-col items-center justify-center border ${
                tab === id
                  ? "bg-slate-900 text-white border-slate-900 dark:bg-white dark:text-slate-900"
                  : "bg-white dark:bg-[#0f141f] border-slate-200 dark:border-slate-800 text-slate-700 dark:text-slate-200"
              }`}
            >
              <span>{label}</span>
              <span className={`text-[11px] font-semibold ${alert ? "text-red-500" : "opacity-70"}`}>
                {n}
                {alert ? ` · ${lists.late} en retard` : ""}
              </span>
            </button>
          ))}
        </div>
      )}

      {loading && rows.length === 0 ? (
        <div className="py-16 flex justify-center">
          <Loader2 className="w-6 h-6 animate-spin text-slate-400" />
        </div>
      ) : shown.length === 0 ? (
        <p className="py-14 text-center text-sm text-slate-500 rounded-2xl border border-dashed border-slate-200 dark:border-slate-800">
          {q ? "Aucune réservation trouvée." : tab === "pickups" ? "Aucun départ aujourd'hui ni demain." : tab === "returns" ? "Aucune location en cours." : "Aucune réservation."}
        </p>
      ) : (
        <ul className="space-y-3">
          {shown.map((r) => {
            const late = r.status === "active" && r.returnDate < today();
            const canPickup = ["pending", "confirmed", "awaiting_payment", "paid"].includes(r.status);
            const canReturn = r.status === "active";
            const open = !["completed", "cancelled", "rejected"].includes(r.status);
            return (
              <li key={r._id} className={`p-4 rounded-2xl bg-white dark:bg-[#0f141f] border ${late ? "border-red-300 dark:border-red-800" : "border-slate-200 dark:border-slate-800"}`}>
                <div className="flex items-start justify-between gap-2">
                  <div className="min-w-0">
                    <p className="font-mono text-xs font-bold text-blue-600 dark:text-blue-400">{r.reference}</p>
                    <p className="text-base font-bold text-slate-900 dark:text-white truncate">{r.customerName}</p>
                  </div>
                  <div className="flex flex-col items-end gap-1">
                    <StatusBadge status={r.status} />
                    {late && <span className="text-[10px] font-bold text-red-600">RETARD</span>}
                  </div>
                </div>
                <div className="mt-2 space-y-1 text-sm text-slate-600 dark:text-slate-300">
                  <p className="flex items-center gap-2">
                    <Car className="w-4 h-4 text-slate-400 shrink-0" />
                    <span className="truncate">
                      {r.vehicleName}
                      {r.licensePlate ? <span className="font-mono text-xs text-amber-600 dark:text-amber-300"> · {r.licensePlate}</span> : null}
                    </span>
                  </p>
                  <p className="flex items-center gap-2">
                    <CalendarClock className="w-4 h-4 text-slate-400 shrink-0" />
                    {frDate(r.pickupDate)} {r.pickupTime || ""} → {frDate(r.returnDate)} {r.returnTime || ""}
                  </p>
                  {r.customerPhone && (
                    <a href={`tel:${r.customerPhone.replace(/\s+/g, "")}`} className="flex items-center gap-2 text-blue-600 dark:text-blue-400 font-semibold">
                      <Phone className="w-4 h-4 shrink-0" /> {r.customerPhone}
                    </a>
                  )}
                  {!r.hasCar && open && <p className="text-xs font-bold text-amber-600">Aucun véhicule physique affecté</p>}
                  {(() => {
                    const rest = r.paymentStatus === "paid" && !r.amountPaid ? 0 : Math.max(0, r.totalAmount - (r.amountPaid || 0));
                    return (
                      <p className={`text-xs font-bold ${rest > 0 ? "text-red-600" : "text-emerald-600"}`}>
                        {rest > 0 ? `Reste à payer : ${dt(rest)}` : "Location soldée"}
                        {r.depositHeld ? ` · caution détenue ${dt(r.depositHeld)}` : ""}
                      </p>
                    );
                  })()}
                </div>
                <div className="mt-3 grid grid-cols-2 gap-2">
                  {canEdit && canPickup && (
                    <button type="button" onClick={() => setAction({ kind: "pickup", row: r })} className={`${big} bg-blue-600 hover:bg-blue-500 text-white col-span-2`}>
                      <LogOut className="w-5 h-5" /> Confirmer le départ
                    </button>
                  )}
                  {canEdit && canReturn && (
                    <button type="button" onClick={() => setAction({ kind: "return", row: r })} className={`${big} bg-emerald-600 hover:bg-emerald-500 text-white col-span-2`}>
                      <LogIn className="w-5 h-5" /> Confirmer le retour
                    </button>
                  )}
                  {canEdit && open && (
                    <button type="button" onClick={() => setAction({ kind: "dates", row: r })} className={`${big} bg-amber-500 hover:bg-amber-400 text-white`}>
                      <CalendarClock className="w-4 h-4" /> Prolonger / réduire
                    </button>
                  )}
                  {canEdit && (
                    <button type="button" onClick={() => setAction({ kind: "note", row: r })} className={`${big} border border-slate-200 dark:border-slate-700 text-slate-700 dark:text-slate-200`}>
                      <StickyNote className="w-4 h-4" /> Note
                    </button>
                  )}
                  {canEdit && open && (
                    <button
                      type="button"
                      onClick={() => setInspecting({ row: r, stage: canReturn ? "return" : "pickup" })}
                      className={`${big} border border-slate-200 dark:border-slate-700 text-slate-700 dark:text-slate-200`}
                    >
                      <ClipboardCheck className="w-4 h-4" /> État des lieux{(canReturn ? r.hasReturnInspection : r.hasPickupInspection) ? " ✓" : ""}
                    </button>
                  )}
                  {can("payments.view") && r.status !== "cancelled" && r.status !== "rejected" && (
                    <button type="button" onClick={() => setPaying(r)} className={`${big} border border-slate-200 dark:border-slate-700 text-slate-700 dark:text-slate-200`}>
                      <Banknote className="w-4 h-4" /> Encaisser
                    </button>
                  )}
                  {open && (
                    <button type="button" onClick={() => setContract(r)} className={`${big} border border-slate-200 dark:border-slate-700 text-slate-700 dark:text-slate-200`}>
                      <FileText className="w-4 h-4" /> Contrat
                    </button>
                  )}
                  <button type="button" onClick={() => setViewing(r)} className={`${big} border border-slate-200 dark:border-slate-700 text-slate-700 dark:text-slate-200 col-span-2`}>
                    <Eye className="w-4 h-4" /> Voir la réservation
                  </button>
                </div>
              </li>
            );
          })}
        </ul>
      )}

      {can("bookings.create") && (
        <p className="text-center text-xs text-slate-500">
          Nouvelle réservation : bouton <b>Créer</b> en haut de l&apos;écran. Liste complète :{" "}
          <Link href="/admin/bookings" className="text-blue-600 font-semibold hover:underline">
            Réservations
          </Link>
        </p>
      )}

      {action && (
        <ActionSheet
          action={action}
          onClose={() => setAction(null)}
          onDone={(text) => {
            setAction(null);
            notify(true, text);
            load();
          }}
          onError={(text) => notify(false, text)}
        />
      )}

      {inspecting && (
        <InspectionSheet
          bookingId={inspecting.row._id}
          stage={inspecting.stage}
          title={`${inspecting.row.reference} · ${inspecting.row.vehicleName}`}
          minMileage={inspecting.stage === "return" ? inspecting.row.pickupMileage : null}
          defaultCustomer={inspecting.row.customerName}
          onClose={() => setInspecting(null)}
          onSaved={() => {
            setInspecting(null);
            notify(true, "État des lieux enregistré");
            load();
          }}
        />
      )}
      <Modal open={Boolean(paying)} onClose={() => setPaying(null)} title={paying ? `${paying.reference} — ${paying.customerName}` : ""} wide>
        {paying && <BookingPayments bookingId={paying._id} onChanged={load} compact />}
      </Modal>
      <ContractForm bookingId={contract?._id || null} title={contract?.customerName} onClose={() => setContract(null)} onSaved={load} />

      <BookingQuickView
        booking={viewing ? { ...viewing } : null}
        onClose={() => setViewing(null)}
      />
    </div>
  );
}

function ActionSheet({
  action,
  onClose,
  onDone,
  onError,
}: {
  action: NonNullable<Action>;
  onClose: () => void;
  onDone: (text: string) => void;
  onError: (text: string) => void;
}) {
  const { kind, row } = action;
  const [mileage, setMileage] = useState("");
  const [notes, setNotes] = useState("");
  const [toGarage, setToGarage] = useState(false);
  const [newDate, setNewDate] = useState(row.returnDate);
  const [newTime, setNewTime] = useState(row.returnTime || "");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");

  const delta = Math.round((new Date(newDate).getTime() - new Date(row.returnDate).getTime()) / 86_400_000);
  const title =
    kind === "pickup" ? "Confirmer le départ" : kind === "return" ? "Confirmer le retour" : kind === "dates" ? "Prolonger ou réduire" : "Ajouter une note";

  const submit = async () => {
    setError("");
    const km = mileage.trim() === "" ? undefined : Number(mileage);
    if (kind === "return" && km === undefined) return setError("Saisissez le kilométrage au compteur.");
    if (kind === "return" && row.pickupMileage !== null && km !== undefined && km < row.pickupMileage) {
      return setError(`Le kilométrage ne peut pas être inférieur à celui du départ (${row.pickupMileage.toLocaleString("fr-FR")} km).`);
    }
    if (kind === "note" && notes.trim().length < 1) return setError("Écrivez la note.");
    if (kind === "dates" && delta === 0 && newTime === (row.returnTime || "")) return setError("Choisissez une nouvelle date de retour.");
    const body =
      kind === "pickup"
        ? { action: "record_pickup", mileage: km, notes: notes || undefined }
        : kind === "return"
        ? { action: "record_return", mileage: km, notes: notes || undefined, unitStatus: toGarage ? "maintenance" : "active" }
        : kind === "dates"
        ? { action: "change_return", newReturnDate: newDate, newReturnTime: newTime || undefined, notes: notes || undefined }
        : { action: "add_note", note: notes.trim() };
    setBusy(true);
    try {
      const res = await fetch(`/api/admin/bookings/${row._id}`, { method: "PATCH", headers: { "Content-Type": "application/json" }, body: JSON.stringify(body) });
      const d = await res.json().catch(() => ({}));
      if (!res.ok) {
        setError(d.error || "Opération refusée");
        onError(d.error || "Opération refusée");
        return;
      }
      onDone(
        kind === "pickup"
          ? `Départ enregistré — ${row.reference}`
          : kind === "return"
          ? `Retour enregistré — ${row.reference}`
          : kind === "dates"
          ? delta > 0
            ? `Location prolongée de ${delta} jour(s)`
            : delta < 0
            ? `Durée réduite de ${-delta} jour(s)`
            : "Heure de retour modifiée"
          : "Note ajoutée"
      );
    } catch {
      setError("Erreur réseau. Réessayez.");
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="fixed inset-0 z-[80] flex items-end sm:items-center justify-center bg-black/60 backdrop-blur-sm sm:p-4" role="dialog" aria-modal="true" aria-label={title}>
      <div className="w-full sm:max-w-md max-h-[92vh] overflow-y-auto rounded-t-3xl sm:rounded-2xl bg-white dark:bg-[#0f141f] border border-slate-200 dark:border-slate-700 p-5 space-y-4">
        <div className="flex items-start justify-between gap-3">
          <div>
            <h2 className="text-lg font-black text-slate-900 dark:text-white">{title}</h2>
            <p className="text-xs text-slate-500">
              <span className="font-mono font-bold">{row.reference}</span> · {row.customerName} · {row.vehicleName}
            </p>
          </div>
          <button type="button" onClick={onClose} aria-label="Fermer" className="p-2 rounded-xl text-slate-400 hover:bg-slate-100 dark:hover:bg-slate-800">
            <X className="w-5 h-5" />
          </button>
        </div>

        {(kind === "pickup" || kind === "return") && (
          <label className="block space-y-1.5">
            <span className="text-sm font-semibold text-slate-700 dark:text-slate-300">
              Kilométrage au compteur (km){kind === "return" ? " *" : ""}
              {kind === "return" && row.pickupMileage !== null && (
                <span className="block text-xs font-normal text-slate-500">Départ : {row.pickupMileage.toLocaleString("fr-FR")} km</span>
              )}
            </span>
            <input type="number" inputMode="numeric" min={0} className={inputCls} value={mileage} onChange={(e) => setMileage(e.target.value)} placeholder="ex. 45230" autoFocus />
          </label>
        )}

        {kind === "return" && (
          <label className="flex items-center gap-3 p-3 rounded-xl border border-slate-200 dark:border-slate-700 text-sm font-semibold text-slate-700 dark:text-slate-300">
            <input type="checkbox" className="w-5 h-5" checked={toGarage} onChange={(e) => setToGarage(e.target.checked)} />
            Véhicule à envoyer au garage (dégât, entretien)
          </label>
        )}

        {kind === "dates" && (
          <>
            <div className="grid grid-cols-2 gap-3">
              <label className="block space-y-1.5">
                <span className="text-sm font-semibold text-slate-700 dark:text-slate-300">Nouveau retour</span>
                <input type="date" className={inputCls} min={row.pickupDate} value={newDate} onChange={(e) => setNewDate(e.target.value)} />
              </label>
              <label className="block space-y-1.5">
                <span className="text-sm font-semibold text-slate-700 dark:text-slate-300">Heure</span>
                <input type="time" className={inputCls} value={newTime} onChange={(e) => setNewTime(e.target.value)} />
              </label>
            </div>
            <p className={`p-3 rounded-xl text-sm font-semibold ${delta > 0 ? "bg-amber-50 text-amber-900 dark:bg-amber-950/30 dark:text-amber-200" : delta < 0 ? "bg-blue-50 text-blue-900 dark:bg-blue-950/30 dark:text-blue-200" : "bg-slate-50 text-slate-600 dark:bg-slate-900 dark:text-slate-300"}`}>
              Retour actuel : {frDate(row.returnDate)}.{" "}
              {delta > 0 ? `Prolongation de ${delta} jour(s) — le même véhicule doit être libre.` : delta < 0 ? `Réduction de ${-delta} jour(s) — le prix sera recalculé.` : "Même date."}
            </p>
          </>
        )}

        <label className="block space-y-1.5">
          <span className="text-sm font-semibold text-slate-700 dark:text-slate-300">{kind === "note" ? "Note *" : "Remarques (état, carburant…)"}</span>
          <textarea className={`${inputCls} h-24 py-2.5`} value={notes} onChange={(e) => setNotes(e.target.value)} />
        </label>

        {error && (
          <p role="alert" className="p-3 rounded-xl bg-red-50 dark:bg-red-950/40 text-red-700 dark:text-red-300 text-sm font-semibold flex items-start gap-2">
            <AlertTriangle className="w-5 h-5 shrink-0" /> {error}
          </p>
        )}

        <div className="grid grid-cols-2 gap-2">
          <button type="button" onClick={onClose} className={`${big} bg-slate-100 dark:bg-slate-800 text-slate-700 dark:text-slate-300`}>
            Annuler
          </button>
          <button type="button" disabled={busy} onClick={submit} className={`${big} bg-blue-600 hover:bg-blue-500 text-white`}>
            {busy ? <Loader2 className="w-5 h-5 animate-spin" /> : <CheckCircle2 className="w-5 h-5" />} Valider
          </button>
        </div>
      </div>
    </div>
  );
}
