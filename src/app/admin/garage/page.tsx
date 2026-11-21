"use client";

import { Suspense, useEffect, useMemo, useState } from "react";
import { useRouter, useSearchParams } from "next/navigation";
import {
  Wrench,
  Droplets,
  ClipboardCheck,
  Search,
  RefreshCw,
  Gauge,
  CalendarClock,
  ShieldAlert,
  CheckCircle2,
  AlertTriangle,
  X,
  Plus,
  History,
  Loader2,
  Settings2,
} from "lucide-react";
import { useAdminLang } from "@/contexts/AdminLangContext";
import { InsurancePanel } from "@/components/admin/InsurancePanel";
import { ViewToggle, useViewMode } from "@/components/admin/ui";

type State = "ok" | "soon" | "overdue" | "unknown";

interface HistoryItem {
  _id: string;
  type: string;
  description: string;
  status: string;
  startDate: string;
  endDate: string | null;
  cost: number;
  provider: string;
  mileage: number | null;
}

interface GarageUnit {
  vehicleId: string;
  unitId: string;
  brand: string;
  model: string;
  year: number;
  category: string;
  image: string;
  licensePlate: string;
  label: string;
  status: "active" | "maintenance" | "out_of_service";
  mileage: number;
  lastVidangeMileage: number;
  lastVidangeDate: string | null;
  vidangeInterval: number;
  nextVidangeMileage: number;
  remainingKm: number;
  percentUsed: number;
  vidangeState: State;
  technicalInspectionDate: string | null;
  inspectionDays: number | null;
  inspectionState: State;
  insuranceExpiryDate: string | null;
  insuranceDays: number | null;
  insuranceState: State;
  nextMaintenanceDate: string | null;
  maintenanceDays: number | null;
  openMaintenance: number;
  notes: string;
  history: HistoryItem[];
}

interface Stats {
  total: number;
  inGarage: number;
  vidange: { overdue: number; soon: number };
  inspection: { overdue: number; soon: number; unknown: number };
  maintenance: { open: number; dueSoon: number };
}

interface AlertSettings {
  vidangeKmThreshold: number;
  inspectionDaysThreshold: number;
  insuranceDaysThreshold: number;
  enabled: Record<string, boolean>;
}

type Tab = "vidange" | "maintenance" | "inspection" | "assurance";
type Modal =
  | { kind: "vidange"; unit: GarageUnit }
  | { kind: "inspection"; unit: GarageUnit }
  | { kind: "maintenance"; unit: GarageUnit }
  | { kind: "edit"; unit: GarageUnit }
  | { kind: "history"; unit: GarageUnit }
  | { kind: "settings" }
  | null;

const TYPE_LABEL: Record<string, string> = {
  vidange: "Vidange",
  technical_inspection: "Visite technique",
  scheduled: "Entretien programmé",
  unscheduled: "Intervention imprévue",
  repair: "Réparation",
  tyres: "Pneumatiques",
  bodywork: "Carrosserie",
  inspection: "Contrôle",
};

const STATUS_LABEL: Record<string, string> = {
  scheduled: "Planifié",
  in_progress: "En cours",
  completed: "Terminé",
  cancelled: "Annulé",
};

const stateClass: Record<State, string> = {
  ok: "bg-emerald-50 text-emerald-700 border-emerald-200 dark:bg-emerald-500/10 dark:text-emerald-300 dark:border-emerald-500/30",
  soon: "bg-amber-50 text-amber-700 border-amber-200 dark:bg-amber-500/10 dark:text-amber-300 dark:border-amber-500/30",
  overdue: "bg-red-50 text-red-700 border-red-200 dark:bg-red-500/10 dark:text-red-300 dark:border-red-500/30",
  unknown: "bg-slate-50 text-slate-600 border-slate-200 dark:bg-slate-800 dark:text-slate-300 dark:border-slate-700",
};

const inputCls =
  "w-full h-10 px-3 rounded-xl border border-slate-200 dark:border-slate-700 bg-slate-50 dark:bg-slate-900 text-xs font-semibold text-slate-900 dark:text-white outline-none focus:ring-2 focus:ring-blue-500";
const btn = "inline-flex items-center justify-center gap-1.5 px-3 py-2 rounded-xl text-xs font-bold transition-all disabled:opacity-50";

const fmtKm = (n: number) => `${Math.round(n).toLocaleString("fr-FR")} km`;
const fmtDate = (d: string | null) => (d ? new Date(d).toLocaleDateString("fr-FR") : "—");
const isoDay = (d: string | null) => (d ? new Date(d).toISOString().slice(0, 10) : "");

/** Each garage section has its own page (sidebar links), title and indicators. */
const SECTIONS: Record<Tab, { title: string; titleEn: string; text: string }> = {
  vidange: { title: "Vidange", titleEn: "Oil change", text: "Kilométrage, prochaine vidange et intervalle de chaque voiture. Une alerte part quand le seuil de kilomètres est atteint." },
  maintenance: { title: "Maintenance", titleEn: "Maintenance", text: "Voitures au garage, interventions en cours et entretiens planifiés, avec l'historique et les coûts." },
  inspection: { title: "Visite technique", titleEn: "Technical inspection", text: "Date de la prochaine visite technique de chaque voiture. Alertes avant l'échéance et à l'expiration." },
  assurance: { title: "Assurance", titleEn: "Insurance", text: "Contrats d'assurance par voiture : compagnie, police, échéance, coût et pièce jointe. Alertes à 90, 60 et 30 jours." },
};

