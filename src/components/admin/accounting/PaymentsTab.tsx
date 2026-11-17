"use client";

import { useCallback, useEffect, useState } from "react";
import { Download, Loader2, Plus, Receipt, Search } from "lucide-react";
import { ViewToggle, btn, usePermissions, useViewMode } from "@/components/admin/ui";
import { KIND_LABELS, METHOD_LABELS, dt } from "@/lib/accountingLabels";
import { BookingPayments } from "./BookingPayments";
import { Empty, ErrorNote, Kpi, Modal, PeriodBar, api, cardCls, frDateTime, inputCls, tdCls, thCls, type Period } from "./shared";

interface Row {
  _id: string;
  receiptNumber: string;
  bookingId: string;
  bookingReference: string;
  customerName: string;
  kind: string;
  amount: number;
  method: string;
  status: string;
  paidAt: string;
  recordedBy: string;
  reference?: string;
  voidReason?: string;
}
interface BookingHit {
  _id: string;
  bookingReference: string;
  customerName: string;
  vehicleName: string;
  totalAmount: number;
  amountPaid: number;
  paymentStatus: string;
}

export function PaymentsTab({ period, setPeriod, onChanged }: { period: Period; setPeriod: (p: Period) => void; onChanged: () => void }) {
  const { can } = usePermissions();
  const [view, setView] = useViewMode("accounting-payments");
  const [rows, setRows] = useState<Row[]>([]);
  const [totals, setTotals] = useState({ payments: 0, refunds: 0, deposits: 0, depositRefunds: 0, net: 0 });
  const [agents, setAgents] = useState<string[]>([]);
  const [filters, setFilters] = useState({ method: "", kind: "", agent: "", q: "" });
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");
  const [picker, setPicker] = useState(false);
  const [hits, setHits] = useState<BookingHit[]>([]);
  const [search, setSearch] = useState("");
  const [bookingId, setBookingId] = useState<string | null>(null);
  const [bookingTitle, setBookingTitle] = useState("");

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const q = new URLSearchParams({ from: period.from, to: period.to });
      Object.entries(filters).forEach(([k, v]) => v && q.set(k, v));
      const d = await api<{ payments: Row[]; totals: typeof totals; agents: string[] }>(`/api/admin/accounting/payments?${q}`);
      setRows(d.payments);
      setTotals(d.totals);
      setAgents(d.agents);
      setError("");
    } catch (e) {
      setError(e instanceof Error ? e.message : "Chargement impossible");
    } finally {
      setLoading(false);
    }
  }, [period.from, period.to, filters]);
  useEffect(() => {
    const t = setTimeout(load, filters.q ? 300 : 0);
    return () => clearTimeout(t);
  }, [load, filters.q]);

  useEffect(() => {
    if (!picker) return;
    const t = setTimeout(() => {
      api<{ bookings: BookingHit[] }>(`/api/admin/bookings?limit=20${search ? `&search=${encodeURIComponent(search)}` : ""}`)
        .then((d) => setHits(d.bookings || []))
        .catch(() => setHits([]));
    }, 250);
    return () => clearTimeout(t);
  }, [picker, search]);

  const open = (id: string, title: string) => {
    setBookingId(id);
    setBookingTitle(title);
    setPicker(false);
  };
  const amountCell = (r: Row) => {
    const out = r.kind === "refund" || r.kind === "deposit_refund";
    return <span className={`font-black tabular-nums whitespace-nowrap ${r.status === "voided" ? "line-through text-slate-400" : out ? "text-red-600" : "text-emerald-600"}`}>{out ? "−" : "+"}{dt(r.amount)}</span>;
  };

  return (
    <div className="space-y-3">
      <PeriodBar period={period} onChange={setPeriod}>
        {can("accounting.export") && (
          <a href={`/api/admin/accounting/export?type=payments&from=${period.from}&to=${period.to}`} className={`${btn.base} ${btn.secondary}`}>
            <Download className="w-4 h-4" /> CSV
          </a>
        )}
        {can("payments.create") && (
          <button type="button" onClick={() => setPicker(true)} className={`${btn.base} ${btn.primary}`}>
            <Plus className="w-4 h-4" /> Encaisser
          </button>
        )}
      </PeriodBar>
      <div className="grid grid-cols-2 lg:grid-cols-4 gap-3">
        <Kpi label="Paiements reçus" value={dt(totals.payments)} tone="emerald" />
        <Kpi label="Remboursements" value={dt(totals.refunds)} tone="red" />
        <Kpi label="Net encaissé" value={dt(totals.net)} tone="blue" />
        <Kpi label="Cautions (reçues − rendues)" value={dt(totals.deposits - totals.depositRefunds)} />
      </div>
      <div className={`${cardCls} p-3 grid grid-cols-2 lg:grid-cols-5 gap-2`}>
        <div className="relative col-span-2">
          <Search className="w-4 h-4 absolute left-3 top-1/2 -translate-y-1/2 text-slate-400" />
          <input className={`${inputCls} pl-9`} placeholder="Référence, client, n° de reçu…" value={filters.q} onChange={(e) => setFilters({ ...filters, q: e.target.value })} />
        </div>
        <select aria-label="Type" className={inputCls} value={filters.kind} onChange={(e) => setFilters({ ...filters, kind: e.target.value })}>
          <option value="">Tous les types</option>
          {Object.entries(KIND_LABELS).map(([k, l]) => <option key={k} value={k}>{l}</option>)}
        </select>
        <select aria-label="Mode" className={inputCls} value={filters.method} onChange={(e) => setFilters({ ...filters, method: e.target.value })}>
          <option value="">Tous les modes</option>
          {Object.entries(METHOD_LABELS).map(([k, l]) => <option key={k} value={k}>{l}</option>)}
        </select>
        <div className="flex gap-2 col-span-2 lg:col-span-1">
          <select aria-label="Agent" className={inputCls} value={filters.agent} onChange={(e) => setFilters({ ...filters, agent: e.target.value })}>
            <option value="">Tous les agents</option>
            {agents.map((a) => <option key={a} value={a}>{a}</option>)}
          </select>
          <ViewToggle value={view} onChange={setView} />
        </div>
      </div>
      <ErrorNote text={error} />
      {loading && rows.length === 0 ? (
        <Loader2 className="w-6 h-6 animate-spin text-slate-400 mx-auto my-8" />
      ) : rows.length === 0 ? (
        <Empty>Aucun mouvement sur cette période.</Empty>
      ) : view === "table" ? (
        <div className={`${cardCls} overflow-x-auto`}>
          <table className="w-full min-w-[820px]">
            <thead><tr><th className={thCls}>Date</th><th className={thCls}>Reçu</th><th className={thCls}>Type</th><th className={thCls}>Réservation</th><th className={thCls}>Client</th><th className={thCls}>Mode</th><th className={thCls}>Agent</th><th className={`${thCls} text-right`}>Montant</th><th className={thCls} /></tr></thead>
            <tbody className="divide-y divide-slate-100 dark:divide-slate-800">
              {rows.map((r) => (
                <tr key={r._id} className={r.status === "voided" ? "opacity-60" : ""}>
                  <td className={`${tdCls} whitespace-nowrap`}>{frDateTime(r.paidAt)}</td>
                  <td className={`${tdCls} font-mono`}>{r.receiptNumber}</td>
                  <td className={tdCls}>{KIND_LABELS[r.kind]}{r.status === "voided" && <div className="text-[11px] text-red-600">Annulé : {r.voidReason}</div>}</td>
                  <td className={tdCls}><button type="button" className="font-bold text-blue-600 hover:underline" onClick={() => open(r.bookingId, `${r.bookingReference} — ${r.customerName}`)}>{r.bookingReference}</button></td>
                  <td className={tdCls}>{r.customerName}</td>
                  <td className={tdCls}>{METHOD_LABELS[r.method] || r.method}{r.reference && <div className="text-[11px] text-slate-500">{r.reference}</div>}</td>
                  <td className={tdCls}>{r.recordedBy}</td>
                  <td className={`${tdCls} text-right`}>{amountCell(r)}</td>
                  <td className={tdCls}><a href={`/api/admin/accounting/payments/${r._id}/receipt`} target="_blank" rel="noopener noreferrer" aria-label={`Reçu ${r.receiptNumber}`} className="inline-flex p-2 rounded-lg text-blue-600 hover:bg-blue-50 dark:hover:bg-blue-500/10"><Receipt className="w-4 h-4" /></a></td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      ) : (
        <div className="grid sm:grid-cols-2 xl:grid-cols-3 gap-3">
          {rows.map((r) => (
            <div key={r._id} className={`${cardCls} p-3.5 space-y-1.5 ${r.status === "voided" ? "opacity-60" : ""}`}>
              <div className="flex items-start justify-between gap-2">
                <div className="min-w-0">
                  <div className="text-xs font-bold text-slate-900 dark:text-white truncate">{KIND_LABELS[r.kind]} · {METHOD_LABELS[r.method] || r.method}</div>
                  <div className="text-[11px] text-slate-500 font-mono">{r.receiptNumber}</div>
                </div>
                {amountCell(r)}
              </div>
              <button type="button" className="block text-left text-xs font-bold text-blue-600 hover:underline truncate w-full" onClick={() => open(r.bookingId, `${r.bookingReference} — ${r.customerName}`)}>
                {r.bookingReference} — {r.customerName}
              </button>
              <div className="flex items-center justify-between text-[11px] text-slate-500">
                <span className="truncate">{frDateTime(r.paidAt)} · {r.recordedBy}</span>
                <a href={`/api/admin/accounting/payments/${r._id}/receipt`} target="_blank" rel="noopener noreferrer" className="inline-flex items-center gap-1 font-bold text-blue-600"><Receipt className="w-3.5 h-3.5" /> Reçu</a>
              </div>
              {r.status === "voided" && <div className="text-[11px] font-semibold text-red-600">Annulé : {r.voidReason}</div>}
            </div>
          ))}
        </div>
      )}

      <Modal open={picker} onClose={() => setPicker(false)} title="Encaisser — choisir la réservation">
        <div className="relative">
          <Search className="w-4 h-4 absolute left-3 top-1/2 -translate-y-1/2 text-slate-400" />
          <input autoFocus className={`${inputCls} pl-9`} placeholder="Référence, nom ou téléphone du client" value={search} onChange={(e) => setSearch(e.target.value)} />
        </div>
        <ul className="divide-y divide-slate-100 dark:divide-slate-800 rounded-xl border border-slate-200 dark:border-slate-800">
          {hits.length === 0 && <li className="p-4 text-center text-slate-500">Aucune réservation trouvée.</li>}
          {hits.map((h) => (
            <li key={h._id}>
              <button type="button" onClick={() => open(h._id, `${h.bookingReference} — ${h.customerName}`)} className="w-full p-3 text-left hover:bg-slate-50 dark:hover:bg-slate-900 flex items-center justify-between gap-3">
                <span className="min-w-0">
                  <span className="block font-bold text-slate-900 dark:text-white truncate">{h.customerName}</span>
                  <span className="block text-[11px] text-slate-500 truncate">{h.bookingReference} · {h.vehicleName}</span>
                </span>
                <span className={`font-black tabular-nums whitespace-nowrap ${h.totalAmount - h.amountPaid > 0 && h.paymentStatus !== "paid" ? "text-red-600" : "text-emerald-600"}`}>
                  {h.paymentStatus === "paid" && !h.amountPaid ? "Payé" : `Reste ${dt(Math.max(0, h.totalAmount - h.amountPaid))}`}
                </span>
              </button>
            </li>
          ))}
        </ul>
      </Modal>

      <Modal open={Boolean(bookingId)} onClose={() => setBookingId(null)} title={bookingTitle} wide>
        {bookingId && <BookingPayments bookingId={bookingId} onChanged={() => { load(); onChanged(); }} />}
      </Modal>
    </div>
  );
}
