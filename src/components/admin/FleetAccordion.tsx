"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import Link from "next/link";
import { ChevronDown, Car, Plus, Loader2, AlertTriangle, CheckCircle2, Wrench, ShieldCheck, CalendarDays, FileText, X, ChevronsDownUp, ChevronsUpDown, Pencil } from "lucide-react";
import { ActionMenu, QuickView, Field, Section, StatusBadge, btn, standardActions, usePermissions, type ViewMode } from "./ui";
import { cloudinaryUrl } from "@/lib/cloudinaryUrl";

interface BookingRow {
  _id: string;
  reference: string;
  status: string;
  customerName: string;
  customerPhone: string;
  pickupDate: string;
  returnDate: string;
  late: boolean;
}
interface Unit {
  unitId: string;
  index: number;
  label: string;
  licensePlate: string;
  status: "active" | "maintenance" | "out_of_service";
  availability: "free" | "rented" | "garage" | "out";
  mileage: number;
  current: BookingRow | null;
  next: BookingRow | null;
  upcomingCount: number;
  openMaintenance: number;
  technicalInspectionDate: string | null;
  insuranceEnd: string | null;
  insuranceCompany: string;
  notes: string;
  bookings?: BookingRow[];
}
interface Model {
  _id: string;
  brand: string;
  model: string;
  year: number;
  category: string;
  location: string;
  image: string;
  dailyTND: number;
  status: string;
  units: Unit[];
  counts: { total: number; free: number; rented: number; garage: number };
  unassigned: BookingRow[];
}

const AVAIL: Record<Unit["availability"], { label: string; cls: string }> = {
  free: { label: "Disponible", cls: "bg-emerald-100 text-emerald-800 dark:bg-emerald-500/15 dark:text-emerald-300" },
  rented: { label: "En location", cls: "bg-blue-100 text-blue-800 dark:bg-blue-500/15 dark:text-blue-300" },
  garage: { label: "Au garage", cls: "bg-amber-100 text-amber-800 dark:bg-amber-500/15 dark:text-amber-300" },
  out: { label: "Hors service", cls: "bg-slate-200 text-slate-600 dark:bg-slate-700 dark:text-slate-300" },
};
const inputCls =
  "w-full h-10 px-3 rounded-xl border border-slate-200 dark:border-slate-700 bg-slate-50 dark:bg-slate-900 text-xs font-semibold text-slate-900 dark:text-white outline-none focus:ring-2 focus:ring-blue-500";
const fr = (d?: string | null) => (d ? new Date(d).toLocaleDateString("fr-FR") : "—");
const OPEN_KEY = "payless-admin-fleet-open";

type Sort = "name" | "count" | "free";

/**
 * Fleet grouped by brand + model. Each accordion lists the PHYSICAL cars of the model with their
 * live status, reservations, maintenance and insurance, and per-car actions.
 */
