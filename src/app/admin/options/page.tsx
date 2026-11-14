"use client";

import React, { useCallback, useEffect, useState } from "react";
import { Plus, Pencil, Trash2, X, Save, Upload, Loader2, Eye, EyeOff, AlertCircle } from "lucide-react";
import { OptionIcon, OPTION_ICON_CHOICES } from "@/components/ui/OptionIcon";

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
};

const PRICING_LABELS: Record<PricingType, string> = {
  per_day: "Par jour",
  per_rental: "Forfait (une fois)",
  per_unit: "Par unité",
};

const inputCls =
  "w-full rounded-lg bg-white dark:bg-slate-800 border border-slate-300 dark:border-slate-600 px-3 py-2 text-xs text-slate-800 dark:text-white focus:outline-none focus:border-blue-500";

export default function AdminOptionsPage() {
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
    await fetch("/api/admin/extras", {
      method: "PUT",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        id: e._id,
        name: e.name,
        description: e.description,
        icon: e.icon,
        iconPublicId: e.iconPublicId || "",
        priceTnd: e.price / 100,
        pricingType: e.pricingType,
        maxQuantity: e.maxQuantity || 1,
        order: e.order || 0,
        isActive: !e.isActive,
      }),
    });
    await load();
  };

  return (
    <div className="space-y-6">
      <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4">
        <div>
          <h1 className="text-2xl sm:text-3xl font-extrabold text-slate-900 dark:text-white tracking-tight">
            Options & Équipements
          </h1>
          <p className="text-xs sm:text-sm text-slate-500 dark:text-slate-400 mt-1">
            Options proposées à l&apos;étape 3 de la réservation (icône, prix, mode de facturation).
          </p>
        </div>
        <button
          onClick={openNew}
          className="inline-flex items-center justify-center gap-2 px-4 py-2.5 rounded-xl bg-blue-600 hover:bg-blue-500 text-white text-xs font-semibold shadow-lg shadow-blue-600/25"
        >
          <Plus className="w-4 h-4" />
          Nouvelle option
        </button>
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
                  {e.price === 0 ? "Offert" : `${(e.price / 100).toLocaleString("fr-FR")} TND`}
                  <span className="text-slate-400 font-normal"> · {PRICING_LABELS[e.pricingType]} · max {e.maxQuantity}</span>
                </p>
                {!e.isActive && <p className="text-[10px] font-bold uppercase text-amber-600">Masquée</p>}
              </div>
              <div className="flex flex-col gap-1.5 shrink-0">
                <button onClick={() => openEdit(e)} aria-label={`Modifier ${e.name.fr}`} className="p-2 rounded-lg bg-slate-100 dark:bg-slate-800 hover:bg-blue-50 dark:hover:bg-blue-900/30 text-slate-600 dark:text-slate-300">
                  <Pencil className="w-3.5 h-3.5" />
                </button>
                <button onClick={() => toggleActive(e)} aria-label={e.isActive ? `Masquer ${e.name.fr}` : `Afficher ${e.name.fr}`} className="p-2 rounded-lg bg-slate-100 dark:bg-slate-800 hover:bg-amber-50 dark:hover:bg-amber-900/30 text-slate-600 dark:text-slate-300">
                  {e.isActive ? <EyeOff className="w-3.5 h-3.5" /> : <Eye className="w-3.5 h-3.5" />}
                </button>
                <button onClick={() => remove(e)} aria-label={`Supprimer ${e.name.fr}`} className="p-2 rounded-lg bg-slate-100 dark:bg-slate-800 hover:bg-red-50 dark:hover:bg-red-900/30 text-slate-500 hover:text-red-500">
                  <Trash2 className="w-3.5 h-3.5" />
                </button>
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
    </div>
  );
}
