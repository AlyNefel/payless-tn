"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import { ShieldCheck, Plus, Search, Loader2, X, Paperclip, Upload, AlertTriangle, CheckCircle2, RefreshCw, Trash2 } from "lucide-react";
import { ActionMenu, QuickView, Field, Section, ViewToggle, btn, standardActions, useViewMode, usePermissions } from "./ui";

interface Policy {
  _id: string;
  vehicleId: string;
  unitId: string;
  car: string;
  company: string;
  policyNumber: string;
  startDate: string;
  endDate: string;
  costTND: number;
  attachmentUrl: string;
  notes: string;
  daysLeft: number;
  status: "active" | "expiring" | "expired" | "upcoming" | "renewed" | "cancelled";
}
interface CarOpt {
  vehicleId: string;
  unitId: string;
  label: string;
}
interface Stats {
  active: number;
  expiring: number;
  expired: number;
  uninsured: number;
}

const STATUS: Record<Policy["status"], { label: string; cls: string }> = {
  active: { label: "Active", cls: "bg-emerald-100 text-emerald-800 dark:bg-emerald-500/15 dark:text-emerald-300" },
  expiring: { label: "Expire bientôt", cls: "bg-amber-100 text-amber-800 dark:bg-amber-500/15 dark:text-amber-300" },
  expired: { label: "Expirée", cls: "bg-red-100 text-red-700 dark:bg-red-500/15 dark:text-red-300" },
  upcoming: { label: "À venir", cls: "bg-blue-100 text-blue-800 dark:bg-blue-500/15 dark:text-blue-300" },
  renewed: { label: "Renouvelée", cls: "bg-slate-200 text-slate-600 dark:bg-slate-700 dark:text-slate-300" },
  cancelled: { label: "Annulée", cls: "bg-slate-200 text-slate-600 dark:bg-slate-700 dark:text-slate-300" },
};

const inputCls =
  "w-full h-10 px-3 rounded-xl border border-slate-200 dark:border-slate-700 bg-slate-50 dark:bg-slate-900 text-xs font-semibold text-slate-900 dark:text-white outline-none focus:ring-2 focus:ring-blue-500";
const iso = (d: string | Date) => new Date(d).toISOString().slice(0, 10);
const fr = (d: string) => new Date(d).toLocaleDateString("fr-FR");

interface Form {
  id?: string;
  renewFrom?: string;
  carKey: string;
  company: string;
  policyNumber: string;
  startDate: string;
  endDate: string;
  costTND: string;
  attachmentUrl: string;
  notes: string;
}

