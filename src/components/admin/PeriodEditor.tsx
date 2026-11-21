"use client";

import { NumberInput } from "@/components/admin/ui/NumberInput";
import { Trash2 } from "lucide-react";

export interface PricePeriod {
  name: string;
  /** "MM-DD" = every year, "YYYY-MM-DD" = these dates only. */
  startDate: string;
  endDate: string;
  dailyRate: number;
  discountPercent?: number;
  minDays?: number;
}

const MONTHS = ["Janvier", "Février", "Mars", "Avril", "Mai", "Juin", "Juillet", "Août", "Septembre", "Octobre", "Novembre", "Décembre"];
const DAYS_IN = [31, 29, 31, 30, 31, 30, 31, 31, 30, 31, 30, 31];
const field = "w-full px-2.5 py-1.5 rounded-xl bg-white dark:bg-slate-800 border border-slate-200 dark:border-slate-700 text-xs font-medium text-slate-900 dark:text-white focus:outline-none focus:ring-2 focus:ring-blue-500";
const label = "block text-[11px] font-bold uppercase tracking-wider text-slate-500 dark:text-slate-400 mb-1";

const isYearly = (p: PricePeriod) => p.startDate.length === 5;
const pad = (n: number) => String(n).padStart(2, "0");

function DayMonth({ value, onChange, aria }: { value: string; onChange: (v: string) => void; aria: string }) {
  const [m, d] = value.split("-").map(Number);
  return (
    <div className="grid grid-cols-[4.5rem_1fr] gap-1.5">
      <select aria-label={`${aria} — jour`} className={field} value={d} onChange={(e) => onChange(`${pad(m)}-${pad(Math.min(Number(e.target.value), DAYS_IN[m - 1]))}`)}>
        {Array.from({ length: DAYS_IN[m - 1] }, (_, i) => i + 1).map((n) => <option key={n} value={n}>{n}</option>)}
      </select>
      <select aria-label={`${aria} — mois`} className={field} value={m} onChange={(e) => onChange(`${pad(Number(e.target.value))}-${pad(Math.min(d, DAYS_IN[Number(e.target.value) - 1]))}`)}>
        {MONTHS.map((n, i) => <option key={n} value={i + 1}>{n}</option>)}
      </select>
    </div>
  );
}

/** Human summary of a period ("du 15 juillet au 31 août, chaque année"). */
export function describePeriod(p: PricePeriod): string {
  const fmt = (v: string) => {
    if (v.length === 5) {
      const [m, d] = v.split("-").map(Number);
      return `${d === 1 ? "1er" : d} ${MONTHS[m - 1].toLowerCase()}`;
    }
    return new Date(`${v}T12:00:00Z`).toLocaleDateString("fr-FR", { day: "numeric", month: "long", year: "numeric" });
  };
  return `du ${fmt(p.startDate)} au ${fmt(p.endDate)}${isYearly(p) ? ", chaque année" : ""}`;
}

/** One price period of a model: dates (yearly or fixed), price, discount and minimum duration. */
export function PeriodEditor({
  period,
  baseRate,
  baseMinDays,
  onChange,
  onRemove,
}: {
  period: PricePeriod;
  baseRate: number;
  baseMinDays: number;
  onChange: (p: PricePeriod) => void;
  onRemove: () => void;
}) {
  const yearly = isYearly(period);
  const effective = Math.round(period.dailyRate * (1 - (period.discountPercent || 0) / 100));
  const set = (patch: Partial<PricePeriod>) => onChange({ ...period, ...patch });
  const switchMode = (toYearly: boolean) => {
    const year = new Date().getFullYear();
    if (toYearly) set({ startDate: period.startDate.slice(5, 10), endDate: period.endDate.slice(5, 10) });
    else set({ startDate: `${year}-${period.startDate}`, endDate: `${period.endDate < period.startDate ? year + 1 : year}-${period.endDate}` });
  };
  const effMin = Math.max(baseMinDays, period.minDays || 0);
  return (
    <div className="p-4 rounded-2xl bg-slate-50 dark:bg-slate-900/60 border border-slate-200/80 dark:border-slate-800 space-y-3">
      <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-[1.2fr_1fr_1.4fr_1.4fr] gap-3">
        <label>
          <span className={label}>Nom</span>
          <input className={field} value={period.name} placeholder="Haute saison été" onChange={(e) => set({ name: e.target.value })} />
        </label>
        <label>
          <span className={label}>Répétition</span>
          <select className={field} value={yearly ? "yearly" : "fixed"} onChange={(e) => switchMode(e.target.value === "yearly")}>
            <option value="yearly">Chaque année</option>
            <option value="fixed">Dates précises (une fois)</option>
          </select>
        </label>
        <div>
          <span className={label}>Du</span>
          {yearly ? (
            <DayMonth aria="Début" value={period.startDate} onChange={(v) => set({ startDate: v })} />
          ) : (
            <input type="date" aria-label="Début" className={field} value={period.startDate} onChange={(e) => set({ startDate: e.target.value })} />
          )}
        </div>
        <div>
          <span className={label}>Au (inclus)</span>
          {yearly ? (
            <DayMonth aria="Fin" value={period.endDate} onChange={(v) => set({ endDate: v })} />
          ) : (
            <input type="date" aria-label="Fin" className={field} value={period.endDate} min={period.startDate} onChange={(e) => set({ endDate: e.target.value })} />
          )}
        </div>
      </div>
      <div className="grid grid-cols-2 sm:grid-cols-4 lg:grid-cols-[1fr_1fr_1fr_auto] gap-3 items-end">
        <label>
          <span className={label}>Tarif / jour (TND)</span>
          <NumberInput min={1} className={`${field} font-bold`} value={period.dailyRate} onValueChange={(n) => set({ dailyRate: n })} />
        </label>
        <label>
          <span className={label}>Remise %</span>
          <NumberInput min={0} max={90} decimal className={`${field} font-bold`} value={period.discountPercent || 0} onValueChange={(n) => set({ discountPercent: n })} />
        </label>
        <label>
          <span className={label}>Durée min. (jours)</span>
          <NumberInput min={0} max={365} className={`${field} font-bold`} value={period.minDays || 0} onValueChange={(n) => set({ minDays: n })} />
        </label>
        <div className="flex items-center justify-between gap-2 col-span-2 sm:col-span-1">
          <div className="px-3 py-1.5 rounded-xl bg-amber-50 dark:bg-amber-950/40 border border-amber-200 dark:border-amber-900/50 text-right">
            <span className="text-[10px] font-bold uppercase text-amber-700 dark:text-amber-400 block">Tarif effectif</span>
            <span className="text-sm font-black text-amber-600 dark:text-amber-300">{effective} TND</span>
          </div>
          <button type="button" onClick={onRemove} aria-label={`Supprimer la période ${period.name}`} className="p-2 rounded-xl text-slate-400 hover:text-red-500 hover:bg-red-50 dark:hover:bg-red-500/10">
            <Trash2 className="w-4 h-4" />
          </button>
        </div>
      </div>
      <p className="text-[11px] text-slate-500">
        {describePeriod(period)} · {effective} TND/jour au lieu de {baseRate} TND · location de {effMin} jour{effMin > 1 ? "s" : ""} minimum pour un départ dans cette période
        {(period.minDays || 0) > 0 && (period.minDays || 0) <= baseMinDays ? ` (le minimum du modèle, ${baseMinDays} j, est déjà plus élevé)` : ""}.
      </p>
    </div>
  );
}
