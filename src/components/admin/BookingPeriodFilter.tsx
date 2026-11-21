"use client";

import { CalendarRange, X } from "lucide-react";

export type DateField = "pickup" | "return" | "overlap" | "created";
export interface BookingPeriod {
  preset: string;
  from: string;
  to: string;
  field: DateField;
}

const iso = (d: Date) => `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;

/** Monday-based weeks, local dates. */
export function presetRange(key: string): { from: string; to: string } {
  const now = new Date();
  const y = now.getFullYear();
  const m = now.getMonth();
  const day = (offset: number) => {
    const d = new Date(now);
    d.setDate(d.getDate() + offset);
    return d;
  };
  const monday = (weeks: number) => {
    const d = new Date(now);
    d.setDate(d.getDate() - ((d.getDay() + 6) % 7) + weeks * 7);
    return d;
  };
  switch (key) {
    case "today":
      return { from: iso(now), to: iso(now) };
    case "tomorrow":
      return { from: iso(day(1)), to: iso(day(1)) };
    case "week": {
      const s = monday(0);
      const e = new Date(s);
      e.setDate(s.getDate() + 6);
      return { from: iso(s), to: iso(e) };
    }
    case "next_week": {
      const s = monday(1);
      const e = new Date(s);
      e.setDate(s.getDate() + 6);
      return { from: iso(s), to: iso(e) };
    }
    case "month":
      return { from: iso(new Date(y, m, 1)), to: iso(new Date(y, m + 1, 0)) };
    case "next_month":
      return { from: iso(new Date(y, m + 1, 1)), to: iso(new Date(y, m + 2, 0)) };
    case "last_month":
      return { from: iso(new Date(y, m - 1, 1)), to: iso(new Date(y, m, 0)) };
    default:
      return { from: "", to: "" };
  }
}

const PRESETS: [string, string][] = [
  ["all", "Toutes dates"],
  ["today", "Aujourd'hui"],
  ["tomorrow", "Demain"],
  ["week", "Cette semaine"],
  ["next_week", "Semaine prochaine"],
  ["month", "Ce mois"],
  ["next_month", "Mois prochain"],
  ["last_month", "Mois dernier"],
  ["custom", "Période…"],
];
const FIELDS: [DateField, string][] = [
  ["pickup", "Départ"],
  ["return", "Retour"],
  ["overlap", "En location pendant"],
  ["created", "Créée le"],
];
const input = "h-9 px-2.5 rounded-xl border border-slate-300 dark:border-slate-700 bg-slate-50 dark:bg-slate-900 text-xs text-slate-900 dark:text-white";

/** "This week / this month / period" filter for the reservations list, with the date it applies to. */
export function BookingPeriodFilter({ value, onChange }: { value: BookingPeriod; onChange: (v: BookingPeriod) => void }) {
  const pick = (preset: string) => {
    if (preset === "custom") return onChange({ ...value, preset, from: value.from || presetRange("month").from, to: value.to || presetRange("month").to });
    onChange({ ...value, preset, ...presetRange(preset) });
  };
  return (
    <div className="space-y-2">
      <div className="flex items-center gap-1.5 overflow-x-auto -mx-1 px-1 pb-0.5" role="group" aria-label="Période">
        <CalendarRange className="w-4 h-4 text-slate-400 shrink-0" />
        {PRESETS.map(([k, l]) => (
          <button
            key={k}
            type="button"
            aria-pressed={value.preset === k}
            onClick={() => pick(k)}
            className={`shrink-0 px-3 h-8 rounded-xl text-xs font-semibold ${
              value.preset === k ? "bg-slate-900 text-white dark:bg-white dark:text-slate-900" : "bg-slate-100 text-slate-700 dark:bg-slate-900/60 dark:text-slate-300 hover:bg-slate-200 dark:hover:bg-slate-800"
            }`}
          >
            {l}
          </button>
        ))}
      </div>
      {value.preset !== "all" && (
        <div className="flex flex-wrap items-center gap-2 text-xs text-slate-600 dark:text-slate-300">
          <label className="flex items-center gap-1.5">
            <span className="font-semibold">Date :</span>
            <select aria-label="Date filtrée" className={input} value={value.field} onChange={(e) => onChange({ ...value, field: e.target.value as DateField })}>
              {FIELDS.map(([k, l]) => <option key={k} value={k}>{l}</option>)}
            </select>
          </label>
          <input type="date" aria-label="Du" className={input} value={value.from} max={value.to || undefined} onChange={(e) => onChange({ ...value, preset: "custom", from: e.target.value })} />
          <span>→</span>
          <input type="date" aria-label="Au" className={input} value={value.to} min={value.from || undefined} onChange={(e) => onChange({ ...value, preset: "custom", to: e.target.value })} />
          <button type="button" onClick={() => onChange({ preset: "all", from: "", to: "", field: value.field })} className="inline-flex items-center gap-1 px-2 h-8 rounded-lg text-slate-500 hover:bg-slate-100 dark:hover:bg-slate-800">
            <X className="w-3.5 h-3.5" /> Effacer
          </button>
        </div>
      )}
    </div>
  );
}
