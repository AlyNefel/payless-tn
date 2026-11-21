"use client";

import { useCallback, useEffect, useState } from "react";
import { History, Loader2, Search } from "lucide-react";
import { Empty, ErrorNote, api, cardCls, frDateTime, inputCls, iso, tdCls, thCls } from "@/components/admin/accounting/shared";
import { ViewToggle, useViewMode } from "@/components/admin/ui";

interface Log {
  _id: string;
  userEmail: string;
  action: string;
  resource: string;
  resourceId?: string;
  previousValue?: unknown;
  newValue?: unknown;
  createdAt: string;
}

const ACTIONS: Record<string, string> = {
  "payment.payment": "Paiement encaissé",
  "payment.deposit": "Caution encaissée",
  "payment.refund": "Remboursement",
  "payment.deposit_refund": "Caution restituée",
  "payment.void": "Mouvement annulé",
  "expense.create": "Dépense créée",
  "expense.update": "Dépense modifiée",
  "expense.delete": "Dépense supprimée",
  "cash.close": "Caisse clôturée",
  "contract.issue": "Contrat émis",
  "contract.identity": "Identité du contrat modifiée",
  "invoice.issue": "Facture émise",
  "booking.update": "Réservation modifiée",
  "booking.price": "Prix de réservation modifié",
  "booking.delete": "Réservation supprimée",
  "pricing.rules": "Règles tarifaires modifiées",
  "pricing.model": "Tarifs d'un modèle modifiés",
  "pricing.copy": "Tarifs copiés vers d'autres modèles",
  "booking.change_vehicle": "Voiture changée",
  "booking.change_return": "Date de retour modifiée",
  "user.create": "Compte créé",
  "user.update": "Compte modifié",
  "user.delete": "Compte supprimé",
  "role.update": "Rôle modifié",
};
const label = (a: string) => ACTIONS[a] || (a.startsWith("export.") ? `Export ${a.slice(7)}` : a);
const show = (v: unknown) => (v == null ? "" : typeof v === "object" ? Object.entries(v as Record<string, unknown>).map(([k, x]) => `${k} : ${typeof x === "object" ? JSON.stringify(x) : String(x)}`).join(" · ") : String(v));

/** Read-only journal of sensitive actions: who did what and when. */
export default function AuditPage() {
  const [view, setView] = useViewMode("audit");
  const [logs, setLogs] = useState<Log[]>([]);
  const [users, setUsers] = useState<string[]>([]);
  const [resources, setResources] = useState<string[]>([]);
  const [f, setF] = useState(() => {
    const from = new Date();
    from.setDate(from.getDate() - 30);
    return { from: iso(from), to: iso(new Date()), user: "", resource: "", q: "" };
  });
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const q = new URLSearchParams();
      Object.entries(f).forEach(([k, v]) => v && q.set(k, v));
      const d = await api<{ logs: Log[]; users: string[]; resources: string[] }>(`/api/admin/audit?${q}`);
      setLogs(d.logs);
      setUsers(d.users);
      setResources(d.resources);
      setError("");
    } catch (e) {
      setError(e instanceof Error ? e.message : "Chargement impossible");
    } finally {
      setLoading(false);
    }
  }, [f]);
  useEffect(() => {
    const t = setTimeout(load, f.q ? 300 : 0);
    return () => clearTimeout(t);
  }, [load, f.q]);

  return (
    <div className="space-y-4">
      <div className="flex items-start gap-3">
        <span className="p-2.5 rounded-xl bg-violet-50 dark:bg-violet-500/10 text-violet-600 shrink-0"><History className="w-5 h-5" /></span>
        <div>
          <h1 className="text-xl sm:text-2xl font-extrabold tracking-tight text-slate-900 dark:text-white">Journal d&apos;audit</h1>
          <p className="text-xs text-slate-500">Qui a fait quoi : argent, prix, contrats, comptes. Ce journal ne peut être ni modifié ni supprimé depuis l&apos;application.</p>
        </div>
      </div>
      <div className={`${cardCls} p-3 grid grid-cols-2 lg:grid-cols-6 gap-2`}>
        <div className="relative col-span-2">
          <Search className="w-4 h-4 absolute left-3 top-1/2 -translate-y-1/2 text-slate-400" />
          <input className={`${inputCls} pl-9`} placeholder="Action, utilisateur, identifiant…" value={f.q} onChange={(e) => setF({ ...f, q: e.target.value })} />
        </div>
        <input type="date" aria-label="Du" className={inputCls} value={f.from} onChange={(e) => setF({ ...f, from: e.target.value })} />
        <input type="date" aria-label="Au" className={inputCls} value={f.to} onChange={(e) => setF({ ...f, to: e.target.value })} />
        <select aria-label="Utilisateur" className={inputCls} value={f.user} onChange={(e) => setF({ ...f, user: e.target.value })}>
          <option value="">Tous les utilisateurs</option>
          {users.map((u) => <option key={u} value={u}>{u}</option>)}
        </select>
        <div className="flex gap-2">
          <select aria-label="Domaine" className={inputCls} value={f.resource} onChange={(e) => setF({ ...f, resource: e.target.value })}>
            <option value="">Tous les domaines</option>
            {resources.map((u) => <option key={u} value={u}>{u}</option>)}
          </select>
          <ViewToggle value={view} onChange={setView} />
        </div>
      </div>
      <ErrorNote text={error} />
      {loading && logs.length === 0 ? (
        <Loader2 className="w-6 h-6 animate-spin text-slate-400 mx-auto my-8" />
      ) : logs.length === 0 ? (
        <Empty>Aucune action enregistrée sur cette période.</Empty>
      ) : view === "table" ? (
        <div className={`${cardCls} overflow-x-auto`}>
          <table className="w-full min-w-[760px]">
            <thead><tr><th className={thCls}>Date</th><th className={thCls}>Utilisateur</th><th className={thCls}>Action</th><th className={thCls}>Détail</th></tr></thead>
            <tbody className="divide-y divide-slate-100 dark:divide-slate-800">
              {logs.map((l) => (
                <tr key={l._id}>
                  <td className={`${tdCls} whitespace-nowrap`}>{frDateTime(l.createdAt)}</td>
                  <td className={tdCls}>{l.userEmail}</td>
                  <td className={`${tdCls} font-bold`}>{label(l.action)}</td>
                  <td className={`${tdCls} break-words max-w-md`}>
                    {l.previousValue != null && <div className="text-slate-500">Avant — {show(l.previousValue)}</div>}
                    <div>{show(l.newValue)}</div>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      ) : (
        <div className="grid sm:grid-cols-2 xl:grid-cols-3 gap-3">
          {logs.map((l) => (
            <div key={l._id} className={`${cardCls} p-3.5 space-y-1`}>
              <div className="text-xs font-bold text-slate-900 dark:text-white">{label(l.action)}</div>
              <div className="text-[11px] text-slate-500">{frDateTime(l.createdAt)} · {l.userEmail}</div>
              {l.previousValue != null && <div className="text-[11px] text-slate-500 break-words">Avant — {show(l.previousValue)}</div>}
              <div className="text-[11px] text-slate-700 dark:text-slate-200 break-words">{show(l.newValue)}</div>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}
