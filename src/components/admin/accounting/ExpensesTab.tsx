"use client";

import { useCallback, useEffect, useState } from "react";
import { Download, FileText, Loader2, Pencil, Plus, Search, Trash2 } from "lucide-react";
import { ViewToggle, btn, usePermissions, useViewMode } from "@/components/admin/ui";
import { EXPENSE_LABELS, METHOD_LABELS, dt } from "@/lib/accountingLabels";
import { DocumentField, Empty, ErrorNote, Kpi, Modal, PeriodBar, api, cardCls, frDay, inputCls, iso, labelCls, tdCls, thCls, type Period } from "./shared";

interface Expense {
  _id: string;
  number: string;
  date: string;
  category: string;
  label: string;
  supplier?: string;
  amount: number;
  vatAmount: number;
  method: string;
  invoiceNumber?: string;
  vehicleId?: string;
  unitId?: string;
  vehicleName?: string;
  receiptUrl?: string;
  notes?: string;
  createdBy: string;
  closingId?: string;
}
interface VehicleOpt {
  _id: string;
  name: string;
  units: { _id: string; label: string }[];
}
type Form = { id?: string; date: string; category: string; label: string; supplier: string; amountTND: string; vatTND: string; method: string; invoiceNumber: string; vehicleId: string; unitId: string; receiptUrl: string; notes: string };

const blank = (): Form => ({ date: iso(new Date()), category: "fuel", label: "", supplier: "", amountTND: "", vatTND: "", method: "cash", invoiceNumber: "", vehicleId: "", unitId: "", receiptUrl: "", notes: "" });
const num = (v: string) => Number(String(v || "0").replace(",", "."));

