"use client";

import React, { useCallback, useEffect, useState } from "react";
import { Plus, Trash2, X, Save, Upload, Loader2, Eye, EyeOff, AlertCircle } from "lucide-react";
import { OptionIcon, OPTION_ICON_CHOICES } from "@/components/ui/OptionIcon";
import { ActionMenu, QuickView, Field, Section, ViewToggle, btn, standardActions, useViewMode, usePermissions } from "@/components/admin/ui";

type PricingType = "per_day" | "per_rental" | "per_unit";

interface ExtraDoc {
  _id: string;
  name: { fr: string; en: string; ar: string };
  description?: { fr?: string; en?: string; ar?: string };
  icon: string;
  iconPublicId?: string;
  price: number; // minor units
  pricingType: PricingType;
  maxQuantity: number;
  order: number;
  isActive: boolean;
  selectionMode?: "quantity" | "amount";
  amountMin?: number;
  amountMax?: number;
  amountStep?: number;
}

interface FormState {
  id?: string;
  name: { fr: string; en: string; ar: string };
  description: { fr: string; en: string; ar: string };
  icon: string;
  iconPublicId: string;
  priceTnd: number;
  pricingType: PricingType;
  maxQuantity: number;
  order: number;
  isActive: boolean;
  selectionMode: "quantity" | "amount";
  amountMinTnd: number;
  amountMaxTnd: number;
  amountStepTnd: number;
}

const EMPTY_FORM: FormState = {
  name: { fr: "", en: "", ar: "" },
  description: { fr: "", en: "", ar: "" },
  icon: "Sparkles",
  iconPublicId: "",
  priceTnd: 0,
  pricingType: "per_rental",
  maxQuantity: 1,
  order: 0,
  isActive: true,
  selectionMode: "quantity",
  amountMinTnd: 50,
  amountMaxTnd: 200,
  amountStepTnd: 50,
};

const PRICING_LABELS: Record<PricingType, string> = {
  per_day: "Par jour",
  per_rental: "Forfait (une fois)",
  per_unit: "Par unité",
};

const inputCls =
  "w-full rounded-lg bg-white dark:bg-slate-800 border border-slate-300 dark:border-slate-600 px-3 py-2 text-xs text-slate-800 dark:text-white focus:outline-none focus:border-blue-500";

