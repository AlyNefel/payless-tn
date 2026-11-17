"use client";

import { useEffect, useState } from "react";
import { Loader2 } from "lucide-react";
import { Bar, BarChart, CartesianGrid, Legend, ResponsiveContainer, Tooltip, XAxis, YAxis } from "recharts";
import type { AccountingSummary } from "@/lib/accountingReport";
import { EXPENSE_LABELS, METHOD_LABELS, dt } from "@/lib/accountingLabels";
import { Empty, ErrorNote, Kpi, api, cardCls, frDay, tdCls, thCls, type Period } from "./shared";

const MONTHS = ["janv.", "févr.", "mars", "avr.", "mai", "juin", "juil.", "août", "sept.", "oct.", "nov.", "déc."];

function Bars({ rows, tone }: { rows: { label: string; amount: number }[]; tone: string }) {
  const max = Math.max(1, ...rows.map((r) => Math.abs(r.amount)));
  if (!rows.length) return <p className="text-xs text-slate-500">Aucune donnée sur la période.</p>;
  return (
    <ul className="space-y-2">
      {rows.map((r) => (
        <li key={r.label}>
          <div className="flex justify-between gap-3 text-xs">
            <span className="text-slate-600 dark:text-slate-300 truncate">{r.label}</span>
            <span className="font-bold tabular-nums text-slate-900 dark:text-white whitespace-nowrap">{dt(r.amount)}</span>
          </div>
          <div className="mt-1 h-1.5 rounded-full bg-slate-100 dark:bg-slate-800 overflow-hidden">
            <div className={`h-full rounded-full ${tone}`} style={{ width: `${Math.max(2, (Math.abs(r.amount) / max) * 100)}%` }} />
          </div>
        </li>
      ))}
    </ul>
  );
}