export function ExpensesTab({ period, setPeriod, onChanged }: { period: Period; setPeriod: (p: Period) => void; onChanged: () => void }) {
  const { can } = usePermissions();
  const [view, setView] = useViewMode("accounting-expenses");
  const [rows, setRows] = useState<Expense[]>([]);
  const [vehicles, setVehicles] = useState<VehicleOpt[]>([]);
  const [totals, setTotals] = useState<{ amount: number; vat: number; byCategory: Record<string, number> }>({ amount: 0, vat: 0, byCategory: {} });
  const [filters, setFilters] = useState({ category: "", q: "" });
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");
  const [form, setForm] = useState<Form | null>(null);
  const [formError, setFormError] = useState("");
  const [saving, setSaving] = useState(false);

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const q = new URLSearchParams({ from: period.from, to: period.to });
      Object.entries(filters).forEach(([k, v]) => v && q.set(k, v));
      const d = await api<{ expenses: Expense[]; totals: typeof totals; vehicles: VehicleOpt[] }>(`/api/admin/accounting/expenses?${q}`);
      setRows(d.expenses);
      setTotals(d.totals);
      setVehicles(d.vehicles);
      setError("");
    } catch (e) {
      setError(e instanceof Error ? e.message : "Chargement impossible");
    } finally {
      setLoading(false);
    }
  }, [period.from, period.to, filters]);
  useEffect(() => {
    const t = setTimeout(load, filters.q ? 300 : 0);
    return () => clearTimeout(t);
  }, [load, filters.q]);

  const edit = (e: Expense) =>
    setForm({ id: e._id, date: e.date.slice(0, 10), category: e.category, label: e.label, supplier: e.supplier || "", amountTND: (e.amount / 100).toFixed(3), vatTND: e.vatAmount ? (e.vatAmount / 100).toFixed(3) : "", method: e.method, invoiceNumber: e.invoiceNumber || "", vehicleId: e.vehicleId || "", unitId: e.unitId || "", receiptUrl: e.receiptUrl || "", notes: e.notes || "" });

  const save = async () => {
    if (!form) return;
    setSaving(true);
    setFormError("");
    try {
      await api("/api/admin/accounting/expenses", {
        method: form.id ? "PUT" : "POST",
        body: JSON.stringify({ ...form, amountTND: num(form.amountTND), vatTND: num(form.vatTND) }),
      });
      setForm(null);
      await load();
      onChanged();
    } catch (e) {
      setFormError(e instanceof Error ? e.message : "Enregistrement impossible");
    } finally {
      setSaving(false);
    }
  };
  const remove = async (e: Expense) => {
    if (!window.confirm(`Supprimer la dépense ${e.number} (${dt(e.amount)}) ?`)) return;
    try {
      await api(`/api/admin/accounting/expenses?id=${e._id}`, { method: "DELETE" });
      await load();
      onChanged();
    } catch (err) {
      setError(err instanceof Error ? err.message : "Suppression impossible");
    }
  };

  const top = Object.entries(totals.byCategory).sort((a, b) => b[1] - a[1])[0];
  const units = vehicles.find((v) => v._id === form?.vehicleId)?.units || [];
  const actions = (e: Expense) => (
    <div className="flex items-center justify-end gap-1">
      {e.receiptUrl && <a href={e.receiptUrl} target="_blank" rel="noopener noreferrer" aria-label="Voir le justificatif" className="p-2 rounded-lg text-blue-600 hover:bg-blue-50 dark:hover:bg-blue-500/10"><FileText className="w-4 h-4" /></a>}
      {can("accounting.edit") && <button type="button" onClick={() => edit(e)} aria-label={`Modifier ${e.number}`} className="p-2 rounded-lg text-slate-600 dark:text-slate-300 hover:bg-slate-100 dark:hover:bg-slate-800"><Pencil className="w-4 h-4" /></button>}
      {can("accounting.delete") && !e.closingId && <button type="button" onClick={() => remove(e)} aria-label={`Supprimer ${e.number}`} className="p-2 rounded-lg text-red-600 hover:bg-red-50 dark:hover:bg-red-500/10"><Trash2 className="w-4 h-4" /></button>}
    </div>
  );

  return (
    <div className="space-y-3">
      <PeriodBar period={period} onChange={setPeriod}>
        {can("accounting.export") && <a href={`/api/admin/accounting/export?type=expenses&from=${period.from}&to=${period.to}`} className={`${btn.base} ${btn.secondary}`}><Download className="w-4 h-4" /> CSV</a>}
        {can("accounting.create") && <button type="button" onClick={() => { setFormError(""); setForm(blank()); }} className={`${btn.base} ${btn.primary}`}><Plus className="w-4 h-4" /> Nouvelle dépense</button>}
      </PeriodBar>
      <div className="grid grid-cols-2 lg:grid-cols-4 gap-3">
        <Kpi label="Total dépenses" value={dt(totals.amount)} tone="red" hint={`${rows.length} pièce(s)`} />
        <Kpi label="dont TVA déductible" value={dt(totals.vat)} />
        <Kpi label="Premier poste" value={top ? EXPENSE_LABELS[top[0]] || top[0] : "—"} hint={top ? dt(top[1]) : ""} />
        <Kpi label="Sans justificatif" value={rows.filter((r) => !r.receiptUrl).length} tone={rows.some((r) => !r.receiptUrl) ? "amber" : "emerald"} hint="pièce(s) à compléter" />
      </div>
      <div className={`${cardCls} p-3 flex flex-col sm:flex-row gap-2`}>
        <div className="relative flex-1">
          <Search className="w-4 h-4 absolute left-3 top-1/2 -translate-y-1/2 text-slate-400" />
          <input className={`${inputCls} pl-9`} placeholder="Libellé, fournisseur, n° de pièce…" value={filters.q} onChange={(e) => setFilters({ ...filters, q: e.target.value })} />
        </div>
        <select aria-label="Catégorie" className={`${inputCls} sm:w-64`} value={filters.category} onChange={(e) => setFilters({ ...filters, category: e.target.value })}>
          <option value="">Toutes les catégories</option>
          {Object.entries(EXPENSE_LABELS).map(([k, l]) => <option key={k} value={k}>{l}</option>)}
        </select>
        <ViewToggle value={view} onChange={setView} />
      </div>
      <ErrorNote text={error} />
      {loading && rows.length === 0 ? (
        <Loader2 className="w-6 h-6 animate-spin text-slate-400 mx-auto my-8" />
      ) : rows.length === 0 ? (
        <Empty>Aucune dépense sur cette période.</Empty>
      ) : view === "table" ? (
        <div className={`${cardCls} overflow-x-auto`}>
          <table className="w-full min-w-[820px]">
            <thead><tr><th className={thCls}>Date</th><th className={thCls}>N°</th><th className={thCls}>Catégorie</th><th className={thCls}>Libellé</th><th className={thCls}>Véhicule</th><th className={thCls}>Mode</th><th className={`${thCls} text-right`}>Montant TTC</th><th className={thCls} /></tr></thead>
            <tbody className="divide-y divide-slate-100 dark:divide-slate-800">
              {rows.map((e) => (
                <tr key={e._id}>
                  <td className={`${tdCls} whitespace-nowrap`}>{frDay(e.date)}</td>
                  <td className={`${tdCls} font-mono`}>{e.number}</td>
                  <td className={tdCls}>{EXPENSE_LABELS[e.category] || e.category}</td>
                  <td className={tdCls}><span className="font-bold">{e.label}</span>{e.supplier && <div className="text-[11px] text-slate-500">{e.supplier}</div>}</td>
                  <td className={tdCls}>{e.vehicleName || "—"}</td>
                  <td className={tdCls}>{METHOD_LABELS[e.method] || e.method}</td>
                  <td className={`${tdCls} text-right font-black tabular-nums text-red-600 whitespace-nowrap`}>{dt(e.amount)}</td>
                  <td className={tdCls}>{actions(e)}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      ) : (
        <div className="grid sm:grid-cols-2 xl:grid-cols-3 gap-3">
          {rows.map((e) => (
            <div key={e._id} className={`${cardCls} p-3.5 space-y-1.5`}>
              <div className="flex items-start justify-between gap-2">
                <div className="min-w-0">
                  <div className="text-xs font-bold text-slate-900 dark:text-white truncate">{e.label}</div>
                  <div className="text-[11px] text-slate-500 truncate">{EXPENSE_LABELS[e.category] || e.category}{e.supplier ? ` · ${e.supplier}` : ""}</div>
                </div>
                <span className="font-black tabular-nums text-red-600 whitespace-nowrap">{dt(e.amount)}</span>
              </div>
              <div className="text-[11px] text-slate-500 truncate">{e.number} · {frDay(e.date)} · {METHOD_LABELS[e.method] || e.method}{e.vehicleName ? ` · ${e.vehicleName}` : ""}</div>
              <div className="flex items-center justify-between">
                <span className={`text-[11px] font-bold ${e.receiptUrl ? "text-emerald-600" : "text-amber-600"}`}>{e.receiptUrl ? "Justificatif joint" : "Sans justificatif"}</span>
                {actions(e)}
              </div>
            </div>
          ))}
        </div>
      )}

      <Modal
        open={Boolean(form)}
        onClose={() => setForm(null)}
        title={form?.id ? "Modifier la dépense" : "Nouvelle dépense"}
        footer={
          <>
            <button type="button" onClick={() => setForm(null)} className={`${btn.base} ${btn.secondary}`}>Annuler</button>
            <button type="button" onClick={save} disabled={saving} className={`${btn.base} ${btn.primary}`}>{saving && <Loader2 className="w-4 h-4 animate-spin" />} Enregistrer</button>
          </>
        }
      >
        {form && (
          <>
            <ErrorNote text={formError} />
            <div className="grid grid-cols-2 gap-2.5">
              <label><span className={labelCls}>Date</span><input type="date" className={inputCls} value={form.date} max={iso(new Date())} onChange={(e) => setForm({ ...form, date: e.target.value })} /></label>
              <label><span className={labelCls}>Catégorie</span>
                <select className={inputCls} value={form.category} onChange={(e) => setForm({ ...form, category: e.target.value })}>
                  {Object.entries(EXPENSE_LABELS).map(([k, l]) => <option key={k} value={k}>{l}</option>)}
                </select></label>
              <label className="col-span-2"><span className={labelCls}>Libellé</span><input className={inputCls} value={form.label} placeholder="Ex. Plein essence, vidange, loyer novembre" onChange={(e) => setForm({ ...form, label: e.target.value })} /></label>
              <label><span className={labelCls}>Montant TTC (DT)</span><input inputMode="decimal" className={inputCls} value={form.amountTND} onChange={(e) => setForm({ ...form, amountTND: e.target.value })} /></label>
              <label><span className={labelCls}>dont TVA (DT)</span><input inputMode="decimal" className={inputCls} value={form.vatTND} placeholder="0.000" onChange={(e) => setForm({ ...form, vatTND: e.target.value })} /></label>
              <label><span className={labelCls}>Mode de paiement</span>
                <select className={inputCls} value={form.method} onChange={(e) => setForm({ ...form, method: e.target.value })}>
                  {Object.entries(METHOD_LABELS).filter(([k]) => k !== "online").map(([k, l]) => <option key={k} value={k}>{l}</option>)}
                </select></label>
              <label><span className={labelCls}>Fournisseur</span><input className={inputCls} value={form.supplier} onChange={(e) => setForm({ ...form, supplier: e.target.value })} /></label>
              <label><span className={labelCls}>N° facture fournisseur</span><input className={inputCls} value={form.invoiceNumber} onChange={(e) => setForm({ ...form, invoiceNumber: e.target.value })} /></label>
              <label><span className={labelCls}>Véhicule concerné</span>
                <select className={inputCls} value={form.vehicleId} onChange={(e) => setForm({ ...form, vehicleId: e.target.value, unitId: "" })}>
                  <option value="">Aucun (frais généraux)</option>
                  {vehicles.map((v) => <option key={v._id} value={v._id}>{v.name}</option>)}
                </select></label>
              {units.length > 0 && (
                <label className="col-span-2"><span className={labelCls}>Voiture (immatriculation)</span>
                  <select className={inputCls} value={form.unitId} onChange={(e) => setForm({ ...form, unitId: e.target.value })}>
                    <option value="">Tout le modèle</option>
                    {units.map((u) => <option key={u._id} value={u._id}>{u.label}</option>)}
                  </select></label>
              )}
            </div>
            <DocumentField value={form.receiptUrl} onChange={(url) => setForm({ ...form, receiptUrl: url })} purpose="expense" />
            <label className="block"><span className={labelCls}>Notes</span><textarea className={`${inputCls} h-16 py-2`} value={form.notes} onChange={(e) => setForm({ ...form, notes: e.target.value })} /></label>
          </>
        )}
      </Modal>
    </div>
  );
}