/** Garage → Assurance: insurance contracts per physical car (create, edit, renew, delete, search). */
export function InsurancePanel({ focusUnit }: { focusUnit?: string | null }) {
  const { can } = usePermissions();
  const canEdit = can("garage.edit");
  const [view, setView] = useViewMode("insurance", "table");
  const [policies, setPolicies] = useState<Policy[]>([]);
  const [cars, setCars] = useState<CarOpt[]>([]);
  const [uninsured, setUninsured] = useState<CarOpt[]>([]);
  const [stats, setStats] = useState<Stats | null>(null);
  const [loading, setLoading] = useState(true);
  const [q, setQ] = useState("");
  const [filter, setFilter] = useState<"current" | "all" | "expiring" | "expired">("current");
  const [form, setForm] = useState<Form | null>(null);
  const [viewing, setViewing] = useState<Policy | null>(null);
  const [saving, setSaving] = useState(false);
  const [uploading, setUploading] = useState(false);
  const [error, setError] = useState("");
  const [toast, setToast] = useState<{ ok: boolean; text: string } | null>(null);

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const d = await fetch("/api/admin/insurance", { cache: "no-store" }).then((r) => r.json());
      if (d.success) {
        setPolicies(d.policies);
        setCars(d.cars);
        setUninsured(d.uninsured);
        setStats(d.stats);
      }
    } finally {
      setLoading(false);
    }
  }, []);
  useEffect(() => {
    load();
  }, [load]);

  const notify = (ok: boolean, text: string) => {
    setToast({ ok, text });
    setTimeout(() => setToast(null), 3500);
  };

  const shown = useMemo(() => {
    const s = q.trim().toLowerCase();
    return policies.filter((p) => {
      if (focusUnit && p.unitId !== focusUnit) return false;
      if (filter === "current" && ["renewed", "cancelled"].includes(p.status)) return false;
      if (filter === "expiring" && p.status !== "expiring") return false;
      if (filter === "expired" && p.status !== "expired") return false;
      return !s || `${p.car} ${p.company} ${p.policyNumber}`.toLowerCase().includes(s);
    });
  }, [policies, q, filter, focusUnit]);

  const blank = (car?: CarOpt): Form => {
    const start = new Date();
    const end = new Date();
    end.setFullYear(end.getFullYear() + 1);
    return { carKey: car ? `${car.vehicleId}|${car.unitId}` : "", company: "", policyNumber: "", startDate: iso(start), endDate: iso(end), costTND: "", attachmentUrl: "", notes: "" };
  };
  const edit = (p: Policy): Form => ({
    id: p._id,
    carKey: `${p.vehicleId}|${p.unitId}`,
    company: p.company,
    policyNumber: p.policyNumber,
    startDate: iso(p.startDate),
    endDate: iso(p.endDate),
    costTND: String(p.costTND || ""),
    attachmentUrl: p.attachmentUrl,
    notes: p.notes,
  });
  /** Renewal: new contract starting the day the previous one ends, for one more year. */
  const renew = (p: Policy): Form => {
    const start = new Date(p.endDate);
    const end = new Date(start);
    end.setFullYear(end.getFullYear() + 1);
    return { renewFrom: p._id, carKey: `${p.vehicleId}|${p.unitId}`, company: p.company, policyNumber: p.policyNumber, startDate: iso(start), endDate: iso(end), costTND: String(p.costTND || ""), attachmentUrl: "", notes: "" };
  };

  const save = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!form) return;
    setError("");
    const [vehicleId, unitId] = form.carKey.split("|");
    if (!vehicleId || !unitId) return setError("Choisissez le véhicule.");
    setSaving(true);
    try {
      const res = await fetch("/api/admin/insurance", {
        method: form.id ? "PUT" : "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          id: form.id,
          renewFrom: form.renewFrom,
          vehicleId,
          unitId,
          company: form.company,
          policyNumber: form.policyNumber,
          startDate: form.startDate,
          endDate: form.endDate,
          costTND: Number(form.costTND || 0),
          attachmentUrl: form.attachmentUrl,
          notes: form.notes,
        }),
      });
      const d = await res.json().catch(() => ({}));
      if (!res.ok || !d.success) throw new Error(d.error || "Enregistrement refusé");
      notify(true, form.renewFrom ? "Assurance renouvelée" : form.id ? "Assurance mise à jour" : "Assurance ajoutée");
      setForm(null);
      await load();
    } catch (err) {
      setError(err instanceof Error ? err.message : "Erreur");
    } finally {
      setSaving(false);
    }
  };

  const remove = async (p: Policy) => {
    if (!confirm(`Supprimer l'assurance ${p.policyNumber} (${p.car}) ?`)) return;
    const res = await fetch(`/api/admin/insurance?id=${p._id}`, { method: "DELETE" });
    notify(res.ok, res.ok ? "Assurance supprimée" : "Suppression refusée");
    load();
  };

  const upload = async (file: File) => {
    if (!form) return;
    setUploading(true);
    try {
      const fd = new FormData();
      fd.append("file", file);
      const res = await fetch("/api/admin/documents", { method: "POST", body: fd });
      const d = await res.json().catch(() => ({}));
      if (!res.ok || !d.url) throw new Error(d.error || "Téléversement impossible (PDF, JPG, PNG ou WebP — 8 Mo max)");
      setForm({ ...form, attachmentUrl: d.url });
    } catch (err) {
      setError(err instanceof Error ? err.message : "Téléversement impossible");
    } finally {
      setUploading(false);
    }
  };

  const actions = (p: Policy) =>
    standardActions({
      onView: () => setViewing(p),
      onEdit: () => setForm(edit(p)),
      onViewEdit: () => setForm(edit(p)),
      onDelete: () => remove(p),
      can: { edit: canEdit, delete: canEdit },
      extra: canEdit && !["renewed", "cancelled"].includes(p.status) ? [{ key: "renew", label: "Renouveler", icon: RefreshCw, onClick: () => setForm(renew(p)) }] : [],
    });

  const badge = (p: Policy) => <span className={`inline-flex px-2 py-0.5 rounded-full text-[10px] font-bold whitespace-nowrap ${STATUS[p.status].cls}`}>{STATUS[p.status].label}</span>;
  const left = (p: Policy) => (["renewed", "cancelled"].includes(p.status) ? "—" : p.daysLeft < 0 ? `expirée depuis ${-p.daysLeft} j` : `${p.daysLeft} j restants`);

  return (
    <div className="space-y-4">
      {toast && (
        <div role="status" className={`fixed top-20 right-4 z-[90] px-4 py-3 rounded-2xl shadow-xl text-xs font-semibold flex items-center gap-2 text-white ${toast.ok ? "bg-emerald-600" : "bg-red-600"}`}>
          {toast.ok ? <CheckCircle2 className="w-4 h-4" /> : <AlertTriangle className="w-4 h-4" />} {toast.text}
        </div>
      )}

      {stats && (
        <div className="grid grid-cols-2 lg:grid-cols-4 gap-3">
          {[
            ["Actives", stats.active, "text-emerald-600"],
            ["Expirent sous 30 j", stats.expiring, "text-amber-600"],
            ["Expirées", stats.expired, "text-red-600"],
            ["Véhicules sans assurance", stats.uninsured, stats.uninsured ? "text-red-600" : "text-slate-900 dark:text-white"],
          ].map(([label, n, cls]) => (
            <div key={String(label)} className="p-4 rounded-2xl bg-white dark:bg-[#0f141f] border border-slate-200 dark:border-slate-800">
              <p className="text-[11px] font-semibold text-slate-500 uppercase tracking-wide">{label}</p>
              <p className={`text-2xl font-black mt-1 ${cls}`}>{n}</p>
            </div>
          ))}
        </div>
      )}

      <div className="flex flex-col sm:flex-row gap-2">
        <div className="relative flex-1">
          <Search className="w-4 h-4 absolute left-3 top-1/2 -translate-y-1/2 text-slate-400" />
          <input value={q} onChange={(e) => setQ(e.target.value)} placeholder="Rechercher véhicule, compagnie, n° de police…" className={`${inputCls} pl-9`} />
        </div>
        <select value={filter} onChange={(e) => setFilter(e.target.value as typeof filter)} className={`${inputCls} sm:w-48`} aria-label="Filtre">
          <option value="current">En cours</option>
          <option value="expiring">Expirent bientôt</option>
          <option value="expired">Expirées</option>
          <option value="all">Tout l&apos;historique</option>
        </select>
        <ViewToggle value={view} onChange={setView} />
        {canEdit && (
          <button type="button" onClick={() => { setError(""); setForm(blank()); }} className={`${btn.base} ${btn.primary} h-10`}>
            <Plus className="w-4 h-4" /> Nouvelle assurance
          </button>
        )}
      </div>

      {canEdit && uninsured.length > 0 && filter === "current" && !q && !focusUnit && (
        <div className="p-3 rounded-xl bg-amber-50 dark:bg-amber-950/30 border border-amber-200 dark:border-amber-800 text-xs text-amber-900 dark:text-amber-200">
          <p className="font-bold mb-1.5">{uninsured.length} véhicule(s) sans assurance enregistrée :</p>
          <div className="flex flex-wrap gap-1.5">
            {uninsured.slice(0, 12).map((c) => (
              <button key={c.unitId} type="button" onClick={() => { setError(""); setForm(blank(c)); }} className="px-2 py-1 rounded-lg bg-white dark:bg-slate-900 border border-amber-300 dark:border-amber-700 font-semibold hover:bg-amber-100 dark:hover:bg-amber-900/40">
                + {c.label}
              </button>
            ))}
            {uninsured.length > 12 && <span className="py-1">… et {uninsured.length - 12} autres</span>}
          </div>
        </div>
      )}

      {loading && policies.length === 0 ? (
        <div className="py-16 flex justify-center"><Loader2 className="w-6 h-6 animate-spin text-slate-400" /></div>
      ) : shown.length === 0 ? (
        <p className="py-14 text-center text-sm text-slate-500 rounded-2xl border border-dashed border-slate-200 dark:border-slate-800">Aucune assurance à afficher.</p>
      ) : view === "grid" ? (
        <div className="grid grid-cols-1 md:grid-cols-2 xl:grid-cols-3 gap-4">
          {shown.map((p) => (
            <div key={p._id} className="p-4 rounded-2xl bg-white dark:bg-[#0f141f] border border-slate-200 dark:border-slate-800 flex flex-col gap-2">
              <div className="flex items-start justify-between gap-2">
                <button type="button" onClick={() => setViewing(p)} className="min-w-0 text-left">
                  <p className="text-sm font-bold text-slate-900 dark:text-white truncate">{p.car}</p>
                  <p className="text-xs text-slate-500 truncate">{p.company} · {p.policyNumber}</p>
                </button>
                <ActionMenu items={actions(p)} label={`Actions pour ${p.policyNumber}`} size="sm" />
              </div>
              <div className="flex items-center justify-between text-xs">
                {badge(p)}
                <span className="text-slate-500">{left(p)}</span>
              </div>
              <p className="text-xs text-slate-600 dark:text-slate-300">{fr(p.startDate)} → {fr(p.endDate)} · {p.costTND.toLocaleString("fr-FR")} TND</p>
              {p.attachmentUrl && (
                <a href={p.attachmentUrl} target="_blank" rel="noopener noreferrer" className="inline-flex items-center gap-1 text-xs font-semibold text-blue-600 hover:underline">
                  <Paperclip className="w-3.5 h-3.5" /> Contrat
                </a>
              )}
            </div>
          ))}
        </div>
      ) : (
        <div className="rounded-2xl bg-white dark:bg-[#0f141f] border border-slate-200 dark:border-slate-800 overflow-x-auto">
          <table className="w-full text-xs min-w-[820px]">
            <thead>
              <tr className="text-left text-[11px] uppercase tracking-wide text-slate-500 border-b border-slate-100 dark:border-slate-800">
                <th className="p-3">Véhicule</th><th className="p-3">Compagnie</th><th className="p-3">N° police</th><th className="p-3">Début</th><th className="p-3">Fin</th><th className="p-3">Coût</th><th className="p-3">Statut</th><th className="p-3">Pièce</th><th className="p-3 w-12" aria-label="Actions" />
              </tr>
            </thead>
            <tbody className="divide-y divide-slate-100 dark:divide-slate-800">
              {shown.map((p) => (
                <tr key={p._id} className="hover:bg-slate-50 dark:hover:bg-slate-900/50">
                  <td className="p-3"><button type="button" onClick={() => setViewing(p)} className="font-bold text-slate-900 dark:text-white text-left hover:text-blue-600">{p.car}</button></td>
                  <td className="p-3">{p.company}</td>
                  <td className="p-3 font-mono">{p.policyNumber}</td>
                  <td className="p-3">{fr(p.startDate)}</td>
                  <td className="p-3">{fr(p.endDate)}<span className="block text-[10px] text-slate-500">{left(p)}</span></td>
                  <td className="p-3 whitespace-nowrap">{p.costTND.toLocaleString("fr-FR")} TND</td>
                  <td className="p-3">{badge(p)}</td>
                  <td className="p-3">{p.attachmentUrl ? <a href={p.attachmentUrl} target="_blank" rel="noopener noreferrer" className="text-blue-600 hover:underline inline-flex items-center gap-1"><Paperclip className="w-3.5 h-3.5" />Voir</a> : "—"}</td>
                  <td className="p-3 text-right"><ActionMenu items={actions(p)} label={`Actions pour ${p.policyNumber}`} size="sm" /></td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}

      <QuickView
        open={Boolean(viewing)}
        onClose={() => setViewing(null)}
        title={viewing?.car}
        subtitle={viewing ? `${viewing.company} · ${viewing.policyNumber}` : ""}
        badge={viewing ? badge(viewing) : null}
        footer={
          viewing && canEdit && (
            <>
              {!["renewed", "cancelled"].includes(viewing.status) && (
                <button type="button" className={`${btn.base} ${btn.secondary}`} onClick={() => { const p = viewing; setViewing(null); setForm(renew(p)); }}>
                  <RefreshCw className="w-4 h-4" /> Renouveler
                </button>
              )}
              <button type="button" className={`${btn.base} ${btn.primary}`} onClick={() => { const p = viewing; setViewing(null); setForm(edit(p)); }}>
                Voir & modifier
              </button>
            </>
          )
        }
      >
        {viewing && (
          <>
            <Section title="Contrat">
              <Field label="Compagnie">{viewing.company}</Field>
              <Field label="N° de police">{viewing.policyNumber}</Field>
              <Field label="Période">{fr(viewing.startDate)} → {fr(viewing.endDate)}</Field>
              <Field label="Échéance">{left(viewing)}</Field>
              <Field label="Coût">{viewing.costTND.toLocaleString("fr-FR")} TND</Field>
            </Section>
            {viewing.attachmentUrl && (
              <a href={viewing.attachmentUrl} target="_blank" rel="noopener noreferrer" className="inline-flex items-center gap-1.5 text-blue-600 font-semibold hover:underline">
                <Paperclip className="w-4 h-4" /> Ouvrir la pièce jointe
              </a>
            )}
            {viewing.notes && <Section title="Notes"><p>{viewing.notes}</p></Section>}
          </>
        )}
      </QuickView>

      {form && (
        <div className="fixed inset-0 z-[75] flex items-end sm:items-center justify-center bg-black/60 backdrop-blur-sm sm:p-4" role="dialog" aria-modal="true">
          <form onSubmit={save} className="w-full sm:max-w-lg max-h-[92vh] flex flex-col rounded-t-2xl sm:rounded-2xl bg-white dark:bg-[#0f141f] border border-slate-200 dark:border-slate-700 shadow-2xl text-xs">
            <div className="flex items-center justify-between p-5 border-b border-slate-100 dark:border-slate-800">
              <h2 className="text-sm font-bold text-slate-900 dark:text-white flex items-center gap-2">
                <ShieldCheck className="w-4 h-4 text-blue-600" />
                {form.renewFrom ? "Renouveler l'assurance" : form.id ? "Modifier l'assurance" : "Nouvelle assurance"}
              </h2>
              <button type="button" onClick={() => setForm(null)} aria-label="Fermer" className="p-1 rounded-lg text-slate-400 hover:bg-slate-100 dark:hover:bg-slate-800"><X className="w-4 h-4" /></button>
            </div>
            <div className="p-5 space-y-3 overflow-y-auto">
              <label className="block space-y-1">
                <span className="font-semibold text-slate-600 dark:text-slate-300">Véhicule *</span>
                <select required className={inputCls} value={form.carKey} disabled={Boolean(form.renewFrom)} onChange={(e) => setForm({ ...form, carKey: e.target.value })}>
                  <option value="">— Choisir —</option>
                  {cars.map((c) => <option key={c.unitId} value={`${c.vehicleId}|${c.unitId}`}>{c.label}</option>)}
                </select>
              </label>
              <div className="grid grid-cols-2 gap-3">
                <label className="block space-y-1"><span className="font-semibold text-slate-600 dark:text-slate-300">Compagnie *</span>
                  <input required className={inputCls} value={form.company} onChange={(e) => setForm({ ...form, company: e.target.value })} placeholder="ex. STAR, COMAR, GAT" /></label>
                <label className="block space-y-1"><span className="font-semibold text-slate-600 dark:text-slate-300">N° de police *</span>
                  <input required className={inputCls} value={form.policyNumber} onChange={(e) => setForm({ ...form, policyNumber: e.target.value })} /></label>
                <label className="block space-y-1"><span className="font-semibold text-slate-600 dark:text-slate-300">Début *</span>
                  <input required type="date" className={inputCls} value={form.startDate} onChange={(e) => setForm({ ...form, startDate: e.target.value })} /></label>
                <label className="block space-y-1"><span className="font-semibold text-slate-600 dark:text-slate-300">Fin *</span>
                  <input required type="date" min={form.startDate} className={inputCls} value={form.endDate} onChange={(e) => setForm({ ...form, endDate: e.target.value })} /></label>
                <label className="block space-y-1 col-span-2 sm:col-span-1"><span className="font-semibold text-slate-600 dark:text-slate-300">Coût (TND)</span>
                  <input type="number" min={0} step="0.001" className={inputCls} value={form.costTND} onChange={(e) => setForm({ ...form, costTND: e.target.value })} /></label>
              </div>
              <div className="space-y-1">
                <span className="font-semibold text-slate-600 dark:text-slate-300">Pièce jointe (PDF ou photo du contrat, ou lien)</span>
                <div className="flex gap-2">
                  <input className={inputCls} value={form.attachmentUrl} onChange={(e) => setForm({ ...form, attachmentUrl: e.target.value })} placeholder="https://…" />
                  <label className={`${btn.base} ${btn.secondary} h-10 cursor-pointer shrink-0`}>
                    {uploading ? <Loader2 className="w-4 h-4 animate-spin" /> : <Upload className="w-4 h-4" />} PDF / photo
                    <input type="file" accept="application/pdf,image/jpeg,image/png,image/webp" className="hidden" onChange={(e) => e.target.files?.[0] && upload(e.target.files[0])} />
                  </label>
                  {form.attachmentUrl && (
                    <button type="button" onClick={() => setForm({ ...form, attachmentUrl: "" })} aria-label="Retirer la pièce" className={`${btn.base} ${btn.secondary} h-10 px-2.5`}><Trash2 className="w-4 h-4" /></button>
                  )}
                </div>
              </div>
              <label className="block space-y-1"><span className="font-semibold text-slate-600 dark:text-slate-300">Notes</span>
                <textarea className={`${inputCls} h-16 py-2`} value={form.notes} onChange={(e) => setForm({ ...form, notes: e.target.value })} /></label>
              {error && <p role="alert" className="text-red-600 font-semibold">{error}</p>}
            </div>
            <div className="p-4 border-t border-slate-100 dark:border-slate-800 flex justify-end gap-2">
              <button type="button" onClick={() => setForm(null)} className={`${btn.base} ${btn.secondary}`}>Annuler</button>
              <button type="submit" disabled={saving || uploading} className={`${btn.base} ${btn.primary}`}>{saving && <Loader2 className="w-4 h-4 animate-spin" />} Enregistrer</button>
            </div>
          </form>
        </div>
      )}
    </div>
  );
}
