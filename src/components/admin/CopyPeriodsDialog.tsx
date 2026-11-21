"use client";

import { useMemo, useState } from "react";
import { Copy, Loader2 } from "lucide-react";
import { btn } from "@/components/admin/ui";
import { ErrorNote, Modal, labelCls } from "@/components/admin/accounting/shared";
import { describePeriod, type PricePeriod } from "./PeriodEditor";

interface Model {
  _id: string;
  brand: string;
  model: string;
  category: string;
  categoryId?: string;
  minRentalDays?: number;
  pricing: { daily: number; seasonalPrices: PricePeriod[]; durationDiscounts?: { minDays: number; percent: number }[] };
}

/**
 * Copies one model's periods (and optionally its minimum duration) to other models. The prices
 * follow each model's own standard rate by default (same % up or down), never one price for all.
 */
export function CopyPeriodsDialog({ source, vehicles, onClose, onDone }: { source: Model; vehicles: Model[]; onClose: () => void; onDone: (n: number) => void }) {
  const others = vehicles.filter((v) => v._id !== source._id);
  const sameCategory = useMemo(() => others.filter((v) => (source.categoryId ? v.categoryId === source.categoryId : v.category === source.category)).map((v) => v._id), [others, source]);
  const [selected, setSelected] = useState<Set<string>>(() => new Set(sameCategory));
  const [priceMode, setPriceMode] = useState<"percent" | "same">("percent");
  const [withMin, setWithMin] = useState(true);
  const [withTiers, setWithTiers] = useState(true);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const toggle = (id: string) => setSelected((s) => {
    const n = new Set(s);
    if (n.has(id)) n.delete(id);
    else n.add(id);
    return n;
  });
  const periods = source.pricing.seasonalPrices || [];
  const preview = (target: Model, p: PricePeriod) =>
    priceMode === "same" || !source.pricing.daily ? p.dailyRate : Math.max(1, Math.round((p.dailyRate / source.pricing.daily) * target.pricing.daily));

  const run = async () => {
    if (!selected.size) return setError("Choisissez au moins un modèle.");
    setBusy(true);
    setError("");
    try {
      const res = await fetch("/api/admin/vehicles/pricing", {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ action: "copy", vehicleId: source._id, targetIds: [...selected], priceMode, includeMinRentalDays: withMin, includeDurationDiscounts: withTiers }),
      });
      const d = await res.json().catch(() => ({}));
      if (!res.ok || !d.success) throw new Error(d.error || "Copie impossible");
      onDone(d.updated);
    } catch (e) {
      setError(e instanceof Error ? e.message : "Erreur");
    } finally {
      setBusy(false);
    }
  };

  const first = others.find((v) => selected.has(v._id));
  return (
    <Modal
      open
      wide
      onClose={onClose}
      title={`Copier les tarifs de ${source.brand} ${source.model}`}
      footer={
        <>
          <button type="button" onClick={onClose} className={`${btn.base} ${btn.secondary}`}>Annuler</button>
          <button type="button" onClick={run} disabled={busy} className={`${btn.base} ${btn.primary}`}>
            {busy ? <Loader2 className="w-4 h-4 animate-spin" /> : <Copy className="w-4 h-4" />} Copier vers {selected.size} modèle(s)
          </button>
        </>
      }
    >
      {!periods.length && <p className="font-semibold text-amber-600">Ce modèle n&apos;a aucune période : les modèles choisis n&apos;en auront plus (le tarif dégressif et la durée minimale restent copiables).</p>}
      <ul className="space-y-1 text-slate-600 dark:text-slate-300">
        {periods.map((p, i) => (
          <li key={i}>• <b>{p.name}</b> {describePeriod(p)} — {p.dailyRate} TND/j{p.minDays ? `, ${p.minDays} j min.` : ""}</li>
        ))}
      </ul>
      <p className="p-2.5 rounded-xl bg-amber-50 dark:bg-amber-950/30 text-amber-900 dark:text-amber-200 font-semibold">
        Les périodes des modèles choisis sont remplacées par celles-ci.
      </p>
      <fieldset>
        <span className={labelCls}>Prix des périodes copiées</span>
        <div className="grid sm:grid-cols-2 gap-2">
          {(
            [
              ["percent", "Même écart en %", "Chaque modèle garde son niveau de prix (ex. +20 % sur son tarif standard)."],
              ["same", "Même prix en TND", "Tous les modèles choisis ont exactement le même tarif."],
            ] as const
          ).map(([k, t, d]) => (
            <label key={k} className={`p-2.5 rounded-xl border cursor-pointer ${priceMode === k ? "border-blue-500 bg-blue-50 dark:bg-blue-500/10" : "border-slate-200 dark:border-slate-700"}`}>
              <span className="flex items-center gap-2 font-bold text-slate-900 dark:text-white">
                <input type="radio" checked={priceMode === k} onChange={() => setPriceMode(k)} /> {t}
              </span>
              <span className="block mt-0.5 text-[11px] text-slate-500">{d}</span>
            </label>
          ))}
        </div>
        {first && periods[0] && (
          <p className="mt-1 text-[11px] text-slate-500">
            Exemple : {first.brand} {first.model} ({first.pricing.daily} TND standard) → « {periods[0].name} » à {preview(first, periods[0])} TND/j.
          </p>
        )}
      </fieldset>
      <label className="flex items-center gap-2 font-semibold text-slate-700 dark:text-slate-200">
        <input type="checkbox" checked={withMin} onChange={(e) => setWithMin(e.target.checked)} /> Copier aussi la durée minimale du modèle ({source.minRentalDays || 1} j)
      </label>
      <label className="flex items-center gap-2 font-semibold text-slate-700 dark:text-slate-200">
        <input type="checkbox" checked={withTiers} onChange={(e) => setWithTiers(e.target.checked)} /> Copier aussi le tarif dégressif
        ({(source.pricing.durationDiscounts || []).map((t) => `${t.minDays} j : −${t.percent} %`).join(", ") || "aucun palier"})
      </label>
      <div>
        <div className="flex flex-wrap items-center justify-between gap-2">
          <span className={labelCls}>Modèles</span>
          <div className="flex gap-2">
            <button type="button" className="text-[11px] font-bold text-blue-600" onClick={() => setSelected(new Set(sameCategory))}>Même catégorie ({sameCategory.length})</button>
            <button type="button" className="text-[11px] font-bold text-blue-600" onClick={() => setSelected(new Set(others.map((v) => v._id)))}>Tous</button>
            <button type="button" className="text-[11px] font-bold text-slate-500" onClick={() => setSelected(new Set())}>Aucun</button>
          </div>
        </div>
        <div className="grid sm:grid-cols-2 gap-1.5 max-h-64 overflow-y-auto">
          {others.map((v) => (
            <label key={v._id} className="flex items-center gap-2 p-2 rounded-lg border border-slate-200 dark:border-slate-700">
              <input type="checkbox" checked={selected.has(v._id)} onChange={() => toggle(v._id)} />
              <span className="min-w-0 truncate"><b>{v.brand} {v.model}</b> <span className="text-slate-500">· {v.category} · {v.pricing.daily} TND</span></span>
            </label>
          ))}
        </div>
      </div>
      <ErrorNote text={error} />
    </Modal>
  );
}
