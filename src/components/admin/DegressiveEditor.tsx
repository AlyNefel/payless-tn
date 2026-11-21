"use client";

import { NumberInput } from "@/components/admin/ui/NumberInput";
import { Plus, Trash2, TrendingDown } from "lucide-react";

export interface Tier {
  minDays: number;
  percent: number;
}

const field = "w-full px-2.5 py-1.5 rounded-xl bg-white dark:bg-slate-800 border border-slate-200 dark:border-slate-700 text-xs font-bold text-slate-900 dark:text-white focus:outline-none focus:ring-2 focus:ring-blue-500";

/** Degressive tariff of ONE model: from N days, X % off every day of the rental. */
export function DegressiveEditor({ tiers, baseRate, onChange }: { tiers: Tier[]; baseRate: number; onChange: (t: Tier[]) => void }) {
  const set = (i: number, patch: Partial<Tier>) => onChange(tiers.map((t, k) => (k === i ? { ...t, ...patch } : t)));
  const add = () => {
    const last = tiers[tiers.length - 1];
    onChange([...tiers, { minDays: last ? last.minDays + 7 : 7, percent: last ? Math.min(90, last.percent + 5) : 5 }]);
  };
  return (
    <div className="space-y-3">
      <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-2">
        <div className="flex items-center gap-2">
          <TrendingDown className="w-4 h-4 text-emerald-500" />
          <h3 className="text-sm font-bold text-slate-900 dark:text-white">Tarif dégressif</h3>
          <span className="text-[11px] font-semibold text-slate-400">({tiers.length} palier{tiers.length > 1 ? "s" : ""})</span>
        </div>
        <button
          type="button"
          onClick={add}
          className="self-start inline-flex items-center gap-1.5 px-3 py-1.5 rounded-xl bg-slate-100 dark:bg-slate-800 text-emerald-600 dark:text-emerald-400 font-bold text-xs border border-slate-200 dark:border-slate-700"
        >
          <Plus className="w-3.5 h-3.5" /> Ajouter un palier
        </button>
      </div>
      {tiers.length === 0 ? (
        <p className="text-xs text-slate-500">Aucune remise selon la durée : le prix par jour est le même quelle que soit la durée.</p>
      ) : (
        <div className="grid sm:grid-cols-2 lg:grid-cols-3 gap-2">
          {tiers.map((t, i) => (
            <div key={i} className="p-3 rounded-xl bg-slate-50 dark:bg-slate-900/60 border border-slate-200/80 dark:border-slate-800 space-y-2">
              <div className="grid grid-cols-[1fr_1fr_auto] gap-2 items-end">
                <label>
                  <span className="block text-[10px] font-bold uppercase tracking-wider text-slate-500 mb-1">Dès (jours)</span>
                  <NumberInput min={2} max={365} className={field} value={t.minDays} onValueChange={(n) => set(i, { minDays: n })} />
                </label>
                <label>
                  <span className="block text-[10px] font-bold uppercase tracking-wider text-slate-500 mb-1">Remise %</span>
                  <NumberInput min={0} max={90} step="0.5" decimal className={field} value={t.percent} onValueChange={(n) => set(i, { percent: n })} />
                </label>
                <button type="button" aria-label={`Supprimer le palier ${t.minDays} jours`} onClick={() => onChange(tiers.filter((_, k) => k !== i))} className="p-2 rounded-lg text-slate-400 hover:text-red-500 hover:bg-red-50 dark:hover:bg-red-500/10">
                  <Trash2 className="w-4 h-4" />
                </button>
              </div>
              <p className="text-[11px] text-slate-500">
                Dès {t.minDays} jours : {Math.max(1, Math.round(baseRate * (1 - (t.percent || 0) / 100)))} TND/jour au lieu de {baseRate} TND (s&apos;applique aussi aux tarifs de période).
              </p>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}
