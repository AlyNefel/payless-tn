"use client";

import { useEffect, type ReactNode } from "react";
import { X } from "lucide-react";

/**
 * Read-only "View" panel: a right-hand drawer on desktop, a bottom sheet on phones.
 * The footer usually carries the "Voir & modifier" button.
 */
export function QuickView({
  open,
  onClose,
  title,
  subtitle,
  badge,
  children,
  footer,
}: {
  open: boolean;
  onClose: () => void;
  title: ReactNode;
  subtitle?: ReactNode;
  badge?: ReactNode;
  children: ReactNode;
  footer?: ReactNode;
}) {
  useEffect(() => {
    if (!open) return;
    const onKey = (e: KeyboardEvent) => e.key === "Escape" && onClose();
    document.addEventListener("keydown", onKey);
    const prev = document.body.style.overflow;
    document.body.style.overflow = "hidden";
    return () => {
      document.removeEventListener("keydown", onKey);
      document.body.style.overflow = prev;
    };
  }, [open, onClose]);

  if (!open) return null;
  return (
    <div className="fixed inset-0 z-[70] flex items-end sm:items-stretch sm:justify-end" role="dialog" aria-modal="true">
      <button type="button" aria-label="Fermer" onClick={onClose} className="absolute inset-0 bg-black/50 backdrop-blur-[2px] animate-in fade-in" />
      <div className="relative w-full sm:w-[440px] max-h-[92vh] sm:max-h-none sm:h-full flex flex-col bg-white dark:bg-[#0b0f17] border-t sm:border-t-0 sm:border-l border-slate-200 dark:border-slate-800 rounded-t-2xl sm:rounded-none shadow-2xl animate-in slide-in-from-bottom-4 sm:slide-in-from-right-4 duration-200">
        <div className="flex items-start justify-between gap-3 p-5 border-b border-slate-100 dark:border-slate-800">
          <div className="min-w-0">
            <div className="flex flex-wrap items-center gap-2">
              <h2 className="text-base font-bold text-slate-900 dark:text-white truncate">{title}</h2>
              {badge}
            </div>
            {subtitle && <p className="text-xs text-slate-500 mt-0.5">{subtitle}</p>}
          </div>
          <button type="button" onClick={onClose} aria-label="Fermer" className="p-1.5 rounded-lg text-slate-400 hover:bg-slate-100 dark:hover:bg-slate-800">
            <X className="w-5 h-5" />
          </button>
        </div>
        <div className="flex-1 overflow-y-auto p-5 space-y-4 text-xs">{children}</div>
        {footer && <div className="p-4 border-t border-slate-100 dark:border-slate-800 flex flex-wrap justify-end gap-2">{footer}</div>}
      </div>
    </div>
  );
}

/** Label / value row used inside QuickView panels. */
export function Field({ label, children }: { label: string; children: ReactNode }) {
  return (
    <div className="flex items-start justify-between gap-4 py-1.5">
      <span className="text-slate-500 shrink-0">{label}</span>
      <span className="font-semibold text-slate-900 dark:text-white text-right min-w-0 break-words">{children}</span>
    </div>
  );
}

export function Section({ title, children }: { title: string; children: ReactNode }) {
  return (
    <section className="p-3.5 rounded-xl bg-slate-50 dark:bg-slate-900/60 border border-slate-100 dark:border-slate-800">
      <h3 className="text-[11px] font-bold uppercase tracking-wider text-slate-400 mb-1.5">{title}</h3>
      {children}
    </section>
  );
}

/** Shared button styles (one source of truth for admin buttons). */
export const btn = {
  base: "inline-flex items-center justify-center gap-1.5 px-3.5 h-9 rounded-xl text-xs font-bold transition-colors disabled:opacity-50",
  primary: "bg-blue-600 hover:bg-blue-500 text-white shadow-sm",
  secondary: "border border-slate-200 dark:border-slate-700 text-slate-700 dark:text-slate-200 hover:bg-slate-100 dark:hover:bg-slate-800",
  danger: "bg-red-600 hover:bg-red-500 text-white",
  success: "bg-emerald-600 hover:bg-emerald-500 text-white",
};
