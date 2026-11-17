"use client";

import { useEffect, useState, type ReactNode } from "react";
import { FileText, Loader2, Trash2, Upload, X } from "lucide-react";
import { btn } from "@/components/admin/ui";

export const inputCls =
  "w-full h-10 px-3 rounded-xl border border-slate-200 dark:border-slate-700 bg-white dark:bg-slate-900 text-sm text-slate-900 dark:text-white disabled:opacity-60";
export const labelCls = "block text-[11px] font-bold uppercase tracking-wider text-slate-500 dark:text-slate-400 mb-1";
export const cardCls = "rounded-2xl bg-white dark:bg-[#0f141f] border border-slate-200 dark:border-slate-800";
export const thCls = "p-3 text-left text-[11px] font-bold uppercase tracking-wider text-slate-500 whitespace-nowrap";
export const tdCls = "p-3 text-xs text-slate-700 dark:text-slate-200 align-middle";

export const iso = (d: Date) => `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
export const frDay = (d?: string | Date | null) => (d ? new Date(d).toLocaleDateString("fr-FR") : "—");
export const frDateTime = (d?: string | Date | null) => (d ? new Date(d).toLocaleString("fr-FR", { dateStyle: "short", timeStyle: "short" }) : "—");

export interface Period {
  from: string;
  to: string;
}

export function presetPeriod(key: string): Period {
  const now = new Date();
  const y = now.getFullYear();
  const m = now.getMonth();
  switch (key) {
    case "today":
      return { from: iso(now), to: iso(now) };
    case "last_month":
      return { from: iso(new Date(y, m - 1, 1)), to: iso(new Date(y, m, 0)) };
    case "quarter": {
      const q = Math.floor(m / 3) * 3;
      return { from: iso(new Date(y, q, 1)), to: iso(new Date(y, q + 3, 0)) };
    }
    case "year":
      return { from: iso(new Date(y, 0, 1)), to: iso(new Date(y, 11, 31)) };
    default:
      return { from: iso(new Date(y, m, 1)), to: iso(new Date(y, m + 1, 0)) };
  }
}

const PRESETS: [string, string][] = [
  ["today", "Aujourd'hui"],
  ["month", "Ce mois"],
  ["last_month", "Mois dernier"],
  ["quarter", "Trimestre"],
  ["year", "Année"],
];

/** Period selector shared by every accounting tab. */
export function PeriodBar({ period, onChange, children }: { period: Period; onChange: (p: Period) => void; children?: ReactNode }) {
  const active = PRESETS.find(([k]) => {
    const p = presetPeriod(k);
    return p.from === period.from && p.to === period.to;
  })?.[0];
  return (
    <div className={`${cardCls} p-3 flex flex-col lg:flex-row lg:items-center gap-3`}>
      <div className="flex gap-1.5 overflow-x-auto -mx-1 px-1 pb-0.5">
        {PRESETS.map(([k, l]) => (
          <button
            key={k}
            type="button"
            onClick={() => onChange(presetPeriod(k))}
            className={`shrink-0 px-3 h-9 rounded-xl text-xs font-bold ${active === k ? "bg-blue-600 text-white" : "border border-slate-200 dark:border-slate-700 text-slate-600 dark:text-slate-300"}`}
          >
            {l}
          </button>
        ))}
      </div>
      <div className="flex items-center gap-2 text-xs text-slate-500">
        <input type="date" aria-label="Du" className={`${inputCls} h-9 w-auto`} value={period.from} max={period.to} onChange={(e) => e.target.value && onChange({ ...period, from: e.target.value })} />
        <span>→</span>
        <input type="date" aria-label="Au" className={`${inputCls} h-9 w-auto`} value={period.to} min={period.from} onChange={(e) => e.target.value && onChange({ ...period, to: e.target.value })} />
      </div>
      {children && <div className="flex flex-wrap items-center gap-2 lg:ml-auto">{children}</div>}
    </div>
  );
}

export function Kpi({ label, value, hint, tone = "slate" }: { label: string; value: ReactNode; hint?: ReactNode; tone?: "slate" | "emerald" | "red" | "blue" | "amber" }) {
  const tones = { slate: "text-slate-900 dark:text-white", emerald: "text-emerald-600", red: "text-red-600", blue: "text-blue-600", amber: "text-amber-600" };
  return (
    <div className={`${cardCls} p-4 min-w-0`}>
      <div className="text-[11px] font-bold uppercase tracking-wider text-slate-500 truncate">{label}</div>
      <div className={`mt-1 text-lg sm:text-xl font-black tabular-nums truncate ${tones[tone]}`}>{value}</div>
      {hint && <div className="mt-0.5 text-[11px] text-slate-500 truncate">{hint}</div>}
    </div>
  );
}

/** Centered modal (bottom sheet on phones). */
export function Modal({ open, title, onClose, children, footer, wide }: { open: boolean; title: ReactNode; onClose: () => void; children: ReactNode; footer?: ReactNode; wide?: boolean }) {
  useEffect(() => {
    if (!open) return;
    const onKey = (e: KeyboardEvent) => e.key === "Escape" && onClose();
    document.addEventListener("keydown", onKey);
    return () => document.removeEventListener("keydown", onKey);
  }, [open, onClose]);
  if (!open) return null;
  return (
    <div className="fixed inset-0 z-[80] flex items-end sm:items-center justify-center" role="dialog" aria-modal="true">
      <button type="button" aria-label="Fermer" onClick={onClose} className="absolute inset-0 bg-black/60" />
      <div className={`relative w-full ${wide ? "sm:max-w-3xl" : "sm:max-w-lg"} max-h-[92vh] flex flex-col bg-white dark:bg-[#0b0f17] border border-slate-200 dark:border-slate-800 rounded-t-2xl sm:rounded-2xl shadow-2xl`}>
        <div className="flex items-center justify-between gap-3 p-4 border-b border-slate-100 dark:border-slate-800">
          <h2 className="text-sm font-bold text-slate-900 dark:text-white">{title}</h2>
          <button type="button" onClick={onClose} aria-label="Fermer" className="p-1.5 rounded-lg text-slate-400 hover:bg-slate-100 dark:hover:bg-slate-800">
            <X className="w-5 h-5" />
          </button>
        </div>
        <div className="flex-1 overflow-y-auto p-4 space-y-3 text-xs">{children}</div>
        {footer && <div className="p-4 border-t border-slate-100 dark:border-slate-800 flex flex-wrap justify-end gap-2">{footer}</div>}
      </div>
    </div>
  );
}

