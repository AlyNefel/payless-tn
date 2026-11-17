"use client";

import { useEffect, useState } from "react";
import { CalendarClock, Loader2, Plus, Save, Trash2, CheckCircle2, AlertTriangle } from "lucide-react";
import type { GlobalSeason } from "@/lib/seasonalPricing";

const input =
  "w-full h-10 px-3 rounded-xl border border-slate-200 dark:border-slate-700 bg-slate-50 dark:bg-slate-900 text-sm text-slate-900 dark:text-white";
const label = "block text-[11px] font-bold uppercase tracking-wider text-slate-500 dark:text-slate-400 mb-1";

const blank = (): GlobalSeason => {
  const y = new Date().getFullYear();
  return { id: `s${Date.now().toString(36)}`, name: "", startDate: `${y}-07-01`, endDate: `${y}-08-31`, recurring: true, adjustPercent: 0, minDays: 0, active: true };
};

/**
 * Fleet-wide pricing periods: one rule applies to EVERY car, live on the public site from the
 * date pickers onwards. A car with its own seasonal price for the same dates keeps its own price.
 */
export function GlobalSeasonsCard() {
  const [seasons, setSeasons] = useState<GlobalSeason[]>([]);
  const [savedJson, setSavedJson] = useState("[]");
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [msg, setMsg] = useState<{ ok: boolean; text: string } | null>(null);

  useEffect(() => {
    fetch("/api/admin/rental-rules", { cache: "no-store" })
      .then((r) => r.json())
      .then((d) => {
        if (d.success) {
          setSeasons(d.seasons || []);
          setSavedJson(JSON.stringify(d.seasons || []));
        }
      })
      .catch(() => {})
      .finally(() => setLoading(false));
  }, []);

  const dirty = JSON.stringify(seasons) !== savedJson;
  const patch = (i: number, p: Partial<GlobalSeason>) => setSeasons((list) => list.map((s, k) => (k === i ? { ...s, ...p } : s)));

  const save = async () => {
    setSaving(true);
    setMsg(null);
    try {
      const res = await fetch("/api/admin/rental-rules", {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ seasons }),
      });
      const d = await res.json().catch(() => ({}));
      if (!res.ok || !d.success) throw new Error(d.error || "Échec de l'enregistrement");
      setSeasons(d.seasons);
      setSavedJson(JSON.stringify(d.seasons));
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
          <span className="p-2.5 rounded-xl bg-amber-50 dark:bg-amber-500/10 text-amber-600">
            <CalendarClock className="w-5 h-5" />
          </span>
          <div>
            <h2 className="text-sm font-bold text-slate-900 dark:text-white">Périodes & saisons — toutes les voitures</h2>
            <p className="text-xs text-slate-500 mt-0.5 max-w-2xl">
              Chaque période ajuste le prix de base de toute la flotte (ex. +20 % en haute saison) et peut imposer une durée
              minimale. Le prix est celui de la période du jour de départ, pour toute la location. Une voiture qui a son propre
              tarif saisonnier sur ces dates garde le sien.
            </p>
          </div>
        </div>
        <div className="flex gap-2">
          <button
            type="button"
            onClick={() => setSeasons((l) => [...l, blank()])}
            className="inline-flex items-center gap-1.5 px-3 h-10 rounded-xl border border-slate-200 dark:border-slate-700 text-xs font-bold text-slate-700 dark:text-slate-200"
          >
            <Plus className="w-4 h-4" /> Ajouter une période
          </button>
          <button
            type="button"
            onClick={save}
            disabled={saving || !dirty}
            className="inline-flex items-center gap-1.5 px-4 h-10 rounded-xl bg-blue-600 hover:bg-blue-500 text-white text-xs font-bold disabled:opacity-50"
          >
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
      ) : seasons.length === 0 ? (
        <p className="text-xs text-slate-500 border border-dashed border-slate-200 dark:border-slate-700 rounded-xl p-4">
          Aucune période globale : chaque voiture utilise son prix de base (et ses tarifs saisonniers propres).
        </p>
      ) : (
        <div className="space-y-3">
          {seasons.map((s, i) => (
            <div key={s.id} className="rounded-xl border border-slate-200 dark:border-slate-800 p-3 grid grid-cols-2 lg:grid-cols-12 gap-3 items-end">
              <div className="col-span-2 lg:col-span-3">
                <label className={label} htmlFor={`gs-name-${s.id}`}>Nom</label>
                <input id={`gs-name-${s.id}`} className={input} value={s.name} placeholder="Haute saison été" onChange={(e) => patch(i, { name: e.target.value })} />
              </div>
              <div className="lg:col-span-2">
                <label className={label} htmlFor={`gs-start-${s.id}`}>Du</label>
                <input id={`gs-start-${s.id}`} type="date" className={input} value={s.startDate} onChange={(e) => patch(i, { startDate: e.target.value })} />
              </div>
              <div className="lg:col-span-2">
                <label className={label} htmlFor={`gs-end-${s.id}`}>Au (inclus)</label>
                <input id={`gs-end-${s.id}`} type="date" className={input} value={s.endDate} onChange={(e) => patch(i, { endDate: e.target.value })} />
              </div>
              <div className="lg:col-span-2">
                <label className={label} htmlFor={`gs-pct-${s.id}`}>Ajustement %</label>
                <input
                  id={`gs-pct-${s.id}`}
                  type="number"
                  min={-90}
                  max={300}
                  className={input}
                  value={String(s.adjustPercent)}
                  onChange={(e) => patch(i, { adjustPercent: Number(e.target.value) })}
                />
              </div>
              <div className="lg:col-span-1">
                <label className={label} htmlFor={`gs-min-${s.id}`}>Min. jours</label>
                <input
                  id={`gs-min-${s.id}`}
                  type="number"
                  min={0}
                  max={365}
                  className={input}
                  value={String(s.minDays || 0)}
                  onChange={(e) => patch(i, { minDays: Number(e.target.value) })}
                />
              </div>
              <div className="col-span-2 lg:col-span-2 flex items-center justify-between gap-2 h-10">
                <div className="flex flex-col gap-1 text-[11px] font-semibold text-slate-600 dark:text-slate-300">
                  <label className="inline-flex items-center gap-1.5">
                    <input type="checkbox" checked={s.recurring !== false && Boolean(s.recurring)} onChange={(e) => patch(i, { recurring: e.target.checked })} />
                    Chaque année
                  </label>
                  <label className="inline-flex items-center gap-1.5">
                    <input type="checkbox" checked={s.active !== false} onChange={(e) => patch(i, { active: e.target.checked })} />
                    Active
                  </label>
                </div>
                <button
                  type="button"
                  aria-label={`Supprimer la période ${s.name || i + 1}`}
                  onClick={() => setSeasons((l) => l.filter((_, k) => k !== i))}
                  className="p-2 rounded-lg text-red-600 hover:bg-red-50 dark:hover:bg-red-500/10"
                >
                  <Trash2 className="w-4 h-4" />
                </button>
              </div>
              <p className="col-span-2 lg:col-span-12 text-[11px] text-slate-500">
                Exemple : une voiture à 100 DT/jour passe à{" "}
                <strong className="text-slate-900 dark:text-white">{Math.max(1, Math.round(100 * (1 + (Number(s.adjustPercent) || 0) / 100)))} DT/jour</strong>
                {s.minDays ? ` · location de ${s.minDays} jours minimum` : ""}
                {s.active === false ? " · période désactivée" : ""}
              </p>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}
