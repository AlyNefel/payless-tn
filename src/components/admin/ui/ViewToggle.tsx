"use client";

import { LayoutGrid, List } from "lucide-react";
import type { ViewMode } from "./useViewMode";

/** Segmented control shared by every admin list (same place, same look everywhere). */
export function ViewToggle({ value, onChange, className = "" }: { value: ViewMode; onChange: (m: ViewMode) => void; className?: string }) {
  const btn = (m: ViewMode, label: string, Icon: typeof List) => (
    <button
      type="button"
      onClick={() => onChange(m)}
      aria-pressed={value === m}
      title={label}
      className={`inline-flex items-center gap-1.5 px-2.5 h-8 rounded-lg text-xs font-semibold transition-colors ${
        value === m
          ? "bg-white dark:bg-slate-800 text-blue-600 dark:text-blue-400 shadow-sm"
          : "text-slate-500 dark:text-slate-400 hover:text-slate-900 dark:hover:text-white"
      }`}
    >
      <Icon className="w-4 h-4" aria-hidden />
      <span className="hidden sm:inline">{label}</span>
    </button>
  );
  return (
    <div
      role="group"
      aria-label="Mode d'affichage"
      className={`inline-flex items-center gap-0.5 p-1 rounded-xl bg-slate-100 dark:bg-slate-900 border border-slate-200 dark:border-slate-800 ${className}`}
    >
      {btn("grid", "Cartes", LayoutGrid)}
      {btn("table", "Tableau", List)}
    </div>
  );
}
