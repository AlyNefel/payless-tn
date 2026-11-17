"use client";

import { useEffect, useState } from "react";
import { AlertTriangle, CheckCircle2, Loader2, Plus, Save, Trash2, TrendingDown } from "lucide-react";
import type { DurationDiscount } from "@/lib/seasonalPricing";

const input = "w-full h-10 px-3 rounded-xl border border-slate-200 dark:border-slate-700 bg-slate-50 dark:bg-slate-900 text-sm text-slate-900 dark:text-white";
const label = "block text-[11px] font-bold uppercase tracking-wider text-slate-500 dark:text-slate-400 mb-1";

/** Fleet-wide degressive tariff: the longer the rental, the lower the daily rate. Live on the site. */
export function DurationDiscountsCard() {
  const [tiers, setTiers] = useState<DurationDiscount[]>([]);
  const [saved, setSaved] = useState("[]");
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [msg, setMsg] = useState<{ ok: boolean; text: string } | null>(null);

  useEffect(() => {
    fetch("/api/admin/rental-rules", { cache: "no-store" })
      .then((r) => r.json())
      .then((d) => {
        if (d.success) {
          setTiers(d.durationDiscounts || []);
          setSaved(JSON.stringify(d.durationDiscounts || []));
        }
      })
      .catch(() => {})
      .finally(() => setLoading(false));
  }, []);

  const dirty = JSON.stringify(tiers) !== saved;
  const patch = (i: number, p: Partial<DurationDiscount>) => setTiers((l) => l.map((t, k) => (k === i ? { ...t, ...p } : t)));
  const save = async () => {
    setSaving(true);
    setMsg(null);
    try {
      const res = await fetch("/api/admin/rental-rules", { method: "PUT", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ durationDiscounts: tiers }) });
      const d = await res.json().catch(() => ({}));
      if (!res.ok || !d.success) throw new Error(d.error || "Échec de l'enregistrement");
      setTiers(d.durationDiscounts);
      setSaved(JSON.stringify(d.durationDiscounts));
      setMsg({ ok: true, text: "Enregistré — appliqué immédiatement à toutes les voitures sur le site" });
    } catch (e) {
      setMsg({ ok: false, text: e instanceof Error ? e.message : "Erreur" });
    } finally {
      setSaving(false);
    }
  };

  return (
    <div className="p-5 rounded-2xl bg-white dark:bg-[#0f141f] border border-slate-200 dark:border-slate-800 space-y-4">
      <div className="flex flex-col sm:flex-row sm:items-start gap-3">
        <div className="flex items-start gap-3 flex-1">
          <span className="p-2.5 rounded-xl bg-emerald-50 dark:bg-emerald-500/10 text-emerald-600">
            <TrendingDown className="w-5 h-5" />
          </span>
          <div>
            <h2 className="text-sm font-bold text-slate-900 dark:text-white">Tarifs dégressifs — toutes les voitures</h2>
            <p className="text-xs text-slate-500 mt-0.5 max-w-2xl">
              À partir d&apos;un nombre de jours, le prix par jour baisse pour toute la location. La remise s&apos;applique après le tarif de la période et s&apos;affiche dès le choix des dates.
            </p>
          </div>
        </div>
        <div className="flex gap-2">
          <button type="button" onClick={() => setTiers((l) => [...l, { minDays: l.length ? l[l.length - 1].minDays + 7 : 7, percent: l.length ? l[l.length - 1].percent + 5 : 5 }])} className="inline-flex items-center gap-1.5 px-3 h-10 rounded-xl border border-slate-200 dark:border-slate-700 text-xs font-bold text-slate-700 dark:text-slate-200">
            <Plus className="w-4 h-4" /> Ajouter un palier
          </button>
          <button type="button" onClick={save} disabled={saving || !dirty} className="inline-flex items-center gap-1.5 px-4 h-10 rounded-xl bg-blue-600 hover:bg-blue-500 text-white text-xs font-bold disabled:opacity-50">
            {saving ? <Loader2 className="w-4 h-4 animate-spin" /> : <Save className="w-4 h-4" />} Enregistrer
          </button>
        </div>
      </div>
      {msg && (
        <p className={`text-xs font-semibold ${msg.ok ? "text-emerald-600" : "text-red-600"}`} role="status">
          {msg.ok ? <CheckCircle2 className="inline w-3.5 h-3.5 mr-1" /> : <AlertTriangle className="inline w-3.5 h-3.5 mr-1" />}
          {msg.text}
        </p>
      )}
      {dirty && !msg && <p className="text-xs font-semibold text-amber-600">Modifications non enregistrées.</p>}
      {loading ? (
        <Loader2 className="w-5 h-5 animate-spin text-slate-400" />
      ) : tiers.length === 0 ? (
        <p className="text-xs text-slate-500 border border-dashed border-slate-200 dark:border-slate-700 rounded-xl p-4">Aucun palier : le prix par jour ne dépend pas de la durée.</p>
      ) : (
        <div className="grid sm:grid-cols-2 lg:grid-cols-3 gap-3">
          {tiers.map((t, i) => (
            <div key={i} className="rounded-xl border border-slate-200 dark:border-slate-800 p-3 space-y-2">
              <div className="grid grid-cols-[1fr_1fr_auto] gap-2 items-end">
                <label>
                  <span className={label}>À partir de (jours)</span>
                  <input type="number" min={2} max={365} className={input} value={String(t.minDays)} onChange={(e) => patch(i, { minDays: Number(e.target.value) })} />
                </label>
                <label>
                  <span className={label}>Remise %</span>
                  <input type="number" min={0} max={90} step="0.5" className={input} value={String(t.percent)} onChange={(e) => patch(i, { percent: Number(e.target.value) })} />
                </label>
                <button type="button" aria-label={`Supprimer le palier ${t.minDays} jours`} onClick={() => setTiers((l) => l.filter((_, k) => k !== i))} className="h-10 px-2.5 rounded-lg text-red-600 hover:bg-red-50 dark:hover:bg-red-500/10">
                  <Trash2 className="w-4 h-4" />
                </button>
              </div>
              <p className="text-[11px] text-slate-500">
                Exemple : 100 DT/jour devient <strong className="text-slate-900 dark:text-white">{Math.max(1, Math.round(100 * (1 - (Number(t.percent) || 0) / 100)))} DT/jour</strong> dès {t.minDays} jours.
              </p>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}