export default function AdminOptionsPage() {
  const [view, setView] = useViewMode("options", "grid");
  const { can } = usePermissions();
  const [viewing, setViewing] = useState<ExtraDoc | null>(null);
  const [extras, setExtras] = useState<ExtraDoc[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");
  const [form, setForm] = useState<FormState | null>(null);
  const [saving, setSaving] = useState(false);
  const [uploading, setUploading] = useState(false);
  // Icons uploaded during this edit session but not saved yet → deleted on cancel.
  const [pendingUploads, setPendingUploads] = useState<string[]>([]);

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const res = await fetch("/api/admin/extras");
      const json = await res.json();
      if (!res.ok) throw new Error(json.error || "Chargement impossible");
      setExtras(json.extras || []);
      setError("");
    } catch (e) {
      setError(e instanceof Error ? e.message : "Chargement impossible");
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    load();
  }, [load]);

  const openNew = () => {
    setPendingUploads([]);
    setForm({ ...EMPTY_FORM, order: extras.length + 1 });
  };

  const openEdit = (e: ExtraDoc) => {
    setPendingUploads([]);
    setForm({
      id: e._id,
      name: { ...e.name },
      description: { fr: e.description?.fr || "", en: e.description?.en || "", ar: e.description?.ar || "" },
      icon: e.icon,
      iconPublicId: e.iconPublicId || "",
      priceTnd: e.price / 100,
      pricingType: e.pricingType,
      maxQuantity: e.maxQuantity || 1,
      order: e.order || 0,
      isActive: e.isActive,
      selectionMode: e.selectionMode || "quantity",
      amountMinTnd: (e.amountMin ?? 5000) / 100,
      amountMaxTnd: (e.amountMax ?? 20000) / 100,
      amountStepTnd: (e.amountStep ?? 5000) / 100,
    });
  };

  const discardPendingUploads = async (keep?: string) => {
    const toDelete = pendingUploads.filter((id) => id && id !== keep);
    if (toDelete.length) {
      await fetch("/api/upload", {
        method: "DELETE",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ publicIds: toDelete }),
      }).catch(() => {});
    }
    setPendingUploads([]);
  };

  const closeForm = async () => {
    await discardPendingUploads();
    setForm(null);
  };

  const uploadIcon = async (file: File) => {
    if (!form) return;
    setUploading(true);
    try {
      const fd = new FormData();
      fd.append("file", file);
      fd.append("folder", "options");
      const res = await fetch("/api/upload", { method: "POST", body: fd });
      const json = await res.json();
      if (!res.ok || !json.url) throw new Error(json.error || "Téléversement échoué");
      setPendingUploads((p) => [...p, json.publicId]);
      setForm({ ...form, icon: json.url, iconPublicId: json.publicId });
    } catch (e) {
      alert(e instanceof Error ? e.message : "Téléversement échoué");
    } finally {
      setUploading(false);
    }
  };

  const save = async (ev: React.FormEvent) => {
    ev.preventDefault();
    if (!form) return;
    setSaving(true);
    try {
      const isImage = /^(https?:\/\/|\/)/.test(form.icon);
      const payload = { ...form, iconPublicId: isImage ? form.iconPublicId : "" };
      const res = await fetch("/api/admin/extras", {
        method: form.id ? "PUT" : "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(payload),
      });
      const json = await res.json();
      if (!res.ok) throw new Error(json.error || "Sauvegarde échouée");
      await discardPendingUploads(payload.iconPublicId);
      setForm(null);
      await load();
    } catch (e) {
      alert(e instanceof Error ? e.message : "Sauvegarde échouée");
    } finally {
      setSaving(false);
    }
  };

  const remove = async (e: ExtraDoc) => {
    if (!confirm(`Supprimer définitivement l'option « ${e.name.fr} » ? Les réservations existantes gardent leur copie.`)) return;
    const res = await fetch(`/api/admin/extras?id=${e._id}`, { method: "DELETE" });
    if (!res.ok) alert("Suppression impossible");
    await load();
  };

  const toggleActive = async (e: ExtraDoc) => {
    // Optimistic: the switch reacts instantly, rolled back if the server refuses.
    setExtras((list) => list.map((x) => (x._id === e._id ? { ...x, isActive: !e.isActive } : x)));
    try {
      const res = await fetch("/api/admin/extras", {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ id: e._id, isActive: !e.isActive }),
      });
      const json = await res.json().catch(() => ({}));
      if (!res.ok || !json.success) throw new Error(json.error || "Modification refusée");
    } catch (err) {
      setExtras((list) => list.map((x) => (x._id === e._id ? { ...x, isActive: e.isActive } : x)));
      alert(err instanceof Error ? err.message : "Modification refusée");
    }
  };

  const setAllActive = async (isActive: boolean) => {
    const targets = extras.filter((e) => e.isActive !== isActive);
    await Promise.all(
      targets.map((e) =>
        fetch("/api/admin/extras", {
          method: "PATCH",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ id: e._id, isActive }),
        })
      )
    );
    await load();
  };


  const priceLabel = (e: ExtraDoc) =>
    e.selectionMode === "amount"
      ? `${(e.amountMin ?? 0) / 100}–${(e.amountMax ?? 0) / 100} TND (au choix)`
      : e.price === 0
      ? "Offert"
      : `${(e.price / 100).toLocaleString("fr-FR")} TND · ${PRICING_LABELS[e.pricingType]}`;

  const duplicate = async (e: ExtraDoc) => {
    const res = await fetch("/api/admin/extras", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        name: { fr: `${e.name.fr} (copie)`, en: e.name.en || e.name.fr, ar: e.name.ar || e.name.fr },
        description: e.description,
        icon: e.icon,
        priceTnd: e.price / 100,
        pricingType: e.pricingType,
        maxQuantity: e.maxQuantity || 1,
        order: (e.order || 0) + 1,
        isActive: false,
        selectionMode: e.selectionMode || "quantity",
        amountMinTnd: (e.amountMin ?? 5000) / 100,
        amountMaxTnd: (e.amountMax ?? 20000) / 100,
        amountStepTnd: (e.amountStep ?? 5000) / 100,
      }),
    });
    if (!res.ok) alert((await res.json().catch(() => ({}))).error || "Duplication impossible");
    await load();
  };

  /** Unified option actions: Voir / Modifier / Voir & modifier, show-hide, duplicate, delete. */
  const optionActions = (e: ExtraDoc) =>
    standardActions({
      onView: () => setViewing(e),
      onEdit: () => openEdit(e),
      onViewEdit: () => openEdit(e),
      onDuplicate: () => duplicate(e),
      onDelete: () => remove(e),
      can: { edit: can("options.edit"), delete: can("options.delete"), create: can("options.create") },
      extra: can("options.edit")
        ? [{ key: "toggle", label: e.isActive ? "Masquer sur le site" : "Afficher sur le site", icon: e.isActive ? EyeOff : Eye, onClick: () => toggleActive(e) }]
        : [],
    });

  return (
    <div className="space-y-6">
      <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4">
        <div>
          <h1 className="text-2xl sm:text-3xl font-extrabold text-slate-900 dark:text-white tracking-tight">
            Options & Équipements
          </h1>
          <p className="text-xs sm:text-sm text-slate-500 dark:text-slate-400 mt-1">
            Options proposées à l&apos;étape 3 de la réservation. L&apos;œil masque / affiche une option sur le site en un clic.
          </p>
        </div>
        <div className="flex flex-wrap gap-2">
          <ViewToggle value={view} onChange={setView} />
          <button
            onClick={() => setAllActive(true)}
            className="inline-flex items-center justify-center gap-1.5 px-3 py-2.5 rounded-xl border border-slate-200 dark:border-slate-700 text-xs font-semibold text-slate-700 dark:text-slate-200"
          >
            <Eye className="w-4 h-4" /> Tout afficher
          </button>
          <button
            onClick={() => setAllActive(false)}
            className="inline-flex items-center justify-center gap-1.5 px-3 py-2.5 rounded-xl border border-slate-200 dark:border-slate-700 text-xs font-semibold text-slate-700 dark:text-slate-200"
          >
            <EyeOff className="w-4 h-4" /> Tout masquer
          </button>
          <button
            onClick={openNew}
            className="inline-flex items-center justify-center gap-2 px-4 py-2.5 rounded-xl bg-blue-600 hover:bg-blue-500 text-white text-xs font-semibold shadow-lg shadow-blue-600/25"
          >
            <Plus className="w-4 h-4" />
            Nouvelle option
          </button>
        </div>
      </div>

      {error && (
        <div className="flex items-center gap-2 p-3 rounded-xl bg-red-50 dark:bg-red-950/30 text-red-700 dark:text-red-300 text-xs">
          <AlertCircle className="w-4 h-4" /> {error}
        </div>
      )}

      {loading ? (
        <div className="flex justify-center py-16">
          <Loader2 className="w-6 h-6 animate-spin text-blue-500" />
        </div>
      ) : view === "table" ? (
        <div className="rounded-2xl bg-white dark:bg-[#0f141f] border border-slate-200 dark:border-slate-800 overflow-x-auto">
          <table className="w-full text-xs min-w-[640px]">
            <thead>
              <tr className="text-left text-[11px] uppercase tracking-wide text-slate-500 border-b border-slate-100 dark:border-slate-800">
                <th className="p-3">Option</th>
                <th className="p-3">Prix</th>
                <th className="p-3">Choix client</th>
                <th className="p-3">Ordre</th>
                <th className="p-3">Visibilité</th>
                <th className="p-3 w-12" aria-label="Actions" />
              </tr>
            </thead>
            <tbody className="divide-y divide-slate-100 dark:divide-slate-800">
              {extras.map((e) => (
                <tr key={e._id} className={`hover:bg-slate-50 dark:hover:bg-slate-900/50 ${e.isActive ? "" : "opacity-60"}`}>
                  <td className="p-3">
                    <button type="button" onClick={() => setViewing(e)} className="flex items-center gap-2.5 text-left">
                      <OptionIcon icon={e.icon} size="sm" />
                      <span className="font-bold text-slate-900 dark:text-white">{e.name.fr}</span>
                    </button>
                  </td>
                  <td className="p-3 font-mono">{priceLabel(e)}</td>
                  <td className="p-3">{e.selectionMode === "amount" ? "Montant (barre)" : `Quantité (max ${e.maxQuantity})`}</td>
                  <td className="p-3">{e.order}</td>
                  <td className="p-3">
                    {can("options.edit") ? (
                      <button
                        type="button"
                        onClick={() => toggleActive(e)}
                        className={`px-2 py-0.5 rounded-full text-[10px] font-bold ${
                          e.isActive ? "bg-emerald-100 text-emerald-800 dark:bg-emerald-500/15 dark:text-emerald-300" : "bg-slate-200 text-slate-600 dark:bg-slate-700 dark:text-slate-300"
                        }`}
                      >
                        {e.isActive ? "Visible" : "Masquée"}
                      </button>
                    ) : e.isActive ? "Visible" : "Masquée"}
                  </td>
                  <td className="p-3 text-right">
                    <ActionMenu items={optionActions(e)} label={`Actions pour ${e.name.fr}`} size="sm" />
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
          {extras.length === 0 && !error && <p className="text-sm text-slate-500 text-center py-10">Aucune option pour le moment.</p>}
        </div>
      ) : (
        <div className="grid grid-cols-1 md:grid-cols-2 xl:grid-cols-3 gap-4">
          {extras.map((e) => (
            <div
              key={e._id}
              className={`rounded-2xl bg-white dark:bg-[#0f141f] border border-slate-200 dark:border-slate-800 p-4 shadow-sm flex gap-3 ${
                e.isActive ? "" : "opacity-60"
              }`}
            >
              <OptionIcon icon={e.icon} size="lg" />
              <div className="flex-1 min-w-0 space-y-1">
                <p className="font-bold text-sm text-slate-900 dark:text-white break-words">{e.name.fr}</p>
                <p className="text-[11px] text-slate-500 dark:text-slate-400 truncate">{e.name.en}</p>
                <p className="text-xs font-mono font-semibold text-blue-600 dark:text-blue-400">
                  {priceLabel(e)}
                </p>
                {!e.isActive && <p className="text-[10px] font-bold uppercase text-amber-600">Masquée</p>}
              </div>
              <div className="flex flex-col items-center gap-1.5 shrink-0">
                <ActionMenu items={optionActions(e)} label={`Actions pour ${e.name.fr}`} size="sm" />
                {can("options.edit") && (
                  <button
                    onClick={() => toggleActive(e)}
                    aria-label={e.isActive ? `Masquer ${e.name.fr}` : `Afficher ${e.name.fr}`}
                    title={e.isActive ? "Masquer sur le site" : "Afficher sur le site"}
                    className="w-8 h-8 inline-flex items-center justify-center rounded-lg bg-slate-100 dark:bg-slate-800 hover:bg-amber-50 dark:hover:bg-amber-900/30 text-slate-600 dark:text-slate-300"
                  >
                    {e.isActive ? <Eye className="w-3.5 h-3.5" /> : <EyeOff className="w-3.5 h-3.5" />}
                  </button>
                )}
              </div>
            </div>
          ))}
          {extras.length === 0 && !error && (
            <p className="text-sm text-slate-500 col-span-full text-center py-10">Aucune option pour le moment.</p>
          )}
        </div>
      )}

      {form && (
        <div className="fixed inset-0 z-50 flex items-start justify-center p-3 sm:p-4 bg-black/70 backdrop-blur-sm overflow-y-auto" role="dialog" aria-modal="true" aria-labelledby="option-form-title">
          <form onSubmit={save} className="w-full max-w-2xl rounded-2xl bg-white dark:bg-[#0f141f] border border-slate-200 dark:border-slate-700 shadow-2xl my-4 sm:my-8">
            <div className="flex items-center justify-between px-5 py-4 border-b border-slate-200 dark:border-slate-700">
              <h2 id="option-form-title" className="text-sm font-bold text-slate-900 dark:text-white">
                {form.id ? "Modifier l'option" : "Nouvelle option"}
              </h2>
              <button type="button" onClick={closeForm} aria-label="Fermer" className="p-2 rounded-lg hover:bg-slate-100 dark:hover:bg-slate-800 text-slate-400">
                <X className="w-4 h-4" />
              </button>
            </div>

            <div className="p-5 space-y-5 text-xs">
              {/* Icon */}
              <div className="space-y-2">
                <p className="font-semibold text-slate-700 dark:text-slate-300">Icône</p>
                <div className="flex items-center gap-3 flex-wrap">
                  <OptionIcon icon={form.icon} size="lg" />
                  <input
                    className={`${inputCls} flex-1 min-w-[180px] font-mono`}
                    value={form.icon}
                    onChange={(ev) => setForm({ ...form, icon: ev.target.value, iconPublicId: "" })}
                    placeholder="Nom d'icône (ex: Baby), emoji (⛽) ou URL d'image"
                    aria-label="Icône"
                  />
                  <label className="cursor-pointer inline-flex items-center gap-2 px-3 py-2 rounded-lg bg-slate-100 dark:bg-slate-800 border border-slate-300 dark:border-slate-600 text-slate-700 dark:text-slate-200">
                    {uploading ? <Loader2 className="w-3.5 h-3.5 animate-spin" /> : <Upload className="w-3.5 h-3.5" />}
                    Logo
                    <input
                      type="file"
                      accept="image/png,image/jpeg,image/webp,image/svg+xml"
                      className="sr-only"
                      disabled={uploading}
                      onChange={(ev) => {
                        const f = ev.target.files?.[0];
                        if (f) uploadIcon(f);
                        ev.target.value = "";
                      }}
                    />
                  </label>
                </div>
                <div className="flex flex-wrap gap-1.5" role="listbox" aria-label="Icônes disponibles">
                  {OPTION_ICON_CHOICES.map((name) => (
                    <button
                      key={name}
                      type="button"
                      role="option"
                      aria-selected={form.icon === name}
                      title={name}
                      onClick={() => setForm({ ...form, icon: name, iconPublicId: "" })}
                      className={`rounded-xl ring-2 ${form.icon === name ? "ring-blue-500" : "ring-transparent hover:ring-slate-300"}`}
                    >
                      <OptionIcon icon={name} size="md" label={name} />
                    </button>
                  ))}
                </div>
              </div>

              {/* Names */}
              <div className="grid grid-cols-1 sm:grid-cols-3 gap-3">
                {(["fr", "en", "ar"] as const).map((l) => (
                  <label key={l} className="space-y-1">
                    <span className="font-semibold text-slate-600 dark:text-slate-400">Nom ({l.toUpperCase()}) *</span>
                    <input
                      required
                      dir={l === "ar" ? "rtl" : "ltr"}
                      className={inputCls}
                      value={form.name[l]}
                      onChange={(ev) => setForm({ ...form, name: { ...form.name, [l]: ev.target.value } })}
                    />
                  </label>
                ))}
              </div>

              <label className="space-y-1 block">
                <span className="font-semibold text-slate-600 dark:text-slate-400">Type de choix pour le client</span>
                <select className={inputCls} value={form.selectionMode}
                  onChange={(ev) => setForm({ ...form, selectionMode: ev.target.value as FormState["selectionMode"] })}>
                  <option value="quantity">Quantité (+ / −) — ex. siège bébé</option>
                  <option value="amount">Montant au choix (barre progressive) — ex. carburant 50 / 100 / 150 DT</option>
                </select>
              </label>

              {form.selectionMode === "amount" && (
                <div className="grid grid-cols-3 gap-3 p-3 rounded-xl bg-blue-50/60 dark:bg-blue-950/20 border border-blue-200/60 dark:border-blue-900/40">
                  <label className="space-y-1">
                    <span className="font-semibold text-slate-600 dark:text-slate-400">Minimum (TND)</span>
                    <input type="number" min={1} className={inputCls} value={form.amountMinTnd}
                      onChange={(ev) => setForm({ ...form, amountMinTnd: Number(ev.target.value) })} />
                  </label>
                  <label className="space-y-1">
                    <span className="font-semibold text-slate-600 dark:text-slate-400">Maximum (TND)</span>
                    <input type="number" min={1} className={inputCls} value={form.amountMaxTnd}
                      onChange={(ev) => setForm({ ...form, amountMaxTnd: Number(ev.target.value) })} />
                  </label>
                  <label className="space-y-1">
                    <span className="font-semibold text-slate-600 dark:text-slate-400">Palier (TND)</span>
                    <input type="number" min={1} className={inputCls} value={form.amountStepTnd}
                      onChange={(ev) => setForm({ ...form, amountStepTnd: Number(ev.target.value) })} />
                  </label>
                  <p className="col-span-3 text-[11px] text-slate-500">
                    Le client choisit {form.amountMinTnd} → {form.amountMaxTnd} TND par paliers de {form.amountStepTnd} TND. Le prix ci-dessous est ignoré.
                  </p>
                </div>
              )}

              <div className="grid grid-cols-2 sm:grid-cols-4 gap-3">
                <label className="space-y-1 col-span-2 sm:col-span-1">
                  <span className="font-semibold text-slate-600 dark:text-slate-400">Prix (TND)</span>
                  <input type="number" min={0} step="0.1" className={inputCls} value={form.priceTnd}
                    onChange={(ev) => setForm({ ...form, priceTnd: Number(ev.target.value) })} />
                </label>
                <label className="space-y-1 col-span-2 sm:col-span-1">
                  <span className="font-semibold text-slate-600 dark:text-slate-400">Facturation</span>
                  <select className={inputCls} value={form.pricingType}
                    onChange={(ev) => setForm({ ...form, pricingType: ev.target.value as PricingType })}>
                    {(Object.keys(PRICING_LABELS) as PricingType[]).map((p) => (
                      <option key={p} value={p}>{PRICING_LABELS[p]}</option>
                    ))}
                  </select>
                </label>
                <label className="space-y-1">
                  <span className="font-semibold text-slate-600 dark:text-slate-400">Qté max</span>
                  <input type="number" min={1} max={20} className={inputCls} value={form.maxQuantity}
                    onChange={(ev) => setForm({ ...form, maxQuantity: Number(ev.target.value) })} />
                </label>
                <label className="space-y-1">
                  <span className="font-semibold text-slate-600 dark:text-slate-400">Ordre</span>
                  <input type="number" min={0} className={inputCls} value={form.order}
                    onChange={(ev) => setForm({ ...form, order: Number(ev.target.value) })} />
                </label>
              </div>

              <label className="flex items-center gap-2 cursor-pointer">
                <input type="checkbox" className="w-4 h-4 accent-blue-600" checked={form.isActive}
                  onChange={(ev) => setForm({ ...form, isActive: ev.target.checked })} />
                <span className="font-semibold text-slate-700 dark:text-slate-300">Visible dans le parcours de réservation</span>
              </label>
            </div>

            <div className="flex justify-end gap-3 px-5 py-4 border-t border-slate-200 dark:border-slate-700 bg-slate-50 dark:bg-slate-900/50 rounded-b-2xl">
              <button type="button" onClick={closeForm} className="px-4 py-2 rounded-xl border border-slate-200 dark:border-slate-700 text-xs font-semibold text-slate-600 dark:text-slate-300">
                Annuler
              </button>
              <button type="submit" disabled={saving || uploading} className="inline-flex items-center gap-2 px-5 py-2 rounded-xl bg-blue-600 hover:bg-blue-500 text-white text-xs font-semibold disabled:opacity-60">
                {saving ? <Loader2 className="w-3.5 h-3.5 animate-spin" /> : <Save className="w-3.5 h-3.5" />}
                Enregistrer
              </button>
            </div>
          </form>
        </div>
      )}
      <QuickView
        open={Boolean(viewing)}
        onClose={() => setViewing(null)}
        title={viewing?.name.fr}
        subtitle={viewing ? priceLabel(viewing) : ""}
        footer={
          viewing &&
          can("options.edit") && (
            <button
              type="button"
              className={`${btn.base} ${btn.primary}`}
              onClick={() => {
                const e = viewing;
                setViewing(null);
                openEdit(e);
              }}
            >
              Voir & modifier
            </button>
          )
        }
      >
        {viewing && (
          <>
            <div className="flex justify-center">
              <OptionIcon icon={viewing.icon} size="lg" />
            </div>
            <Section title="Noms">
              <Field label="Français">{viewing.name.fr}</Field>
              <Field label="English">{viewing.name.en}</Field>
              <Field label="العربية">{viewing.name.ar}</Field>
            </Section>
            <Section title="Tarification">
              <Field label="Prix">{priceLabel(viewing)}</Field>
              <Field label="Choix client">{viewing.selectionMode === "amount" ? "Montant au choix" : `Quantité, max ${viewing.maxQuantity}`}</Field>
              <Field label="Visibilité">{viewing.isActive ? "Visible sur le site" : "Masquée"}</Field>
            </Section>
            {viewing.description?.fr && (
              <Section title="Description">
                <p>{viewing.description.fr}</p>
              </Section>
            )}
          </>
        )}
      </QuickView>
    </div>
  );
}