export function FleetAccordion({
  view,
  search,
  visibleModelIds,
  refreshKey,
  onEditModel,
  onViewModel,
  onArchiveModel,
  onStats,
}: {
  view: ViewMode;
  search: string;
  /** Models allowed by the page filters (category, gearbox, status). */
  visibleModelIds: Set<string>;
  refreshKey: number;
  onEditModel: (id: string) => void;
  onViewModel: (id: string) => void;
  onArchiveModel: (id: string) => void;
  /** Totals counted on physical cars (not models). */
  onStats?: (s: { total: number; free: number; rented: number; garage: number }) => void;
}) {
  const { can } = usePermissions();
  const [models, setModels] = useState<Model[]>([]);
  const [loading, setLoading] = useState(true);
  const [open, setOpen] = useState<Set<string>>(new Set());
  const [sort, setSort] = useState<Sort>("name");
  const [detail, setDetail] = useState<{ model: Model; unit: Unit } | null>(null);
  const [editing, setEditing] = useState<{ model: Model; unit: Unit | null; plate: string; status: Unit["status"]; notes: string } | null>(null);
  const [busy, setBusy] = useState(false);
  const [toast, setToast] = useState<{ ok: boolean; text: string } | null>(null);

  const onStatsRef = useRef(onStats);
  useEffect(() => {
    onStatsRef.current = onStats;
  }, [onStats]);
  const load = useCallback(async () => {
    setLoading(true);
    try {
      const d = await fetch("/api/admin/fleet/units?bookings=1", { cache: "no-store" }).then((r) => r.json());
      if (d.success) {
        setModels(d.models);
        const sum = { total: 0, free: 0, rented: 0, garage: 0 };
        for (const m of d.models as Model[]) {
          sum.total += m.counts.total;
          sum.free += m.counts.free;
          sum.rented += m.counts.rented;
          sum.garage += m.counts.garage;
        }
        onStatsRef.current?.(sum);
      }
    } finally {
      setLoading(false);
    }
  }, []);
  useEffect(() => {
    load();
  }, [load, refreshKey]);
  useEffect(() => {
    try {
      const saved = JSON.parse(window.localStorage.getItem(OPEN_KEY) || "[]");
      if (Array.isArray(saved)) setOpen(new Set(saved));
    } catch {
      /* ignore */
    }
  }, []);
  const persist = (next: Set<string>) => {
    setOpen(next);
    try {
      window.localStorage.setItem(OPEN_KEY, JSON.stringify([...next]));
    } catch {
      /* ignore */
    }
  };

  const notify = (ok: boolean, text: string) => {
    setToast({ ok, text });
    setTimeout(() => setToast(null), 4000);
  };

  const q = search.trim().toLowerCase();
  const shown = useMemo(() => {
    const list = models
      .filter((m) => visibleModelIds.has(m._id) || (q && m.units.some((u) => u.licensePlate.toLowerCase().includes(q))))
      .map((m) => {
        // A search on a plate keeps only the matching cars inside the accordion.
        const plateHit = q && !`${m.brand} ${m.model}`.toLowerCase().includes(q) ? m.units.filter((u) => u.licensePlate.toLowerCase().includes(q)) : null;
        return { ...m, shownUnits: plateHit && plateHit.length ? plateHit : m.units, forcedOpen: Boolean(plateHit && plateHit.length) };
      });
    return list.sort((a, b) =>
      sort === "count" ? b.counts.total - a.counts.total : sort === "free" ? b.counts.free - a.counts.free : `${a.brand} ${a.model}`.localeCompare(`${b.brand} ${b.model}`)
    );
  }, [models, visibleModelIds, q, sort]);

  const call = async (url: string, method: string, body: unknown, okText: string) => {
    setBusy(true);
    try {
      const res = await fetch(url, { method, headers: { "Content-Type": "application/json" }, body: body ? JSON.stringify(body) : undefined });
      const d = await res.json().catch(() => ({}));
      if (!res.ok || d.success === false) throw new Error(d.error || "Opération refusée");
      const extra = d.unassigned?.length ? ` Attention : ${d.unassigned.join(", ")} sans véhicule.` : d.moved?.length ? ` Réservations déplacées : ${d.moved.join(", ")}.` : "";
      notify(!d.unassigned?.length, okText + extra);
      await load();
      return true;
    } catch (e) {
      notify(false, e instanceof Error ? e.message : "Erreur");
      return false;
    } finally {
      setBusy(false);
    }
  };

  const unitActions = (m: Model, u: Unit) =>
    standardActions({
      onView: () => setDetail({ model: m, unit: u }),
      onEdit: () => setEditing({ model: m, unit: u, plate: u.licensePlate, status: u.status, notes: u.notes }),
      onViewEdit: () => setEditing({ model: m, unit: u, plate: u.licensePlate, status: u.status, notes: u.notes }),
      onDelete: () => {
        if (confirm(`Retirer ${u.label} (${m.brand} ${m.model}) de la flotte ? Ses réservations futures seront déplacées vers un autre véhicule.`)) {
          call(`/api/admin/fleet/units?vehicleId=${m._id}&unitId=${u.unitId}`, "DELETE", null, "Véhicule retiré.");
        }
      },
      deleteLabel: "Retirer ce véhicule",
      can: { edit: can("fleet.edit"), delete: can("fleet.delete") },
      extra: [
        { key: "resa", label: "Réservations", icon: CalendarDays, href: `/admin/calendar?model=${m._id}` },
        { key: "maint", label: "Maintenance", icon: Wrench, href: `/admin/garage?tab=maintenance&unit=${u.unitId}` },
        { key: "ins", label: "Assurance & documents", icon: ShieldCheck, href: `/admin/garage?tab=assurance&unit=${u.unitId}` },
      ],
    });

  const availBadge = (u: Unit) => <span className={`inline-flex px-2 py-0.5 rounded-full text-[10px] font-bold whitespace-nowrap ${AVAIL[u.availability].cls}`}>{AVAIL[u.availability].label}</span>;
  const occupancy = (u: Unit) =>
    u.current ? (
      <span className={u.current.late ? "text-red-600 font-semibold" : ""}>
        {u.current.customerName} · retour {fr(u.current.returnDate)}
        {u.current.late ? " (retard)" : ""}
      </span>
    ) : u.next ? (
      <span>Prochaine : {fr(u.next.pickupDate)} ({u.next.customerName})</span>
    ) : (
      <span className="text-slate-400">Aucune réservation</span>
    );

  if (loading && models.length === 0) {
    return (
      <div className="py-16 flex justify-center">
        <Loader2 className="w-6 h-6 animate-spin text-slate-400" />
      </div>
    );
  }

  return (
    <div className="space-y-3">
      {toast && (
        <div role="status" className={`fixed top-20 right-4 left-4 sm:left-auto sm:w-[26rem] z-[90] px-4 py-3 rounded-2xl shadow-xl text-xs font-semibold flex items-start gap-2 text-white ${toast.ok ? "bg-emerald-600" : "bg-red-600"}`}>
          {toast.ok ? <CheckCircle2 className="w-4 h-4 shrink-0" /> : <AlertTriangle className="w-4 h-4 shrink-0" />} {toast.text}
        </div>
      )}

      <div className="flex flex-wrap items-center justify-between gap-2 text-xs">
        <p className="text-slate-500">
          {shown.length} modèle(s) · {shown.reduce((n, m) => n + m.counts.total, 0)} véhicule(s) ·{" "}
          <span className="text-emerald-600 font-semibold">{shown.reduce((n, m) => n + m.counts.free, 0)} disponibles</span>
        </p>
        <div className="flex items-center gap-2">
          <select value={sort} onChange={(e) => setSort(e.target.value as Sort)} aria-label="Trier" className="h-8 px-2 rounded-lg border border-slate-200 dark:border-slate-700 bg-white dark:bg-slate-900 font-semibold">
            <option value="name">Tri : nom</option>
            <option value="count">Tri : nombre de véhicules</option>
            <option value="free">Tri : disponibles</option>
          </select>
          <button type="button" onClick={() => persist(new Set(shown.map((m) => m._id)))} className={`${btn.base} ${btn.secondary} h-8 px-2.5`} title="Tout déplier">
            <ChevronsUpDown className="w-4 h-4" /> <span className="hidden sm:inline">Tout déplier</span>
          </button>
          <button type="button" onClick={() => persist(new Set())} className={`${btn.base} ${btn.secondary} h-8 px-2.5`} title="Tout replier">
            <ChevronsDownUp className="w-4 h-4" /> <span className="hidden sm:inline">Tout replier</span>
          </button>
        </div>
      </div>

      {shown.length === 0 && <p className="py-14 text-center text-sm text-slate-500 rounded-2xl border border-dashed border-slate-200 dark:border-slate-800">Aucun véhicule ne correspond.</p>}

      {shown.map((m) => {
        const isOpen = open.has(m._id) || m.forcedOpen;
        const panelId = `fleet-panel-${m._id}`;
        return (
          <div key={m._id} className="rounded-2xl bg-white dark:bg-[#0f141f] border border-slate-200 dark:border-slate-800 overflow-hidden">
            <div className="flex items-center gap-2 p-3 sm:p-4">
              <button
                type="button"
                aria-expanded={isOpen}
                aria-controls={panelId}
                onClick={() => {
                  const n = new Set(open);
                  if (n.has(m._id)) n.delete(m._id);
                  else n.add(m._id);
                  persist(n);
                }}
                className="flex-1 min-w-0 flex items-center gap-3 text-left"
              >
                <ChevronDown className={`w-5 h-5 shrink-0 text-slate-400 transition-transform ${isOpen ? "" : "-rotate-90"}`} />
                {m.image ? (
                  // eslint-disable-next-line @next/next/no-img-element -- remote legacy hosts + Cloudinary transforms
                  <img src={cloudinaryUrl(m.image, { width: 160, crop: "limit" })} alt="" loading="lazy" className="w-14 h-10 object-contain rounded-lg bg-white shrink-0" />
                ) : (
                  <span className="w-14 h-10 rounded-lg bg-slate-100 dark:bg-slate-800 flex items-center justify-center shrink-0">
                    <Car className="w-5 h-5 text-slate-400" />
                  </span>
                )}
                <span className="min-w-0">
                  <span className="block text-sm font-bold text-slate-900 dark:text-white truncate">
                    {m.brand} {m.model} <span className="text-slate-400 font-semibold">({m.counts.total})</span>
                  </span>
                  <span className="block text-[11px] text-slate-500 truncate">
                    {m.category || "—"} · {m.dailyTND} TND/j{m.location ? ` · ${m.location}` : ""}
                  </span>
                </span>
              </button>
              <div className="hidden sm:flex items-center gap-1.5 text-[10px] font-bold shrink-0">
                <span className="px-2 py-1 rounded-full bg-emerald-100 text-emerald-800 dark:bg-emerald-500/15 dark:text-emerald-300">{m.counts.free} dispo.</span>
                {m.counts.rented > 0 && <span className="px-2 py-1 rounded-full bg-blue-100 text-blue-800 dark:bg-blue-500/15 dark:text-blue-300">{m.counts.rented} loués</span>}
                {m.counts.garage > 0 && <span className="px-2 py-1 rounded-full bg-amber-100 text-amber-800 dark:bg-amber-500/15 dark:text-amber-300">{m.counts.garage} garage</span>}
              </div>
              <ActionMenu
                label={`Actions pour ${m.brand} ${m.model}`}
                items={standardActions({
                  onView: () => onViewModel(m._id),
                  onEdit: () => onEditModel(m._id),
                  onViewEdit: () => onEditModel(m._id),
                  onDelete: () => onArchiveModel(m._id),
                  deleteLabel: "Archiver le modèle",
                  can: { edit: can("fleet.edit"), delete: can("fleet.delete") },
                  extra: can("fleet.create")
                    ? [{ key: "add", label: "Ajouter un véhicule", icon: Plus, onClick: () => setEditing({ model: m, unit: null, plate: "", status: "active", notes: "" }) }]
                    : [],
                })}
              />
            </div>

            {isOpen && (
              <div id={panelId} className="border-t border-slate-100 dark:border-slate-800 p-3 sm:p-4 bg-slate-50/60 dark:bg-black/20 space-y-3">
                <div className="sm:hidden flex flex-wrap gap-1.5 text-[10px] font-bold">
                  <span className="px-2 py-1 rounded-full bg-emerald-100 text-emerald-800">{m.counts.free} dispo.</span>
                  <span className="px-2 py-1 rounded-full bg-blue-100 text-blue-800">{m.counts.rented} loués</span>
                  <span className="px-2 py-1 rounded-full bg-amber-100 text-amber-800">{m.counts.garage} garage</span>
                </div>
                {m.unassigned.length > 0 && (
                  <p className="p-2.5 rounded-xl bg-red-50 dark:bg-red-950/40 text-red-700 dark:text-red-300 text-xs font-semibold flex items-start gap-2">
                    <AlertTriangle className="w-4 h-4 shrink-0" />
                    Réservations sans véhicule physique : {m.unassigned.map((b) => b.reference).join(", ")}
                  </p>
                )}
                {view === "table" ? (
                  <div className="rounded-xl bg-white dark:bg-[#0f141f] border border-slate-200 dark:border-slate-800 overflow-x-auto">
                    <table className="w-full text-xs min-w-[720px]">
                      <thead>
                        <tr className="text-left text-[11px] uppercase tracking-wide text-slate-500 border-b border-slate-100 dark:border-slate-800">
                          <th className="p-2.5">Véhicule</th>
                          <th className="p-2.5">État</th>
                          <th className="p-2.5">Occupation</th>
                          <th className="p-2.5">À venir</th>
                          <th className="p-2.5">Km</th>
                          <th className="p-2.5">Entretien</th>
                          <th className="p-2.5">Assurance</th>
                          <th className="p-2.5 w-10" aria-label="Actions" />
                        </tr>
                      </thead>
                      <tbody className="divide-y divide-slate-100 dark:divide-slate-800">
                        {m.shownUnits.map((u) => (
                          <tr key={u.unitId}>
                            <td className="p-2.5">
                              <button type="button" onClick={() => setDetail({ model: m, unit: u })} className="font-mono font-bold text-slate-900 dark:text-white hover:text-blue-600 text-left">
                                #{u.index} · {u.licensePlate || "sans immat."}
                              </button>
                            </td>
                            <td className="p-2.5">{availBadge(u)}</td>
                            <td className="p-2.5">{occupancy(u)}</td>
                            <td className="p-2.5">{u.upcomingCount}</td>
                            <td className="p-2.5 whitespace-nowrap">{u.mileage.toLocaleString("fr-FR")}</td>
                            <td className="p-2.5">{u.openMaintenance > 0 ? <span className="text-amber-600 font-semibold">{u.openMaintenance} en cours</span> : "—"}</td>
                            <td className="p-2.5">{u.insuranceEnd ? fr(u.insuranceEnd) : <span className="text-red-600 font-semibold">Aucune</span>}</td>
                            <td className="p-2.5 text-right">
                              <ActionMenu items={unitActions(m, u)} label={`Actions pour ${u.label}`} size="sm" />
                            </td>
                          </tr>
                        ))}
                      </tbody>
                    </table>
                  </div>
                ) : (
                  <div className="grid grid-cols-1 md:grid-cols-2 xl:grid-cols-3 gap-3">
                    {m.shownUnits.map((u) => (
                      <div key={u.unitId} className="p-3.5 rounded-xl bg-white dark:bg-[#0f141f] border border-slate-200 dark:border-slate-800 flex flex-col gap-2 text-xs">
                        <div className="flex items-start justify-between gap-2">
                          <button type="button" onClick={() => setDetail({ model: m, unit: u })} className="min-w-0 text-left">
                            <span className="block text-[11px] text-slate-500">Véhicule #{u.index}</span>
                            <span className="block font-mono font-black text-sm text-slate-900 dark:text-white truncate">{u.licensePlate || "Sans immatriculation"}</span>
                          </button>
                          <div className="flex items-center gap-1">
                            {availBadge(u)}
                            <ActionMenu items={unitActions(m, u)} label={`Actions pour ${u.label}`} size="sm" />
                          </div>
                        </div>
                        <p className="text-slate-600 dark:text-slate-300">{occupancy(u)}</p>
                        <div className="grid grid-cols-3 gap-1.5 text-[11px] text-slate-500">
                          <span className="flex items-center gap-1"><CalendarDays className="w-3.5 h-3.5" /> {u.upcomingCount} à venir</span>
                          <span className={`flex items-center gap-1 ${u.openMaintenance ? "text-amber-600 font-semibold" : ""}`}><Wrench className="w-3.5 h-3.5" /> {u.openMaintenance || "—"}</span>
                          <span className={`flex items-center gap-1 ${u.insuranceEnd ? "" : "text-red-600 font-semibold"}`}><ShieldCheck className="w-3.5 h-3.5" /> {u.insuranceEnd ? fr(u.insuranceEnd) : "Aucune"}</span>
                        </div>
                        <p className="text-[11px] text-slate-500">{u.mileage.toLocaleString("fr-FR")} km</p>
                      </div>
                    ))}
                  </div>
                )}
              </div>
            )}
          </div>
        );
      })}

      {/* Car details */}
      <QuickView
        open={Boolean(detail)}
        onClose={() => setDetail(null)}
        title={detail ? `${detail.model.brand} ${detail.model.model} — #${detail.unit.index}` : ""}
        subtitle={detail ? detail.unit.licensePlate || "Sans immatriculation" : ""}
        badge={detail ? availBadge(detail.unit) : null}
        footer={
          detail &&
          can("fleet.edit") && (
            <button
              type="button"
              className={`${btn.base} ${btn.primary}`}
              onClick={() => {
                const d = detail;
                setDetail(null);
                setEditing({ model: d.model, unit: d.unit, plate: d.unit.licensePlate, status: d.unit.status, notes: d.unit.notes });
              }}
            >
              <Pencil className="w-4 h-4" /> Voir & modifier
            </button>
          )
        }
      >
        {detail && (
          <>
            <Section title="État">
              <Field label="Kilométrage">{detail.unit.mileage.toLocaleString("fr-FR")} km</Field>
              <Field label="Visite technique">{fr(detail.unit.technicalInspectionDate)}</Field>
              <Field label="Assurance">{detail.unit.insuranceEnd ? `${detail.unit.insuranceCompany ? `${detail.unit.insuranceCompany} · ` : ""}jusqu'au ${fr(detail.unit.insuranceEnd)}` : "Aucune enregistrée"}</Field>
              <Field label="Interventions ouvertes">{detail.unit.openMaintenance}</Field>
            </Section>
            <Section title={`Réservations (${detail.unit.bookings?.length || 0})`}>
              {(detail.unit.bookings || []).length === 0 && <p className="text-slate-500">Aucune réservation en cours ou à venir.</p>}
              <ul className="space-y-1.5">
                {(detail.unit.bookings || []).map((b) => (
                  <li key={b._id}>
                    <Link href={`/admin/bookings/${b._id}`} className="flex items-center justify-between gap-2 p-2 rounded-lg hover:bg-white dark:hover:bg-slate-800">
                      <span className="min-w-0">
                        <span className="block font-mono font-bold text-blue-600 dark:text-blue-400">{b.reference}</span>
                        <span className="block text-slate-500 truncate">
                          {b.customerName} · {fr(b.pickupDate)} → {fr(b.returnDate)}
                        </span>
                      </span>
                      <StatusBadge status={b.status} />
                    </Link>
                  </li>
                ))}
              </ul>
            </Section>
            <div className="grid grid-cols-2 gap-2">
              <Link href={`/admin/garage?tab=maintenance&unit=${detail.unit.unitId}`} className={`${btn.base} ${btn.secondary}`}>
                <Wrench className="w-4 h-4" /> Maintenance
              </Link>
              <Link href={`/admin/garage?tab=assurance&unit=${detail.unit.unitId}`} className={`${btn.base} ${btn.secondary}`}>
                <FileText className="w-4 h-4" /> Assurance & documents
              </Link>
            </div>
            {detail.unit.notes && (
              <Section title="Notes">
                <p>{detail.unit.notes}</p>
              </Section>
            )}
          </>
        )}
      </QuickView>

      {/* Add / edit one car */}
      {editing && (
        <div className="fixed inset-0 z-[75] flex items-end sm:items-center justify-center bg-black/60 backdrop-blur-sm sm:p-4" role="dialog" aria-modal="true">
          <form
            className="w-full sm:max-w-md rounded-t-2xl sm:rounded-2xl bg-white dark:bg-[#0f141f] border border-slate-200 dark:border-slate-700 p-5 space-y-3 text-xs"
            onSubmit={async (e) => {
              e.preventDefault();
              const ok = editing.unit
                ? await call("/api/admin/fleet/units", "PATCH", { vehicleId: editing.model._id, unitId: editing.unit.unitId, licensePlate: editing.plate, status: editing.status, notes: editing.notes }, "Véhicule mis à jour.")
                : await call("/api/admin/fleet/units", "POST", { vehicleId: editing.model._id, licensePlate: editing.plate }, "Véhicule ajouté.");
              if (ok) setEditing(null);
            }}
          >
            <div className="flex items-center justify-between">
              <h2 className="text-sm font-bold text-slate-900 dark:text-white">
                {editing.unit ? `Véhicule #${editing.unit.index}` : "Ajouter un véhicule"} — {editing.model.brand} {editing.model.model}
              </h2>
              <button type="button" onClick={() => setEditing(null)} aria-label="Fermer" className="p-1 rounded-lg text-slate-400 hover:bg-slate-100 dark:hover:bg-slate-800">
                <X className="w-4 h-4" />
              </button>
            </div>
            <label className="block space-y-1">
              <span className="font-semibold text-slate-600 dark:text-slate-300">Immatriculation (facultative)</span>
              <input className={`${inputCls} font-mono`} value={editing.plate} onChange={(e) => setEditing({ ...editing, plate: e.target.value.toUpperCase() })} placeholder="ex. 245 TU 7890" />
            </label>
            {editing.unit && (
              <>
                <label className="block space-y-1">
                  <span className="font-semibold text-slate-600 dark:text-slate-300">Statut</span>
                  <select className={inputCls} value={editing.status} onChange={(e) => setEditing({ ...editing, status: e.target.value as Unit["status"] })}>
                    <option value="active">En service</option>
                    <option value="maintenance">Au garage</option>
                    <option value="out_of_service">Hors service</option>
                  </select>
                </label>
                {editing.status !== "active" && editing.unit.upcomingCount > 0 && (
                  <p className="p-2.5 rounded-xl bg-amber-50 dark:bg-amber-950/30 text-amber-900 dark:text-amber-200 font-semibold">
                    {editing.unit.upcomingCount} réservation(s) à venir seront déplacées vers un autre véhicule du modèle.
                  </p>
                )}
                <label className="block space-y-1">
                  <span className="font-semibold text-slate-600 dark:text-slate-300">Notes</span>
                  <textarea className={`${inputCls} h-16 py-2`} value={editing.notes} onChange={(e) => setEditing({ ...editing, notes: e.target.value })} />
                </label>
              </>
            )}
            <div className="flex justify-end gap-2 pt-1">
              <button type="button" onClick={() => setEditing(null)} className={`${btn.base} ${btn.secondary}`}>
                Annuler
              </button>
              <button type="submit" disabled={busy} className={`${btn.base} ${btn.primary}`}>
                {busy && <Loader2 className="w-4 h-4 animate-spin" />} Enregistrer
              </button>
            </div>
          </form>
        </div>
      )}
    </div>
  );
}