export function ErrorNote({ text }: { text?: string | null }) {
  if (!text) return null;
  return (
    <p role="alert" className="p-2.5 rounded-xl bg-red-50 dark:bg-red-950/40 border border-red-200 dark:border-red-900/50 text-red-700 dark:text-red-300 text-xs font-semibold">
      {text}
    </p>
  );
}

export function Empty({ children }: { children: ReactNode }) {
  return <div className="p-8 text-center text-xs text-slate-500 border border-dashed border-slate-200 dark:border-slate-700 rounded-2xl">{children}</div>;
}

/** Uploads a private document (photo or PDF) and returns its internal URL. */
export async function uploadDocument(file: File, purpose: "expense" | "inspection" | "signature" | "insurance"): Promise<string> {
  const fd = new FormData();
  fd.append("file", file);
  fd.append("purpose", purpose);
  const res = await fetch("/api/admin/documents", { method: "POST", body: fd });
  const d = await res.json().catch(() => ({}));
  if (!res.ok || !d.url) throw new Error(d.error || "Téléversement impossible (PDF, JPG, PNG ou WebP — 8 Mo max)");
  return d.url as string;
}

/** Shrinks a phone photo before upload (long side 1600 px, JPEG) — a 6 MB photo becomes ~300 KB. */
export async function shrinkImage(file: File, max = 1600): Promise<File> {
  if (!file.type.startsWith("image/") || file.size < 400_000) return file;
  try {
    const bitmap = await createImageBitmap(file);
    const scale = Math.min(1, max / Math.max(bitmap.width, bitmap.height));
    const canvas = document.createElement("canvas");
    canvas.width = Math.round(bitmap.width * scale);
    canvas.height = Math.round(bitmap.height * scale);
    canvas.getContext("2d")?.drawImage(bitmap, 0, 0, canvas.width, canvas.height);
    const blob = await new Promise<Blob | null>((r) => canvas.toBlob(r, "image/jpeg", 0.82));
    return blob ? new File([blob], file.name.replace(/\.\w+$/, "") + ".jpg", { type: "image/jpeg" }) : file;
  } catch {
    return file;
  }
}

/** Receipt / document field: upload a photo or PDF, preview link, remove. */
export function DocumentField({ value, onChange, purpose, label = "Justificatif (photo ou PDF)" }: { value: string; onChange: (url: string) => void; purpose: "expense" | "inspection"; label?: string }) {
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const pick = async (file: File) => {
    setBusy(true);
    setError("");
    try {
      onChange(await uploadDocument(await shrinkImage(file), purpose));
    } catch (e) {
      setError(e instanceof Error ? e.message : "Téléversement impossible");
    } finally {
      setBusy(false);
    }
  };
  return (
    <div>
      <span className={labelCls}>{label}</span>
      <div className="flex flex-wrap items-center gap-2">
        <label className={`${btn.base} ${btn.secondary} h-10 cursor-pointer`}>
          {busy ? <Loader2 className="w-4 h-4 animate-spin" /> : <Upload className="w-4 h-4" />} {value ? "Remplacer" : "Ajouter"}
          <input type="file" accept="application/pdf,image/jpeg,image/png,image/webp" capture="environment" className="hidden" onChange={(e) => e.target.files?.[0] && pick(e.target.files[0])} />
        </label>
        {value && (
          <>
            <a href={value} target="_blank" rel="noopener noreferrer" className={`${btn.base} ${btn.secondary} h-10`}>
              <FileText className="w-4 h-4" /> Voir
            </a>
            <button type="button" aria-label="Retirer le justificatif" onClick={() => onChange("")} className={`${btn.base} ${btn.secondary} h-10 px-2.5`}>
              <Trash2 className="w-4 h-4" />
            </button>
          </>
        )}
      </div>
      {error && <p className="mt-1 text-[11px] font-semibold text-red-600">{error}</p>}
    </div>
  );
}

export async function api<T = Record<string, unknown>>(url: string, init?: RequestInit): Promise<T> {
  const res = await fetch(url, { cache: "no-store", ...init, headers: init?.body && !(init.body instanceof FormData) ? { "Content-Type": "application/json" } : undefined });
  const d = await res.json().catch(() => ({}));
  if (!res.ok || d.success === false) throw new Error(d.error || `Erreur ${res.status}`);
  return d as T;
}
