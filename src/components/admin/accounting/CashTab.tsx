"use client";

import { useCallback, useEffect, useState } from "react";
import { Loader2, Lock } from "lucide-react";
import { btn, usePermissions } from "@/components/admin/ui";
import { KIND_LABELS, dt } from "@/lib/accountingLabels";
import { Empty, ErrorNote, Kpi, api, cardCls, frDateTime, inputCls, labelCls, tdCls, thCls } from "./shared";

interface Open {
  agent: string;
  openingFloat: number;
  cashIn: number;
  cashOut: number;
  cashExpenses: number;
  expected: number;
  lastClosedAt: string | null;
  payments: { _id: string; receiptNumber: string; kind: string; amount: number; bookingReference: string; customerName: string; paidAt: string; recordedBy: string }[];
  expenses: { _id: string; number: string; label: string; amount: number; date: string; createdBy: string }[];
}
interface Closing {
  _id: string;
  number: string;
  closedAt: string;
  closedBy: string;
  agent: string;
  expected: number;
  counted: number;
  difference: number;
  paymentCount: number;
  expenseCount: number;
  notes?: string;
}

/** Cash drawer: what the ledger expects in cash vs what is counted, then the closing that locks it. */
export function CashTab({ onChanged }: { onChanged: () => void }) {
  const { can } = usePermissions();
  const [agent, setAgent] = useState("");
  const [open, setOpen] = useState<Open | null>(null);
  const [closings, setClosings] = useState<Closing[]>([]);
  const [agents, setAgents] = useState<string[]>([]);
  const [counted, setCounted] = useState("");
  const [notes, setNotes] = useState("");
  const [error, setError] = useState("");
  const [busy, setBusy] = useState(false);

  const load = useCallback(async () => {
    try {
      const d = await api<{ open: Open; closings: Closing[]; agents: string[] }>(`/api/admin/accounting/closings?agent=${encodeURIComponent(agent)}`);
      setOpen(d.open);
      setClosings(d.closings);
      setAgents(d.agents);
    } catch (e) {
      setError(e instanceof Error ? e.message : "Chargement impossible");
    }
  }, [agent]);
  useEffect(() => {
    load();
  }, [load]);

  const value = Number(String(counted || "").replace(",", "."));
  const diff = open && counted !== "" && Number.isFinite(value) ? Math.round(value * 100) - open.expected : null;

  const close = async () => {
    if (!open || diff === null) return setError("Saisissez le montant compté.");
    if (!window.confirm(`Clôturer la caisse ${agent ? `de ${agent}` : "de l'agence"} ? Les mouvements comptés seront verrouillés.`)) return;
    setBusy(true);
    setError("");
    try {
      await api("/api/admin/accounting/closings", { method: "POST", body: JSON.stringify({ agent, countedTND: value, notes }) });
      setCounted("");
      setNotes("");
      await load();
      onChanged();
    } catch (e) {
      setError(e instanceof Error ? e.message : "Clôture impossible");
    } finally {
      setBusy(false);
    }
  };

  if (!open) return error ? <ErrorNote text={error} /> : <Loader2 className="w-6 h-6 animate-spin text-slate-400 mx-auto my-8" />;
  return (
    <div className="space-y-3">
      <div className={`${cardCls} p-3 flex flex-col sm:flex-row sm:items-center gap-2`}>
        <label className="flex-1">
          <span className={labelCls}>Caisse</span>
          <select className={inputCls} value={agent} onChange={(e) => setAgent(e.target.value)}>
            <option value="">Toute l&apos;agence</option>
            {agents.map((a) => <option key={a} value={a}>{a}</option>)}
          </select>
        </label>
        <p className="text-[11px] text-slate-500 sm:max-w-sm">
          {open.lastClosedAt ? `Dernière clôture : ${frDateTime(open.lastClosedAt)}.` : "Aucune clôture pour cette caisse."} Seuls les mouvements en espèces non encore clôturés sont comptés.
        </p>
      </div>
      <div className="grid grid-cols-2 lg:grid-cols-5 gap-3">
        <Kpi label="Fond de caisse" value={dt(open.openingFloat)} hint="Compté à la dernière clôture" />
        <Kpi label="Entrées espèces" value={dt(open.cashIn)} tone="emerald" />
        <Kpi label="Sorties espèces" value={dt(open.cashOut)} tone="red" hint="Remboursements, cautions rendues" />
        <Kpi label="Dépenses espèces" value={dt(open.cashExpenses)} tone="red" />
        <Kpi label="Attendu en caisse" value={dt(open.expected)} tone="blue" />
      </div>
      <ErrorNote text={error} />
      {can("accounting.create") && (
        <div className={`${cardCls} p-4 grid sm:grid-cols-4 gap-3 items-end`}>
          <label>
            <span className={labelCls}>Montant compté (DT)</span>
            <input inputMode="decimal" className={inputCls} value={counted} placeholder={(open.expected / 100).toFixed(3)} onChange={(e) => setCounted(e.target.value)} />
          </label>
          <div>
            <span className={labelCls}>Écart</span>
            <div className={`h-10 flex items-center font-black tabular-nums ${diff === null ? "text-slate-400" : diff === 0 ? "text-emerald-600" : "text-red-600"}`}>
              {diff === null ? "—" : diff === 0 ? "Aucun écart" : `${diff > 0 ? "+" : "−"}${dt(Math.abs(diff))}`}
            </div>
          </div>
          <label className="sm:col-span-1">
            <span className={labelCls}>Explication {diff ? "(obligatoire)" : ""}</span>
            <input className={inputCls} value={notes} onChange={(e) => setNotes(e.target.value)} />
          </label>
          <button type="button" onClick={close} disabled={busy} className={`${btn.base} ${btn.primary} h-10`}>
            {busy ? <Loader2 className="w-4 h-4 animate-spin" /> : <Lock className="w-4 h-4" />} Clôturer la caisse
          </button>
        </div>
      )}

      <div className={`${cardCls} overflow-hidden`}>
        <h3 className="p-4 pb-2 text-sm font-bold text-slate-900 dark:text-white">Mouvements en espèces à clôturer ({open.payments.length + open.expenses.length})</h3>
        {open.payments.length + open.expenses.length === 0 ? (
          <div className="p-4 pt-0"><Empty>Aucun mouvement en espèces depuis la dernière clôture.</Empty></div>
        ) : (
          <div className="overflow-x-auto max-h-80">
            <table className="w-full min-w-[560px]">
              <thead><tr><th className={thCls}>Date</th><th className={thCls}>Pièce</th><th className={thCls}>Libellé</th><th className={thCls}>Saisi par</th><th className={`${thCls} text-right`}>Montant</th></tr></thead>
              <tbody className="divide-y divide-slate-100 dark:divide-slate-800">
                {open.payments.map((p) => {
                  const out = p.kind === "refund" || p.kind === "deposit_refund";
                  return (
                    <tr key={p._id}>
                      <td className={`${tdCls} whitespace-nowrap`}>{frDateTime(p.paidAt)}</td>
                      <td className={`${tdCls} font-mono`}>{p.receiptNumber}</td>
                      <td className={tdCls}>{KIND_LABELS[p.kind]} — {p.bookingReference} {p.customerName}</td>
                      <td className={tdCls}>{p.recordedBy}</td>
                      <td className={`${tdCls} text-right font-black tabular-nums whitespace-nowrap ${out ? "text-red-600" : "text-emerald-600"}`}>{out ? "−" : "+"}{dt(p.amount)}</td>
                    </tr>
                  );
                })}
                {open.expenses.map((e) => (
                  <tr key={e._id}>
                    <td className={`${tdCls} whitespace-nowrap`}>{frDateTime(e.date)}</td>
                    <td className={`${tdCls} font-mono`}>{e.number}</td>
                    <td className={tdCls}>Dépense — {e.label}</td>
                    <td className={tdCls}>{e.createdBy}</td>
                    <td className={`${tdCls} text-right font-black tabular-nums whitespace-nowrap text-red-600`}>−{dt(e.amount)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </div>

      <div className={`${cardCls} overflow-hidden`}>
        <h3 className="p-4 pb-2 text-sm font-bold text-slate-900 dark:text-white">Historique des clôtures</h3>
        {closings.length === 0 ? (
          <div className="p-4 pt-0"><Empty>Aucune clôture enregistrée.</Empty></div>
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full min-w-[680px]">
              <thead><tr><th className={thCls}>N°</th><th className={thCls}>Date</th><th className={thCls}>Caisse</th><th className={thCls}>Clôturé par</th><th className={`${thCls} text-right`}>Attendu</th><th className={`${thCls} text-right`}>Compté</th><th className={`${thCls} text-right`}>Écart</th></tr></thead>
              <tbody className="divide-y divide-slate-100 dark:divide-slate-800">
                {closings.map((c) => (
                  <tr key={c._id}>
                    <td className={`${tdCls} font-mono`}>{c.number}</td>
                    <td className={`${tdCls} whitespace-nowrap`}>{frDateTime(c.closedAt)}</td>
                    <td className={tdCls}>{c.agent || "Agence"}</td>
                    <td className={tdCls}>{c.closedBy}{c.notes && <div className="text-[11px] text-slate-500">{c.notes}</div>}</td>
                    <td className={`${tdCls} text-right tabular-nums whitespace-nowrap`}>{dt(c.expected)}</td>
                    <td className={`${tdCls} text-right tabular-nums whitespace-nowrap`}>{dt(c.counted)}</td>
                    <td className={`${tdCls} text-right font-black tabular-nums whitespace-nowrap ${c.difference === 0 ? "text-emerald-600" : "text-red-600"}`}>{c.difference === 0 ? "0" : `${c.difference > 0 ? "+" : "−"}${dt(Math.abs(c.difference))}`}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </div>
    </div>
  );
}