export default function GaragePage() {
  return (
    <Suspense fallback={null}>
      <Garage />
    </Suspense>
  );
}

function Garage() {
  const { lang } = useAdminLang();
  const en = lang === "en";

  const [units, setUnits] = useState<GarageUnit[]>([]);
  const [stats, setStats] = useState<Stats | null>(null);
  const [settings, setSettings] = useState<AlertSettings | null>(null);
  const [loading, setLoading] = useState(true);
  // The section comes from the URL (sidebar links); switching updates the URL.
  const searchParams = useSearchParams();
  const router = useRouter();
  const urlTab = searchParams.get("tab");
  const tab: Tab = urlTab === "maintenance" || urlTab === "inspection" || urlTab === "assurance" ? urlTab : "vidange";
  const setTab = (t: Tab) => router.replace(`/admin/garage?tab=${t}`, { scroll: false });
  const [view, setView] = useViewMode("garage", "grid");
  const [search, setSearch] = useState("");
  const [onlyAttention, setOnlyAttention] = useState(false);
  const [focusUnit, setFocusUnit] = useState<string | null>(null);
  const [modal, setModal] = useState<Modal>(null);
  const [saving, setSaving] = useState(false);
  const [toast, setToast] = useState<{ ok: boolean; text: string } | null>(null);

  const load = async () => {
    setLoading(true);
    try {
      const res = await fetch("/api/admin/garage", { cache: "no-store" });
      const data = await res.json();
      if (data.success) {
        setUnits(data.units);
        setStats(data.stats);
        setSettings(data.settings);
      } else {
        notify(false, data.error || "Erreur de chargement");
      }
    } catch {
      notify(false, "Erreur réseau");
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    // Deep links from notifications: /admin/garage?tab=inspection&unit=<id>
    const params = new URLSearchParams(window.location.search);
    setFocusUnit(params.get("unit"));
    load();
  }, []);

  const notify = (ok: boolean, text: string) => {
    setToast({ ok, text });
    setTimeout(() => setToast(null), 3500);
  };

  const send = async (body: Record<string, unknown>, okText: string, url = "/api/admin/garage", method = "PATCH") => {
    setSaving(true);
    try {
      const res = await fetch(url, { method, headers: { "Content-Type": "application/json" }, body: JSON.stringify(body) });
      const data = await res.json().catch(() => ({}));
      if (!res.ok || data.success === false) throw new Error(data.error || "Échec");
      notify(true, okText);
      setModal(null);
      await load();
    } catch (e) {
      notify(false, e instanceof Error ? e.message : "Erreur");
    } finally {
      setSaving(false);
    }
  };

  const filtered = useMemo(() => {
    const q = search.trim().toLowerCase();
    let list = units.filter(
      (u) => !q || `${u.licensePlate} ${u.brand} ${u.model}`.toLowerCase().includes(q)
    );
    if (focusUnit) list = list.filter((u) => u.unitId === focusUnit);
    if (onlyAttention) {
      list = list.filter((u) =>
        tab === "vidange"
          ? u.vidangeState !== "ok"
          : tab === "inspection"
          ? u.inspectionState !== "ok"
          : u.openMaintenance > 0 || u.status === "maintenance" || (u.maintenanceDays !== null && u.maintenanceDays <= 7)
      );
    }
    const rank = (u: GarageUnit) =>
      tab === "vidange"
        ? u.remainingKm
        : tab === "inspection"
        ? u.inspectionDays ?? -1
        : -(u.openMaintenance * 1000) + (u.maintenanceDays ?? 9999);
    return [...list].sort((a, b) => rank(a) - rank(b));
  }, [units, search, onlyAttention, tab, focusUnit]);

  const count = (f: (u: GarageUnit) => boolean) => units.filter(f).length;
  const sectionKpis: { label: string; value: number; cls: string; hint?: string; attention?: boolean }[] =
    tab === "vidange"
      ? [
          { label: "Voitures suivies", value: units.length, cls: "text-slate-900 dark:text-white" },
          { label: "Vidange dépassée", value: count((u) => u.vidangeState === "overdue"), cls: "text-red-600", attention: true },
          { label: "Bientôt", value: count((u) => u.vidangeState === "soon"), cls: "text-amber-600", hint: settings ? `moins de ${fmtKm(settings.vidangeKmThreshold)}` : undefined, attention: true },
          { label: "À jour", value: count((u) => u.vidangeState === "ok"), cls: "text-emerald-600" },
        ]
      : tab === "inspection"
        ? [
            { label: "Visite expirée", value: count((u) => u.inspectionState === "overdue"), cls: "text-red-600", attention: true },
            { label: "Bientôt", value: count((u) => u.inspectionState === "soon"), cls: "text-amber-600", hint: settings ? `moins de ${settings.inspectionDaysThreshold} jours` : undefined, attention: true },
            { label: "Date non renseignée", value: count((u) => u.inspectionState === "unknown"), cls: "text-slate-500", attention: true },
            { label: "À jour", value: count((u) => u.inspectionState === "ok"), cls: "text-emerald-600" },
          ]
        : [
            { label: "Au garage", value: count((u) => u.status === "maintenance"), cls: "text-blue-600", attention: true },
            { label: "Hors service", value: count((u) => u.status === "out_of_service"), cls: "text-slate-500" },
            { label: "Interventions ouvertes", value: units.reduce((a, u) => a + (u.openMaintenance || 0), 0), cls: "text-amber-600", attention: true },
            { label: "Entretien sous 7 jours", value: count((u) => u.maintenanceDays !== null && u.maintenanceDays <= 7), cls: "text-red-600", attention: true },
          ];
  const SectionIcon = tab === "vidange" ? Droplets : tab === "inspection" ? ClipboardCheck : tab === "assurance" ? ShieldAlert : Wrench;

  const tabs: { id: Tab; label: string; icon: typeof Wrench; badge: number }[] = [
    { id: "vidange", label: "Vidange", icon: Droplets, badge: (stats?.vidange.overdue || 0) + (stats?.vidange.soon || 0) },
    { id: "maintenance", label: "Maintenance", icon: Wrench, badge: (stats?.maintenance.open || 0) + (stats?.maintenance.dueSoon || 0) },
    { id: "inspection", label: en ? "Technical inspection" : "Visite technique", icon: ClipboardCheck, badge: (stats?.inspection.overdue || 0) + (stats?.inspection.soon || 0) },
    { id: "assurance", label: en ? "Insurance" : "Assurance", icon: ShieldAlert, badge: 0 },
  ];

  return (
    <div className="max-w-7xl mx-auto space-y-6 pb-16">
      {toast && (
        <div
          className={`fixed top-20 right-4 z-[60] px-4 py-3 rounded-2xl shadow-xl text-xs font-semibold flex items-center gap-2 text-white ${
            toast.ok ? "bg-emerald-600" : "bg-red-600"
          }`}
        >
          {toast.ok ? <CheckCircle2 className="w-4 h-4" /> : <AlertTriangle className="w-4 h-4" />}
          {toast.text}
        </div>
      )}

      {/* Header */}
      <div className="flex flex-col sm:flex-row sm:items-end justify-between gap-4">
        <div>
          <h1 className="text-2xl font-black text-slate-900 dark:text-white flex items-center gap-2">
            <SectionIcon className="w-6 h-6 text-blue-600" />
            <span className="text-slate-400 font-bold text-lg">Garage ·</span> {en ? SECTIONS[tab].titleEn : SECTIONS[tab].title}
          </h1>
          <p className="text-xs text-slate-500 dark:text-slate-400 mt-1 max-w-2xl">{SECTIONS[tab].text}</p>
        </div>
        <div className="flex gap-2">
          <button type="button" onClick={() => setModal({ kind: "settings" })} className={`${btn} border border-slate-200 dark:border-slate-700 text-slate-700 dark:text-slate-200`}>
            <Settings2 className="w-4 h-4" /> {en ? "Alert thresholds" : "Seuils d'alerte"}
          </button>
          <button type="button" onClick={load} className={`${btn} bg-blue-600 hover:bg-blue-500 text-white`}>
            <RefreshCw className={`w-4 h-4 ${loading ? "animate-spin" : ""}`} /> {en ? "Refresh" : "Actualiser"}
          </button>
        </div>
      </div>

      {/* Indicators of the current section */}
      {stats && tab !== "assurance" && (
        <div className="grid grid-cols-2 lg:grid-cols-4 gap-3">
          {sectionKpis.map((k) => (
            <button
              key={k.label}
              type="button"
              onClick={() => k.attention && setOnlyAttention(true)}
              className={`text-left p-4 rounded-2xl bg-white dark:bg-[#0f141f] border ${k.value > 0 && k.attention ? "border-amber-300 dark:border-amber-800" : "border-slate-200 dark:border-slate-800"}`}
            >
              <p className="text-[11px] font-semibold text-slate-500 uppercase tracking-wide">{k.label}</p>
              <p className={`text-2xl font-black mt-1 ${k.cls}`}>{k.value}</p>
              {k.hint && <p className="text-[11px] text-slate-500 mt-0.5">{k.hint}</p>}
            </button>
          ))}
        </div>
      )}

      {/* Tabs */}
      <div className="flex gap-2 overflow-x-auto pb-1">
        {tabs.map((t) => (
          <button
            key={t.id}
            type="button"
            onClick={() => setTab(t.id)}
            className={`${btn} px-4 py-2.5 whitespace-nowrap ${
              tab === t.id
                ? "bg-slate-900 text-white dark:bg-white dark:text-slate-900"
                : "bg-white dark:bg-[#0f141f] border border-slate-200 dark:border-slate-800 text-slate-600 dark:text-slate-300"
            }`}
          >
            <t.icon className="w-4 h-4" />
            {t.label}
            {t.badge > 0 && <span className="ml-1 px-1.5 py-0.5 rounded-full bg-red-500 text-white text-[10px]">{t.badge}</span>}
          </button>
        ))}
      </div>

      {tab === "assurance" ? (
        <InsurancePanel focusUnit={focusUnit} />
      ) : (
        <>
      {/* Filters */}
      <div className="flex flex-col sm:flex-row gap-2">
        <div className="relative flex-1">
          <Search className="w-4 h-4 absolute left-3 top-1/2 -translate-y-1/2 text-slate-400" />
          <input
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            placeholder={en ? "Search plate, brand, model…" : "Rechercher immatriculation, marque, modèle…"}
            className={`${inputCls} pl-9`}
          />
        </div>
        <label className="inline-flex items-center gap-2 text-xs font-semibold text-slate-600 dark:text-slate-300 px-2">
          <input type="checkbox" checked={onlyAttention} onChange={(e) => setOnlyAttention(e.target.checked)} />
          {en ? "Needs attention only" : "À traiter uniquement"}
        </label>
        <ViewToggle value={view} onChange={setView} />
        {focusUnit && (
          <button type="button" onClick={() => setFocusUnit(null)} className={`${btn} border border-slate-200 dark:border-slate-700`}>
            <X className="w-3.5 h-3.5" /> {en ? "Show all" : "Tout afficher"}
          </button>
        )}
      </div>

      {/* List */}
      {loading && units.length === 0 ? (
        <div className="py-20 flex justify-center text-slate-400">
          <Loader2 className="w-6 h-6 animate-spin" />
        </div>
      ) : filtered.length === 0 ? (
        <div className="py-16 text-center text-sm text-slate-500">{en ? "Nothing to show." : "Aucun véhicule à afficher."}</div>
      ) : view === "table" ? (
        <div className="rounded-2xl bg-white dark:bg-[#0f141f] border border-slate-200 dark:border-slate-800 overflow-x-auto">
          <table className="w-full text-xs min-w-[760px]">
            <thead>
              <tr className="text-left text-[11px] uppercase tracking-wide text-slate-500 border-b border-slate-100 dark:border-slate-800">
                <th className="p-3">Véhicule</th>
                <th className="p-3">Statut</th>
                <th className="p-3">Km</th>
                {tab === "vidange" && <th className="p-3">Prochaine vidange</th>}
                {tab === "vidange" && <th className="p-3">Reste</th>}
                {tab === "inspection" && <th className="p-3">Visite technique</th>}
                {tab === "maintenance" && <th className="p-3">Prochain entretien</th>}
                {tab === "maintenance" && <th className="p-3">Interventions ouvertes</th>}
                <th className="p-3 text-right">Actions</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-slate-100 dark:divide-slate-800">
              {filtered.map((u) => (
                <tr key={u.unitId} className="hover:bg-slate-50 dark:hover:bg-slate-900/50">
                  <td className="p-3">
                    <span className="block font-mono font-bold text-slate-900 dark:text-white">{u.label}</span>
                    <span className="block text-slate-500">{u.brand} {u.model}</span>
                  </td>
                  <td className="p-3">{u.status === "active" ? "En service" : u.status === "maintenance" ? "Au garage" : "Hors service"}</td>
                  <td className="p-3 whitespace-nowrap">{fmtKm(u.mileage)}</td>
                  {tab === "vidange" && <td className="p-3 whitespace-nowrap">{fmtKm(u.nextVidangeMileage)}</td>}
                  {tab === "vidange" && (
                    <td className="p-3">
                      <StatePill state={u.vidangeState}>{u.remainingKm <= 0 ? `Dépassée de ${fmtKm(-u.remainingKm)}` : fmtKm(u.remainingKm)}</StatePill>
                    </td>
                  )}
                  {tab === "inspection" && (
                    <td className="p-3">
                      <StatePill state={u.inspectionState}>{u.inspectionDays === null ? "Non renseignée" : `${fmtDate(u.technicalInspectionDate)} · ${u.inspectionDays} j`}</StatePill>
                    </td>
                  )}
                  {tab === "maintenance" && <td className="p-3">{u.nextMaintenanceDate ? fmtDate(u.nextMaintenanceDate) : "Non planifié"}</td>}
                  {tab === "maintenance" && <td className="p-3 font-bold">{u.openMaintenance}</td>}
                  <td className="p-3">
                    <div className="flex justify-end gap-1.5">
                      <button
                        type="button"
                        onClick={() => setModal({ kind: tab === "vidange" ? "vidange" : tab === "inspection" ? "inspection" : "maintenance", unit: u })}
                        className={`${btn} bg-blue-600 hover:bg-blue-500 text-white`}
                      >
                        {tab === "maintenance" ? "Intervention" : "Faite"}
                      </button>
                      <button type="button" onClick={() => setModal({ kind: "edit", unit: u })} className={`${btn} border border-slate-200 dark:border-slate-700`}>
                        Modifier
                      </button>
                      <button type="button" onClick={() => setModal({ kind: "history", unit: u })} className={`${btn} border border-slate-200 dark:border-slate-700`}>
                        Historique
                      </button>
                    </div>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      ) : (
        <div className="grid grid-cols-1 md:grid-cols-2 xl:grid-cols-3 gap-4">
          {filtered.map((u) => (
            <UnitCard key={u.unitId} u={u} tab={tab} onOpen={setModal} />
          ))}
        </div>
      )}

        </>
      )}

      {modal && (
        <GarageModal
          modal={modal}
          settings={settings}
          saving={saving}
          onClose={() => setModal(null)}
          onSend={send}
        />
      )}
    </div>
  );
}

function StatePill({ state, children }: { state: State; children: React.ReactNode }) {
  return <span className={`inline-flex items-center gap-1 px-2 py-0.5 rounded-full border text-[10px] font-bold ${stateClass[state]}`}>{children}</span>;
}

function UnitCard({ u, tab, onOpen }: { u: GarageUnit; tab: Tab; onOpen: (m: Modal) => void }) {
  const barColor = u.vidangeState === "overdue" ? "bg-red-500" : u.vidangeState === "soon" ? "bg-amber-500" : "bg-emerald-500";
  return (
    <div className="rounded-2xl bg-white dark:bg-[#0f141f] border border-slate-200 dark:border-slate-800 p-4 flex flex-col gap-3">
      <div className="flex items-start justify-between gap-2">
        <div className="min-w-0">
          <p className="font-mono font-black text-sm tracking-wider text-slate-900 dark:text-white truncate">{u.label}</p>
          <p className="text-xs text-slate-500 truncate">
            {u.brand} {u.model} · {u.year}
          </p>
        </div>
        <span
          className={`text-[10px] font-bold px-2 py-1 rounded-full shrink-0 ${
            u.status === "active"
              ? "bg-emerald-100 text-emerald-700 dark:bg-emerald-500/15 dark:text-emerald-300"
              : u.status === "maintenance"
              ? "bg-blue-100 text-blue-700 dark:bg-blue-500/15 dark:text-blue-300"
              : "bg-slate-200 text-slate-600 dark:bg-slate-700 dark:text-slate-300"
          }`}
        >
          {u.status === "active" ? "En service" : u.status === "maintenance" ? "Au garage" : "Hors service"}
        </span>
      </div>

      <div className="flex items-center gap-2 text-xs text-slate-600 dark:text-slate-300">
        <Gauge className="w-4 h-4 text-blue-500" /> {fmtKm(u.mileage)}
      </div>

      {tab === "vidange" && (
        <div className="space-y-2">
          <div className="flex items-center justify-between text-xs">
            <StatePill state={u.vidangeState}>
              {u.vidangeState === "overdue"
                ? `Dépassée de ${fmtKm(-u.remainingKm)}`
                : `Vidange dans ${fmtKm(u.remainingKm)}`}
            </StatePill>
            <span className="text-slate-400">à {fmtKm(u.nextVidangeMileage)}</span>
          </div>
          <div className="h-2 rounded-full bg-slate-100 dark:bg-slate-800 overflow-hidden">
            <div className={`h-full ${barColor}`} style={{ width: `${u.percentUsed}%` }} />
          </div>
          <p className="text-[11px] text-slate-500">
            Dernière : {fmtKm(u.lastVidangeMileage)}
            {u.lastVidangeDate ? ` le ${fmtDate(u.lastVidangeDate)}` : ""} · intervalle {fmtKm(u.vidangeInterval)}
          </p>
        </div>
      )}

      {tab === "inspection" && (
        <div className="space-y-1.5 text-xs">
          <div className="flex items-center justify-between">
            <span className="text-slate-500">Visite technique</span>
            <StatePill state={u.inspectionState}>
              {u.inspectionDays === null
                ? "Date non renseignée"
                : u.inspectionDays < 0
                ? `Expirée (${fmtDate(u.technicalInspectionDate)})`
                : `${fmtDate(u.technicalInspectionDate)} · ${u.inspectionDays} j`}
            </StatePill>
          </div>
        </div>
      )}

      {tab === "maintenance" && (
        <div className="space-y-1.5 text-xs">
          <div className="flex items-center justify-between">
            <span className="text-slate-500">Prochain entretien</span>
            <StatePill state={u.maintenanceDays === null ? "unknown" : u.maintenanceDays < 0 ? "overdue" : u.maintenanceDays <= 7 ? "soon" : "ok"}>
              {u.nextMaintenanceDate ? fmtDate(u.nextMaintenanceDate) : "Non planifié"}
            </StatePill>
          </div>
          <div className="flex items-center justify-between">
            <span className="text-slate-500">Interventions ouvertes</span>
            <span className="font-bold">{u.openMaintenance}</span>
          </div>
          {u.history[0] && (
            <p className="text-[11px] text-slate-500 truncate">
              Dernière : {TYPE_LABEL[u.history[0].type] || u.history[0].type} — {fmtDate(u.history[0].startDate)}
            </p>
          )}
        </div>
      )}

      <div className="mt-auto grid grid-cols-3 gap-1.5 pt-2 border-t border-slate-100 dark:border-slate-800">
        {tab === "vidange" && (
          <button type="button" onClick={() => onOpen({ kind: "vidange", unit: u })} className={`${btn} bg-blue-600 hover:bg-blue-500 text-white col-span-1`}>
            <Droplets className="w-3.5 h-3.5" /> Faite
          </button>
        )}
        {tab === "inspection" && (
          <button type="button" onClick={() => onOpen({ kind: "inspection", unit: u })} className={`${btn} bg-blue-600 hover:bg-blue-500 text-white`}>
            <ClipboardCheck className="w-3.5 h-3.5" /> Faite
          </button>
        )}
        {tab === "maintenance" && (
          <button type="button" onClick={() => onOpen({ kind: "maintenance", unit: u })} className={`${btn} bg-blue-600 hover:bg-blue-500 text-white`}>
            <Plus className="w-3.5 h-3.5" /> Intervention
          </button>
        )}
        <button type="button" onClick={() => onOpen({ kind: "edit", unit: u })} className={`${btn} border border-slate-200 dark:border-slate-700 text-slate-700 dark:text-slate-200`}>
          <CalendarClock className="w-3.5 h-3.5" /> Modifier
        </button>
        <button type="button" onClick={() => onOpen({ kind: "history", unit: u })} className={`${btn} border border-slate-200 dark:border-slate-700 text-slate-700 dark:text-slate-200`}>
          <History className="w-3.5 h-3.5" /> Historique
        </button>
      </div>
    </div>
  );
}

function Field({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <label className="block space-y-1">
      <span className="text-[11px] font-semibold text-slate-600 dark:text-slate-300">{label}</span>
      {children}
    </label>
  );
}

function GarageModal({
  modal,
  settings,
  saving,
  onClose,
  onSend,
}: {
  modal: NonNullable<Modal>;
  settings: AlertSettings | null;
  saving: boolean;
  onClose: () => void;
  onSend: (body: Record<string, unknown>, okText: string, url?: string, method?: string) => void;
}) {
  const u = "unit" in modal ? modal.unit : null;
  const [f, setF] = useState<Record<string, string | boolean>>((): Record<string, string | boolean> => {
    if (modal.kind === "settings" && settings) {
      return {
        vidangeKmThreshold: String(settings.vidangeKmThreshold),
        inspectionDaysThreshold: String(settings.inspectionDaysThreshold),
        insuranceDaysThreshold: String(settings.insuranceDaysThreshold),
        ...Object.fromEntries(Object.entries(settings.enabled).map(([k, v]) => [`en_${k}`, v])),
      };
    }
    if (!u) return {};
    return {
      mileage: String(u.mileage),
      date: new Date().toISOString().slice(0, 10),
      nextDate: (() => {
        const d = new Date();
        d.setFullYear(d.getFullYear() + 1);
        return d.toISOString().slice(0, 10);
      })(),
      cost: "",
      provider: "",
      notes: "",
      type: "repair",
      description: "",
      status: "scheduled",
      immobilize: false,
      vidangeInterval: String(u.vidangeInterval),
      lastVidangeMileage: String(u.lastVidangeMileage),
      technicalInspectionDate: isoDay(u.technicalInspectionDate),
      insuranceExpiryDate: isoDay(u.insuranceExpiryDate),
      nextMaintenanceDate: isoDay(u.nextMaintenanceDate),
      unitStatus: u.status,
      unitNotes: u.notes,
    };
  });
  const set = (k: string) => (e: React.ChangeEvent<HTMLInputElement | HTMLSelectElement | HTMLTextAreaElement>) =>
    setF((p) => ({ ...p, [k]: e.target.type === "checkbox" ? (e.target as HTMLInputElement).checked : e.target.value }));
  const num = (k: string) => (String(f[k] ?? "").trim() === "" ? undefined : Number(f[k]));
  const ids = u ? { vehicleId: u.vehicleId, unitId: u.unitId } : {};

  const title =
    modal.kind === "vidange"
      ? "Vidange effectuée"
      : modal.kind === "inspection"
      ? "Visite technique effectuée"
      : modal.kind === "maintenance"
      ? "Nouvelle intervention"
      : modal.kind === "edit"
      ? "Modifier le suivi"
      : modal.kind === "history"
      ? "Historique d'entretien"
      : "Seuils des alertes";

  const submit = () => {
    if (modal.kind === "vidange") {
      onSend({ action: "vidange_done", ...ids, mileage: num("mileage") ?? 0, date: f.date, cost: num("cost"), provider: f.provider || undefined, notes: f.notes || undefined }, "Vidange enregistrée");
    } else if (modal.kind === "inspection") {
      onSend({ action: "inspection_done", ...ids, date: f.date, nextDate: f.nextDate, cost: num("cost"), provider: f.provider || undefined, notes: f.notes || undefined }, "Visite technique enregistrée");
    } else if (modal.kind === "maintenance") {
      onSend(
        {
          action: "add_maintenance",
          ...ids,
          type: f.type,
          description: f.description,
          startDate: f.date,
          status: f.status,
          cost: num("cost"),
          provider: f.provider || undefined,
          mileage: num("mileage"),
          immobilize: Boolean(f.immobilize),
        },
        "Intervention enregistrée"
      );
    } else if (modal.kind === "edit") {
      onSend(
        {
          action: "update",
          ...ids,
          mileage: num("mileage"),
          vidangeInterval: num("vidangeInterval"),
          lastVidangeMileage: num("lastVidangeMileage"),
          technicalInspectionDate: f.technicalInspectionDate,
          insuranceExpiryDate: f.insuranceExpiryDate,
          nextMaintenanceDate: f.nextMaintenanceDate,
          status: f.unitStatus,
          notes: f.unitNotes,
        },
        "Suivi mis à jour"
      );
    } else if (modal.kind === "settings") {
      onSend(
        {
          vidangeKmThreshold: num("vidangeKmThreshold"),
          inspectionDaysThreshold: num("inspectionDaysThreshold"),
          insuranceDaysThreshold: num("insuranceDaysThreshold"),
          enabled: Object.fromEntries(
            Object.entries(f)
              .filter(([k]) => k.startsWith("en_"))
              .map(([k, v]) => [k.slice(3), Boolean(v)])
          ),
        },
        "Seuils enregistrés",
        "/api/admin/notifications/settings",
        "PUT"
      );
    }
  };

  const disabled =
    saving ||
    (modal.kind === "maintenance" && String(f.description || "").trim().length < 2) ||
    (modal.kind === "vidange" && num("mileage") === undefined);

  return (
    <div className="fixed inset-0 z-50 flex items-end sm:items-center justify-center bg-black/60 backdrop-blur-sm p-0 sm:p-4">
      <div className="w-full sm:max-w-lg max-h-[92vh] flex flex-col rounded-t-2xl sm:rounded-2xl bg-white dark:bg-[#0f141f] border border-slate-200 dark:border-slate-700 shadow-2xl text-xs">
        <div className="flex items-center justify-between p-5 pb-3 border-b border-slate-100 dark:border-slate-800">
          <div>
            <h3 className="text-sm font-bold text-slate-900 dark:text-white">{title}</h3>
            {u && (
              <p className="text-[11px] text-slate-500">
                <span className="font-mono font-bold">{u.label}</span> · {u.brand} {u.model}
              </p>
            )}
          </div>
          <button type="button" onClick={onClose} className="p-1 rounded-lg text-slate-400 hover:bg-slate-100 dark:hover:bg-slate-800">
            <X className="w-4 h-4" />
          </button>
        </div>

        <div className="p-5 space-y-3 overflow-y-auto flex-1">
          {modal.kind === "vidange" && (
            <>
              <div className="grid grid-cols-2 gap-3">
                <Field label="Kilométrage (km)">
                  <input type="number" className={inputCls} value={String(f.mileage)} onChange={set("mileage")} />
                </Field>
                <Field label="Date">
                  <input type="date" className={inputCls} value={String(f.date)} onChange={set("date")} />
                </Field>
              </div>
              <p className="text-[11px] text-slate-500">
                Prochaine vidange calculée : {fmtKm((num("mileage") || 0) + (u?.vidangeInterval || 10000))}
              </p>
              <div className="grid grid-cols-2 gap-3">
                <Field label="Coût (DT)">
                  <input type="number" className={inputCls} value={String(f.cost)} onChange={set("cost")} />
                </Field>
                <Field label="Garage / prestataire">
                  <input className={inputCls} value={String(f.provider)} onChange={set("provider")} />
                </Field>
              </div>
              <Field label="Remarques">
                <input className={inputCls} value={String(f.notes)} onChange={set("notes")} />
              </Field>
            </>
          )}

          {modal.kind === "inspection" && (
            <>
              <div className="grid grid-cols-2 gap-3">
                <Field label="Date de la visite">
                  <input type="date" className={inputCls} value={String(f.date)} onChange={set("date")} />
                </Field>
                <Field label="Prochaine échéance">
                  <input type="date" className={inputCls} value={String(f.nextDate)} onChange={set("nextDate")} />
                </Field>
              </div>
              <div className="grid grid-cols-2 gap-3">
                <Field label="Coût (DT)">
                  <input type="number" className={inputCls} value={String(f.cost)} onChange={set("cost")} />
                </Field>
                <Field label="Centre">
                  <input className={inputCls} value={String(f.provider)} onChange={set("provider")} />
                </Field>
              </div>
              <Field label="Remarques">
                <input className={inputCls} value={String(f.notes)} onChange={set("notes")} />
              </Field>
            </>
          )}

          {modal.kind === "maintenance" && (
            <>
              <div className="grid grid-cols-2 gap-3">
                <Field label="Type">
                  <select className={inputCls} value={String(f.type)} onChange={set("type")}>
                    {["repair", "scheduled", "unscheduled", "tyres", "bodywork", "inspection"].map((t) => (
                      <option key={t} value={t}>
                        {TYPE_LABEL[t]}
                      </option>
                    ))}
                  </select>
                </Field>
                <Field label="Statut">
                  <select className={inputCls} value={String(f.status)} onChange={set("status")}>
                    <option value="scheduled">Planifiée</option>
                    <option value="in_progress">En cours (véhicule immobilisé)</option>
                    <option value="completed">Terminée</option>
                  </select>
                </Field>
              </div>
              <Field label="Description">
                <input className={inputCls} value={String(f.description)} onChange={set("description")} placeholder="ex. Plaquettes de frein avant" />
              </Field>
              <div className="grid grid-cols-3 gap-3">
                <Field label="Date">
                  <input type="date" className={inputCls} value={String(f.date)} onChange={set("date")} />
                </Field>
                <Field label="Km">
                  <input type="number" className={inputCls} value={String(f.mileage)} onChange={set("mileage")} />
                </Field>
                <Field label="Coût (DT)">
                  <input type="number" className={inputCls} value={String(f.cost)} onChange={set("cost")} />
                </Field>
              </div>
              <Field label="Garage / prestataire">
                <input className={inputCls} value={String(f.provider)} onChange={set("provider")} />
              </Field>
              <label className="flex items-center gap-2 font-semibold text-slate-700 dark:text-slate-300">
                <input type="checkbox" checked={Boolean(f.immobilize)} onChange={set("immobilize")} />
                Immobiliser le véhicule (retiré de la location jusqu&apos;à la fin)
              </label>
            </>
          )}

          {modal.kind === "edit" && (
            <>
              <div className="grid grid-cols-2 gap-3">
                <Field label="Kilométrage actuel">
                  <input type="number" className={inputCls} value={String(f.mileage)} onChange={set("mileage")} />
                </Field>
                <Field label="Statut">
                  <select className={inputCls} value={String(f.unitStatus)} onChange={set("unitStatus")}>
                    <option value="active">En service</option>
                    <option value="maintenance">Au garage</option>
                    <option value="out_of_service">Hors service</option>
                  </select>
                </Field>
                <Field label="Dernière vidange (km)">
                  <input type="number" className={inputCls} value={String(f.lastVidangeMileage)} onChange={set("lastVidangeMileage")} />
                </Field>
                <Field label="Intervalle vidange (km)">
                  <input type="number" className={inputCls} value={String(f.vidangeInterval)} onChange={set("vidangeInterval")} />
                </Field>
                <Field label="Visite technique (échéance)">
                  <input type="date" className={inputCls} value={String(f.technicalInspectionDate)} onChange={set("technicalInspectionDate")} />
                </Field>
                <Field label="Assurance (échéance)">
                  <input type="date" className={inputCls} value={String(f.insuranceExpiryDate)} onChange={set("insuranceExpiryDate")} />
                </Field>
                <Field label="Prochain entretien">
                  <input type="date" className={inputCls} value={String(f.nextMaintenanceDate)} onChange={set("nextMaintenanceDate")} />
                </Field>
              </div>
              <Field label="Notes garage">
                <textarea className={`${inputCls} h-20 py-2`} value={String(f.unitNotes)} onChange={set("unitNotes")} />
              </Field>
            </>
          )}

          {modal.kind === "history" && u && (
            <div className="space-y-2">
              {u.history.length === 0 && <p className="text-slate-500">Aucune intervention enregistrée.</p>}
              {u.history.map((h) => (
                <div key={h._id} className="p-3 rounded-xl bg-slate-50 dark:bg-slate-900 border border-slate-200 dark:border-slate-800">
                  <div className="flex items-center justify-between gap-2">
                    <span className="font-bold">{TYPE_LABEL[h.type] || h.type}</span>
                    <span className="text-slate-500">{fmtDate(h.startDate)}</span>
                  </div>
                  <p className="text-slate-600 dark:text-slate-300 mt-0.5">{h.description}</p>
                  <div className="flex items-center justify-between mt-1.5 text-[11px] text-slate-500">
                    <span>
                      {STATUS_LABEL[h.status] || h.status}
                      {h.mileage ? ` · ${fmtKm(h.mileage)}` : ""}
                      {h.cost ? ` · ${h.cost} DT` : ""}
                      {h.provider ? ` · ${h.provider}` : ""}
                    </span>
                    {(h.status === "scheduled" || h.status === "in_progress") && (
                      <span className="flex gap-1">
                        {h.status === "scheduled" && (
                          <button
                            type="button"
                            disabled={saving}
                            onClick={() => onSend({ action: "update_maintenance", recordId: h._id, status: "in_progress" }, "Intervention démarrée")}
                            className={`${btn} px-2 py-1 border border-slate-200 dark:border-slate-700`}
                          >
                            Démarrer
                          </button>
                        )}
                        <button
                          type="button"
                          disabled={saving}
                          onClick={() => onSend({ action: "update_maintenance", recordId: h._id, status: "completed" }, "Intervention terminée")}
                          className={`${btn} px-2 py-1 bg-emerald-600 text-white`}
                        >
                          Terminer
                        </button>
                      </span>
                    )}
                  </div>
                </div>
              ))}
            </div>
          )}

          {modal.kind === "settings" && (
            <>
              <p className="text-slate-500">
                Exemple : avec un seuil de 2 000 km, vous recevez « Vidange dans 2 000 km — 245 TU 7890 ».
              </p>
              <div className="grid grid-cols-3 gap-3">
                <Field label="Vidange (km avant)">
                  <input type="number" className={inputCls} value={String(f.vidangeKmThreshold)} onChange={set("vidangeKmThreshold")} />
                </Field>
                <Field label="Visite tech. (jours avant)">
                  <input type="number" className={inputCls} value={String(f.inspectionDaysThreshold)} onChange={set("inspectionDaysThreshold")} />
                </Field>
                <Field label="Assurance (jours avant)">
                  <input type="number" className={inputCls} value={String(f.insuranceDaysThreshold)} onChange={set("insuranceDaysThreshold")} />
                </Field>
              </div>
              <div className="grid grid-cols-2 gap-2 pt-2">
                {[
                  ["vidange", "Alertes vidange"],
                  ["inspection", "Alertes visite technique"],
                  ["insurance", "Alertes assurance"],
                  ["maintenance", "Entretiens planifiés"],
                  ["pickups", "Départs du jour"],
                  ["returns", "Retours du jour / retards"],
                ].map(([k, label]) => (
                  <label key={k} className="flex items-center gap-2 font-semibold text-slate-700 dark:text-slate-300">
                    <input type="checkbox" checked={Boolean(f[`en_${k}`])} onChange={set(`en_${k}`)} />
                    {label}
                  </label>
                ))}
              </div>
              {!settings && (
                <p className="flex items-center gap-1 text-amber-600">
                  <ShieldAlert className="w-4 h-4" /> Paramètres non chargés.
                </p>
              )}
            </>
          )}
        </div>

        {modal.kind !== "history" && (
          <div className="p-4 border-t border-slate-100 dark:border-slate-800 flex justify-end gap-2">
            <button type="button" onClick={onClose} className={`${btn} bg-slate-100 dark:bg-slate-800 text-slate-700 dark:text-slate-300`}>
              Annuler
            </button>
            <button type="button" disabled={disabled} onClick={submit} className={`${btn} bg-blue-600 hover:bg-blue-500 text-white`}>
              {saving ? <Loader2 className="w-4 h-4 animate-spin" /> : <CheckCircle2 className="w-4 h-4" />} Enregistrer
            </button>
          </div>
        )}
      </div>
    </div>
  );
}
