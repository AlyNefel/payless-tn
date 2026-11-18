"use client";

import { useCallback, useEffect, useState } from "react";
import { Banknote, FileText, Loader2, Receipt, Search } from "lucide-react";
import { StatusBadge, ViewToggle, btn, useViewMode } from "@/components/admin/ui";
import { dt } from "@/lib/accountingLabels";
import { BookingPayments } from "./BookingPayments";
import Link from "next/link";
import { Empty, ErrorNote, Modal, api, cardCls, frDay, inputCls, tdCls, thCls } from "./shared";

interface Row {
  _id: string;
  bookingReference: string;
  bookingStatus: string;
  paymentStatus: string;
  customerName: string;
  vehicleName: string;
  pickupDate: string;
  returnDate: string;
  totalAmount: number;
  amountPaid: number;
  depositHeld: number;
  contractNumber: string;
  invoiceNumber: string;
}

/** Contracts, invoices and receipts per booking. */
export function DocumentsTab({ onChanged, refreshKey }: { onChanged: () => void; refreshKey: number }) {
  const [view, setView] = useViewMode("accounting-documents");
  const [rows, setRows] = useState<Row[]>([]);
  const [search, setSearch] = useState("");
  const [status, setStatus] = useState("");
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");
  const [pay, setPay] = useState<Row | null>(null);

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const q = new URLSearchParams({ limit: "100" });
      if (search) q.set("search", search);
      if (status) q.set("status", status);
      const d = await api<{ bookings: Row[] }>(`/api/admin/bookings?${q}`);
      setRows((d.bookings || []).filter((b) => !["cancelled", "rejected"].includes(b.bookingStatus)));
      setError("");
    } catch (e) {
      setError(e instanceof Error ? e.message : "Chargement impossible");
    } finally {
      setLoading(false);
    }
  }, [search, status]);
  useEffect(() => {
    const t = setTimeout(load, search ? 300 : 0);
    return () => clearTimeout(t);
  }, [load, search, refreshKey]);

  const remaining = (r: Row) => (r.paymentStatus === "paid" && !r.amountPaid ? 0 : Math.max(0, r.totalAmount - r.amountPaid));
  const buttons = (r: Row) => (
    <div className="flex flex-wrap gap-1.5 justify-end">
      <Link href={`/admin/bookings/${r._id}/contrat`} className={`${btn.base} ${btn.secondary} h-8 px-2.5`}><FileText className="w-3.5 h-3.5" /> Contrat</Link>
      {r.bookingStatus !== "pending" && (
        <Link href={`/admin/bookings/${r._id}/facture`} className={`${btn.base} ${btn.secondary} h-8 px-2.5`}><Receipt className="w-3.5 h-3.5" /> Facture</Link>
      )}
      <button type="button" onClick={() => setPay(r)} className={`${btn.base} ${btn.primary} h-8 px-2.5`}><Banknote className="w-3.5 h-3.5" /> Paiements</button>
    </div>
  );

  return (
    <div className="space-y-3">
      <div className={`${cardCls} p-3 flex flex-col sm:flex-row gap-2`}>
        <div className="relative flex-1">
          <Search className="w-4 h-4 absolute left-3 top-1/2 -translate-y-1/2 text-slate-400" />
          <input className={`${inputCls} pl-9`} placeholder="Référence, client, téléphone…" value={search} onChange={(e) => setSearch(e.target.value)} />
        </div>
        <select aria-label="Statut" className={`${inputCls} sm:w-52`} value={status} onChange={(e) => setStatus(e.target.value)}>
          <option value="">Tous les statuts</option>
          <option value="confirmed">Confirmées</option>
          <option value="active">En cours</option>
          <option value="completed">Clôturées</option>
          <option value="pending">En attente</option>
        </select>
        <ViewToggle value={view} onChange={setView} />
      </div>
      <ErrorNote text={error} />
      {loading && rows.length === 0 ? (
        <Loader2 className="w-6 h-6 animate-spin text-slate-400 mx-auto my-8" />
      ) : rows.length === 0 ? (
        <Empty>Aucune réservation.</Empty>
      ) : view === "table" ? (
        <div className={`${cardCls} overflow-x-auto`}>
          <table className="w-full min-w-[900px]">
            <thead><tr><th className={thCls}>Réservation</th><th className={thCls}>Client</th><th className={thCls}>Période</th><th className={thCls}>Contrat</th><th className={thCls}>Facture</th><th className={`${thCls} text-right`}>Total</th><th className={`${thCls} text-right`}>Reste</th><th className={thCls} /></tr></thead>
            <tbody className="divide-y divide-slate-100 dark:divide-slate-800">
              {rows.map((r) => (
                <tr key={r._id}>
                  <td className={tdCls}><a href={`/admin/bookings/${r._id}`} className="font-bold text-blue-600 hover:underline">{r.bookingReference}</a><div className="mt-0.5"><StatusBadge status={r.bookingStatus} /></div></td>
                  <td className={tdCls}>{r.customerName}<div className="text-[11px] text-slate-500">{r.vehicleName}</div></td>
                  <td className={`${tdCls} whitespace-nowrap`}>{frDay(r.pickupDate)} → {frDay(r.returnDate)}</td>
                  <td className={`${tdCls} font-mono`}>{r.contractNumber || "—"}</td>
                  <td className={`${tdCls} font-mono`}>{r.invoiceNumber || "—"}</td>
                  <td className={`${tdCls} text-right tabular-nums whitespace-nowrap`}>{dt(r.totalAmount)}</td>
                  <td className={`${tdCls} text-right font-black tabular-nums whitespace-nowrap ${remaining(r) > 0 ? "text-red-600" : "text-emerald-600"}`}>{remaining(r) > 0 ? dt(remaining(r)) : "Soldé"}</td>
                  <td className={tdCls}>{buttons(r)}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      ) : (
        <div className="grid sm:grid-cols-2 xl:grid-cols-3 gap-3">
          {rows.map((r) => (
            <div key={r._id} className={`${cardCls} p-3.5 space-y-2`}>
              <div className="flex items-start justify-between gap-2">
                <div className="min-w-0">
                  <div className="text-xs font-bold text-slate-900 dark:text-white truncate">{r.customerName}</div>
                  <div className="text-[11px] text-slate-500 truncate">{r.bookingReference} · {r.vehicleName}</div>
                </div>
                <StatusBadge status={r.bookingStatus} />
              </div>
              <div className="text-[11px] text-slate-500">{frDay(r.pickupDate)} → {frDay(r.returnDate)}</div>
              <div className="flex justify-between text-xs">
                <span className="text-slate-500">Contrat <span className="font-mono text-slate-700 dark:text-slate-200">{r.contractNumber || "—"}</span></span>
                <span className={`font-black tabular-nums ${remaining(r) > 0 ? "text-red-600" : "text-emerald-600"}`}>{remaining(r) > 0 ? `Reste ${dt(remaining(r))}` : "Soldé"}</span>
              </div>
              {buttons(r)}
            </div>
          ))}
        </div>
      )}
      <Modal open={Boolean(pay)} onClose={() => setPay(null)} title={pay ? `${pay.bookingReference} — ${pay.customerName}` : ""} wide>
        {pay && <BookingPayments bookingId={pay._id} onChanged={() => { load(); onChanged(); }} />}
      </Modal>
    </div>
  );
}