export function DashboardTab({ period, refreshKey }: { period: Period; refreshKey: number }) {
  const [s, setS] = useState<AccountingSummary | null>(null);
  const [error, setError] = useState("");
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    let alive = true;
    setLoading(true);
    api<{ summary: AccountingSummary }>(`/api/admin/accounting/summary?from=${period.from}&to=${period.to}`)
      .then((d) => alive && (setS(d.summary), setError("")))
      .catch((e) => alive && setError(e.message))
      .finally(() => alive && setLoading(false));
    return () => {
      alive = false;
    };
  }, [period.from, period.to, refreshKey]);

  if (loading && !s) return <Loader2 className="w-6 h-6 animate-spin text-slate-400 mx-auto my-10" />;
  if (!s) return <ErrorNote text={error || "Données indisponibles"} />;
  const k = s.kpis;
  const chart = s.monthly.map((m) => ({ name: `${MONTHS[Number(m.month.slice(5)) - 1]} ${m.month.slice(2, 4)}`, Encaissé: m.collected / 100, Dépenses: m.expenses / 100 }));

  return (
    <div className="space-y-4">
      <ErrorNote text={error} />
      <div className="grid grid-cols-2 lg:grid-cols-4 gap-3">
        <Kpi label="Encaissé (net)" value={dt(k.collected)} hint="Paiements − remboursements" tone="emerald" />
        <Kpi label="Dépenses" value={dt(k.expenses)} hint={`${s.byCategory.length} catégorie(s)`} tone="red" />
        <Kpi label="Résultat de trésorerie" value={dt(k.result)} hint="Encaissé − dépenses" tone={k.result >= 0 ? "emerald" : "red"} />
        <Kpi label="Reste à encaisser" value={dt(k.receivables)} hint={`${s.receivables.length} réservation(s)`} tone={k.receivables > 0 ? "amber" : "slate"} />
        <Kpi label="Chiffre d'affaires facturé" value={dt(k.invoiced)} hint={`${k.bookings} location(s) démarrée(s)`} tone="blue" />
        <Kpi label="Panier moyen" value={dt(k.averageBasket)} hint={`${k.rentedDays} jour(s) loué(s)`} />
        <Kpi label="Taux d'occupation" value={`${k.occupancy} %`} hint={`sur ${s.period.days} jour(s)`} />
        <Kpi label="Cautions détenues" value={dt(k.depositsHeld)} hint={`${s.deposits.length} à restituer`} tone="blue" />
      </div>

      <div className={`${cardCls} p-4`}>
        <h3 className="text-sm font-bold text-slate-900 dark:text-white mb-3">Encaissements et dépenses — 12 derniers mois</h3>
        <div className="h-64 -ml-2">
          <ResponsiveContainer width="100%" height="100%">
            <BarChart data={chart} margin={{ top: 4, right: 4, bottom: 0, left: 0 }}>
              <CartesianGrid strokeDasharray="3 3" stroke="rgba(148,163,184,0.25)" vertical={false} />
              <XAxis dataKey="name" tick={{ fontSize: 10, fill: "#94a3b8" }} interval={0} angle={-30} textAnchor="end" height={42} />
              <YAxis tick={{ fontSize: 10, fill: "#94a3b8" }} width={44} />
              <Tooltip formatter={(v) => `${Number(v).toLocaleString("fr-FR")} DT`} contentStyle={{ fontSize: 12, borderRadius: 12 }} />
              <Legend wrapperStyle={{ fontSize: 11 }} />
              <Bar dataKey="Encaissé" fill="#10b981" radius={[4, 4, 0, 0]} />
              <Bar dataKey="Dépenses" fill="#ef4444" radius={[4, 4, 0, 0]} />
            </BarChart>
          </ResponsiveContainer>
        </div>
      </div>

      <div className="grid lg:grid-cols-3 gap-3">
        <div className={`${cardCls} p-4`}>
          <h3 className="text-sm font-bold text-slate-900 dark:text-white mb-3">Encaissé par mode de paiement</h3>
          <Bars tone="bg-emerald-500" rows={s.byMethod.map((m) => ({ label: METHOD_LABELS[m.method] || m.method, amount: m.amount }))} />
        </div>
        <div className={`${cardCls} p-4`}>
          <h3 className="text-sm font-bold text-slate-900 dark:text-white mb-3">Dépenses par catégorie</h3>
          <Bars tone="bg-red-500" rows={s.byCategory.map((c) => ({ label: EXPENSE_LABELS[c.category] || c.category, amount: c.amount }))} />
        </div>
        <div className={`${cardCls} p-4`}>
          <h3 className="text-sm font-bold text-slate-900 dark:text-white mb-3">Encaissé par agent</h3>
          <Bars tone="bg-blue-500" rows={s.agents.map((a) => ({ label: `${a.agent} (${a.count})`, amount: a.collected }))} />
        </div>
      </div>

      <div className={`${cardCls} p-4`}>
        <h3 className="text-sm font-bold text-slate-900 dark:text-white">TVA — estimation sur la période</h3>
        <p className="text-[11px] text-slate-500 mb-3">
          Calculée au taux de {s.vatRate} % sur le chiffre d&apos;affaires facturé (prix TTC, hors timbre fiscal et contribution). À faire valider par votre expert-comptable avant toute déclaration.
        </p>
        <div className="grid grid-cols-2 lg:grid-cols-4 gap-3">
          <Kpi label="TVA collectée" value={dt(k.vatCollected)} />
          <Kpi label="TVA déductible" value={dt(k.vatDeductible)} hint="Saisie sur les dépenses" />
          <Kpi label="TVA à reverser" value={dt(k.vatDue)} tone={k.vatDue > 0 ? "amber" : "emerald"} />
          <Kpi label="Timbres fiscaux" value={dt(k.stampDuty)} />
        </div>
      </div>

      <div className="grid lg:grid-cols-2 gap-3">
        <div className={`${cardCls} overflow-hidden`}>
          <h3 className="p-4 pb-2 text-sm font-bold text-slate-900 dark:text-white">Reste à encaisser</h3>
          {s.receivables.length === 0 ? (
            <div className="p-4 pt-0"><Empty>Aucun impayé.</Empty></div>
          ) : (
            <div className="overflow-x-auto max-h-80">
              <table className="w-full min-w-[420px]">
                <thead><tr><th className={thCls}>Réservation</th><th className={thCls}>Client</th><th className={thCls}>Retour</th><th className={`${thCls} text-right`}>Reste</th></tr></thead>
                <tbody className="divide-y divide-slate-100 dark:divide-slate-800">
                  {s.receivables.slice(0, 50).map((r) => (
                    <tr key={r.bookingId}>
                      <td className={tdCls}><a className="font-bold text-blue-600 hover:underline" href={`/admin/bookings/${r.bookingId}`}>{r.reference}</a></td>
                      <td className={tdCls}>{r.customer}<div className="text-[11px] text-slate-500">{r.phone}</div></td>
                      <td className={tdCls}>{frDay(r.returnDate)}</td>
                      <td className={`${tdCls} text-right font-black tabular-nums text-red-600 whitespace-nowrap`}>{dt(r.remaining)}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </div>
        <div className={`${cardCls} overflow-hidden`}>
          <h3 className="p-4 pb-2 text-sm font-bold text-slate-900 dark:text-white">Cautions à restituer</h3>
          {s.deposits.length === 0 ? (
            <div className="p-4 pt-0"><Empty>Aucune caution détenue.</Empty></div>
          ) : (
            <div className="overflow-x-auto max-h-80">
              <table className="w-full min-w-[380px]">
                <thead><tr><th className={thCls}>Réservation</th><th className={thCls}>Client</th><th className={thCls}>Retour</th><th className={`${thCls} text-right`}>Caution</th></tr></thead>
                <tbody className="divide-y divide-slate-100 dark:divide-slate-800">
                  {s.deposits.map((r) => (
                    <tr key={r.bookingId}>
                      <td className={tdCls}><a className="font-bold text-blue-600 hover:underline" href={`/admin/bookings/${r.bookingId}`}>{r.reference}</a></td>
                      <td className={tdCls}>{r.customer}</td>
                      <td className={tdCls}>{frDay(r.returnDate)}{r.status === "completed" && <span className="ml-1 text-amber-600 font-bold">· rendu</span>}</td>
                      <td className={`${tdCls} text-right font-black tabular-nums text-blue-600 whitespace-nowrap`}>{dt(r.held)}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </div>
      </div>

      <div className={`${cardCls} overflow-hidden`}>
        <h3 className="p-4 pb-1 text-sm font-bold text-slate-900 dark:text-white">Rentabilité par véhicule</h3>
        <p className="px-4 pb-2 text-[11px] text-slate-500">Chiffre d&apos;affaires des locations démarrées sur la période, moins les dépenses rattachées au véhicule et les coûts saisis au garage.</p>
        <div className="overflow-x-auto">
          <table className="w-full min-w-[640px]">
            <thead><tr><th className={thCls}>Véhicule</th><th className={`${thCls} text-right`}>Locations</th><th className={`${thCls} text-right`}>Jours</th><th className={`${thCls} text-right`}>Occupation</th><th className={`${thCls} text-right`}>CA</th><th className={`${thCls} text-right`}>Dépenses</th><th className={`${thCls} text-right`}>Marge</th></tr></thead>
            <tbody className="divide-y divide-slate-100 dark:divide-slate-800">
              {s.vehicles.map((v) => (
                <tr key={v.vehicleId}>
                  <td className={`${tdCls} font-bold`}>{v.name} <span className="font-normal text-slate-500">×{v.units}</span></td>
                  <td className={`${tdCls} text-right tabular-nums`}>{v.bookings}</td>
                  <td className={`${tdCls} text-right tabular-nums`}>{v.rentedDays}</td>
                  <td className={`${tdCls} text-right tabular-nums`}>{v.occupancy} %</td>
                  <td className={`${tdCls} text-right tabular-nums whitespace-nowrap`}>{dt(v.revenue)}</td>
                  <td className={`${tdCls} text-right tabular-nums whitespace-nowrap`}>{dt(v.expenses)}</td>
                  <td className={`${tdCls} text-right tabular-nums font-black whitespace-nowrap ${v.margin < 0 ? "text-red-600" : "text-emerald-600"}`}>{dt(v.margin)}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </div>

      {s.topCustomers.length > 0 && (
        <div className={`${cardCls} p-4`}>
          <h3 className="text-sm font-bold text-slate-900 dark:text-white mb-3">Meilleurs clients de la période</h3>
          <Bars tone="bg-violet-500" rows={s.topCustomers.map((c) => ({ label: `${c.customer} (${c.bookings})`, amount: c.revenue }))} />
        </div>
      )}
    </div>
  );
}
