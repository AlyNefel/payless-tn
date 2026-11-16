"use client";

import { useEffect, useState } from "react";
import { ShieldCheck, AlertTriangle, Loader2, Wrench } from "lucide-react";
import { btn, usePermissions } from "./ui";

interface Report {
  bookingsChecked: number;
  conflicts: { unit: string; bookings: string[] }[];
  orphanAssignments: string[];
  unassigned: string[];
}

/** Assignment audit: proves that no physical car is shared by overlapping reservations. */
export function FleetIntegrity({ onRepaired }: { onRepaired?: () => void }) {
  const { can } = usePermissions();
  const [report, setReport] = useState<Report | null>(null);
  const [busy, setBusy] = useState(false);
  const [msg, setMsg] = useState("");

  const load = () =>
    fetch("/api/admin/fleet/integrity", { cache: "no-store" })
      .then((r) => (r.ok ? r.json() : null))
      .then((d) => d?.success && setReport(d.report))
      .catch(() => {});
  useEffect(() => {
    load();
  }, []);

  if (!report) return null;
  const issues = report.conflicts.length + report.orphanAssignments.length + report.unassigned.length;

  const repair = async () => {
    setBusy(true);
    setMsg("");
    try {
      const d = await fetch("/api/admin/fleet/integrity", { method: "POST" }).then((r) => r.json());
      if (d.success) {
        setReport(d.after);
        const still = d.report.fixed?.stillUnassigned?.length || 0;
        setMsg(still ? `${still} réservation(s) restent sans véhicule : aucun véhicule libre sur leurs dates.` : "Affectations corrigées.");
        onRepaired?.();
      }
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className={`p-4 rounded-2xl border text-xs ${issues ? "bg-red-50 dark:bg-red-950/30 border-red-200 dark:border-red-800" : "bg-emerald-50 dark:bg-emerald-950/20 border-emerald-200 dark:border-emerald-900"}`}>
      <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-3">
        <div className="flex items-start gap-2">
          {issues ? <AlertTriangle className="w-5 h-5 text-red-600 shrink-0" /> : <ShieldCheck className="w-5 h-5 text-emerald-600 shrink-0" />}
          <div>
            <p className="font-bold text-slate-900 dark:text-white">
              {issues
                ? `Contrôle des affectations : ${issues} anomalie(s)`
                : `Contrôle des affectations : aucune anomalie (${report.bookingsChecked} réservations vérifiées)`}
            </p>
            <p className="text-slate-600 dark:text-slate-300">Chaque réservation doit avoir son propre véhicule physique, jamais partagé sur les mêmes jours.</p>
            {report.conflicts.map((c) => (
              <p key={c.unit} className="text-red-700 dark:text-red-300 font-semibold">
                {c.unit} partagé par : {c.bookings.join(", ")}
              </p>
            ))}
            {report.unassigned.length > 0 && <p className="text-red-700 dark:text-red-300 font-semibold">Sans véhicule : {report.unassigned.join(", ")}</p>}
            {report.orphanAssignments.length > 0 && <p className="text-red-700 dark:text-red-300 font-semibold">Véhicule supprimé : {report.orphanAssignments.join(", ")}</p>}
            {msg && <p className="font-semibold mt-1">{msg}</p>}
          </div>
        </div>
        {issues > 0 && can("fleet.edit") && (
          <button type="button" onClick={repair} disabled={busy} className={`${btn.base} ${btn.danger} shrink-0`}>
            {busy ? <Loader2 className="w-4 h-4 animate-spin" /> : <Wrench className="w-4 h-4" />} Corriger automatiquement
          </button>
        )}
      </div>
    </div>
  );
}
