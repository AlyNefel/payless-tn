"use client";

import { useCallback, useEffect, useState } from "react";
import { Banknote, FileText, Loader2, Receipt, RotateCcw } from "lucide-react";
import { btn, usePermissions } from "@/components/admin/ui";
import { KIND_LABELS, METHOD_LABELS, dt } from "@/lib/accountingLabels";
import { ErrorNote, api, frDateTime, inputCls, labelCls } from "./shared";

interface Movement {
  _id: string;
  receiptNumber: string;
  kind: "payment" | "deposit" | "refund" | "deposit_refund";
  amount: number;
  method: string;
  status: "completed" | "voided";
  paidAt: string;
  recordedBy: string;
  reference?: string;
  voidReason?: string;
  closingId?: string;
}
interface Money {
  total: number;
  paid: number;
  remaining: number;
  refundDue?: number;
  depositHeld: number;
  paymentStatus: string;
}

/**
 * Money of one booking: balance, deposit, movements, and the form to record a payment.
 * Used at the counter (worker space), in the booking page and in accounting.
 */
export function BookingPayments({ bookingId, onChanged, compact }: { bookingId: string; onChanged?: () => void; compact?: boolean }) {
  const { can } = usePermissions();
  const [money, setMoney] = useState<Money | null>(null);
  const [depositDue, setDepositDue] = useState(0);
  const [rows, setRows] = useState<Movement[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");
  const [busy, setBusy] = useState(false);
  const [kind, setKind] = useState<Movement["kind"]>("payment");
  const [amount, setAmount] = useState("");
  const [method, setMethod] = useState("cash");
  const [reference, setReference] = useState("");

  const load = useCallback(async () => {
    try {
      const d = await api<{ payments: Movement[]; money: Money; depositDue: number }>(`/api/admin/accounting/payments?bookingId=${bookingId}`);
      setRows(d.payments);
      setMoney(d.money);
      setDepositDue(d.depositDue);
      setError("");
    } catch (e) {
      setError(e instanceof Error ? e.message : "Chargement impossible");
    } finally {
      setLoading(false);
    }
  }, [bookingId]);
  useEffect(() => {
    load();
  }, [load]);

  // Suggested amount for the chosen movement.
  const suggestion = !money ? 0 : kind === "payment" ? money.remaining : kind === "deposit" ? Math.max(0, depositDue - money.depositHeld) : kind === "refund" ? (money.refundDue || money.paid) : money.depositHeld;
  const canOut = can("payments.delete");

  const submit = async () => {
    const value = Number(String(amount).replace(",", "."));
    if (!(value > 0)) return setError("Saisissez un montant.");
    setBusy(true);
    setError("");
    try {
      await api("/api/admin/accounting/payments", { method: "POST", body: JSON.stringify({ bookingId, kind, amountTND: value, method, reference: reference || undefined }) });
      setAmount("");
      setReference("");
      await load();
      onChanged?.();
    } catch (e) {
      setError(e instanceof Error ? e.message : "Enregistrement impossible");
    } finally {
      setBusy(false);
    }
  };

  const voidRow = async (m: Movement) => {
    const reason = window.prompt(`Annuler le reçu ${m.receiptNumber} ? Indiquez le motif :`);
    if (!reason?.trim()) return;
    try {
      await api(`/api/admin/accounting/payments?id=${m._id}&reason=${encodeURIComponent(reason)}`, { method: "DELETE" });
      await load();
      onChanged?.();
    } catch (e) {
      setError(e instanceof Error ? e.message : "Annulation impossible");
    }
  };

  if (loading) return <Loader2 className="w-5 h-5 animate-spin text-slate-400" />;
  return (
    <div className="space-y-3">
      {money && (
        <div className="grid grid-cols-2 sm:grid-cols-4 gap-2">
          {[
            ["Total", dt(money.total), "text-slate-900 dark:text-white"],
            ["Encaissé", dt(money.paid), "text-emerald-600"],
            money.refundDue
              ? ["À rembourser au client", dt(money.refundDue), "text-amber-600"]
              : ["Reste à payer", dt(money.remaining), money.remaining > 0 ? "text-red-600" : "text-emerald-600"],
            ["Caution détenue", `${dt(money.depositHeld)}${depositDue ? ` / ${dt(depositDue)}` : ""}`, "text-blue-600"],
          ].map(([l, v, c]) => (
            <div key={l} className="p-2.5 rounded-xl bg-slate-50 dark:bg-slate-900/60 border border-slate-100 dark:border-slate-800 min-w-0">
              <div className="text-[10px] font-bold uppercase tracking-wider text-slate-500 truncate">{l}</div>
              <div className={`text-sm font-black tabular-nums truncate ${c}`}>{v}</div>
            </div>
          ))}
        </div>
      )}
      <ErrorNote text={error} />

      {can("payments.create") && (
        <div className="p-3 rounded-xl border border-slate-200 dark:border-slate-800 space-y-2.5">
          <div className="flex gap-1.5 overflow-x-auto pb-0.5">
            {(["payment", "deposit", ...(canOut ? (["refund", "deposit_refund"] as const) : [])] as Movement["kind"][]).map((k) => (
              <button
                key={k}
                type="button"
                onClick={() => {
                  setKind(k);
                  setAmount("");
                }}
                className={`shrink-0 px-3 h-9 rounded-xl text-xs font-bold ${kind === k ? "bg-blue-600 text-white" : "border border-slate-200 dark:border-slate-700 text-slate-600 dark:text-slate-300"}`}
              >
                {KIND_LABELS[k]}
              </button>
            ))}
          </div>
          <div className="grid grid-cols-2 gap-2">
            <label>
              <span className={labelCls}>Montant (DT)</span>
              <input inputMode="decimal" className={inputCls} value={amount} placeholder={suggestion ? (suggestion / 100).toFixed(3) : "0.000"} onChange={(e) => setAmount(e.target.value)} />
            </label>
            <label>
              <span className={labelCls}>Mode</span>
              <select className={inputCls} value={method} onChange={(e) => setMethod(e.target.value)}>
                {Object.entries(METHOD_LABELS).map(([k, l]) => (
                  <option key={k} value={k}>{l}</option>
                ))}
              </select>
            </label>
          </div>
          {method !== "cash" && (
            <label className="block">
              <span className={labelCls}>Référence (n° chèque, virement, ticket TPE)</span>
              <input className={inputCls} value={reference} onChange={(e) => setReference(e.target.value)} />
            </label>
          )}
          <div className="flex flex-wrap gap-2">
            {suggestion > 0 && (
              <button type="button" onClick={() => setAmount((suggestion / 100).toFixed(3))} className={`${btn.base} ${btn.secondary}`}>
                Tout : {dt(suggestion)}
              </button>
            )}
            <button type="button" onClick={submit} disabled={busy} className={`${btn.base} ${kind === "refund" || kind === "deposit_refund" ? btn.danger : btn.success} flex-1 sm:flex-none`}>
              {busy ? <Loader2 className="w-4 h-4 animate-spin" /> : <Banknote className="w-4 h-4" />} Enregistrer
            </button>
          </div>
        </div>
      )}

      <div className="flex flex-wrap gap-2">
        <a href={`/api/admin/bookings/${bookingId}/contract`} target="_blank" rel="noopener noreferrer" className={`${btn.base} ${btn.secondary}`}>
          <FileText className="w-4 h-4" /> Contrat
        </a>
        <a href={`/api/admin/bookings/${bookingId}/invoice`} target="_blank" rel="noopener noreferrer" className={`${btn.base} ${btn.secondary}`}>
          <Receipt className="w-4 h-4" /> Facture
        </a>
      </div>

      {rows.length > 0 && (
        <ul className={`divide-y divide-slate-100 dark:divide-slate-800 rounded-xl border border-slate-200 dark:border-slate-800 ${compact ? "max-h-56 overflow-y-auto" : ""}`}>
          {rows.map((m) => {
            const out = m.kind === "refund" || m.kind === "deposit_refund";
            return (
              <li key={m._id} className={`p-2.5 flex items-center gap-2 ${m.status === "voided" ? "opacity-50" : ""}`}>
                <div className="min-w-0 flex-1">
                  <div className="font-bold text-slate-900 dark:text-white truncate">
                    {KIND_LABELS[m.kind]} · {METHOD_LABELS[m.method] || m.method}
                    {m.status === "voided" && <span className="ml-1 text-red-600">(annulé{m.voidReason ? ` : ${m.voidReason}` : ""})</span>}
                  </div>
                  <div className="text-[11px] text-slate-500 truncate">
                    {m.receiptNumber} · {frDateTime(m.paidAt)} · {m.recordedBy}
                  </div>
                </div>
                <span className={`font-black tabular-nums whitespace-nowrap ${out ? "text-red-600" : "text-emerald-600"}`}>
                  {out ? "−" : "+"}
                  {dt(m.amount)}
                </span>
                <a href={`/api/admin/accounting/payments/${m._id}/receipt`} target="_blank" rel="noopener noreferrer" aria-label={`Reçu ${m.receiptNumber}`} className="p-2 rounded-lg text-blue-600 hover:bg-blue-50 dark:hover:bg-blue-500/10">
                  <Receipt className="w-4 h-4" />
                </a>
                {canOut && m.status === "completed" && !m.closingId && (
                  <button type="button" onClick={() => voidRow(m)} aria-label={`Annuler ${m.receiptNumber}`} className="p-2 rounded-lg text-red-600 hover:bg-red-50 dark:hover:bg-red-500/10">
                    <RotateCcw className="w-4 h-4" />
                  </button>
                )}
              </li>
            );
          })}
        </ul>
      )}
    </div>
  );
}
