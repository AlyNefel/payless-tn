"use client";

import { Download } from "lucide-react";
import { usePermissions } from "@/components/admin/ui";
import { cardCls, PeriodBar, type Period } from "./shared";

const REPORTS: [string, string, string][] = [
  ["journal", "Journal de trésorerie", "Toutes les entrées et sorties d'argent (paiements, remboursements, cautions, dépenses), par date. C'est le fichier à remettre à l'expert-comptable."],
  ["payments", "Encaissements", "Chaque reçu : réservation, client, mode de paiement, agent."],
  ["expenses", "Dépenses", "Chaque dépense avec catégorie, fournisseur, TVA et présence du justificatif."],
  ["receivables", "Reste à encaisser", "Réservations non soldées avec le téléphone du client."],
  ["vehicles", "Rentabilité par véhicule", "Locations, jours loués, occupation, chiffre d'affaires, dépenses et marge."],
];

export function ReportsTab({ period, setPeriod }: { period: Period; setPeriod: (p: Period) => void }) {
  const { can } = usePermissions();
  const allowed = can("accounting.export");
  return (
    <div className="space-y-3">
      <PeriodBar period={period} onChange={setPeriod} />
      {!allowed && <p className="text-xs font-semibold text-amber-600">Votre rôle ne permet pas d&apos;exporter les rapports.</p>}
      <div className="grid sm:grid-cols-2 xl:grid-cols-3 gap-3">
        {REPORTS.map(([type, title, text]) => (
          <div key={type} className={`${cardCls} p-4 flex flex-col gap-3`}>
            <div>
              <h3 className="text-sm font-bold text-slate-900 dark:text-white">{title}</h3>
              <p className="mt-1 text-xs text-slate-500">{text}</p>
            </div>
            {allowed && (
              <a
                href={`/api/admin/accounting/export?type=${type}&from=${period.from}&to=${period.to}`}
                className="mt-auto inline-flex items-center justify-center gap-1.5 h-10 rounded-xl bg-blue-600 hover:bg-blue-500 text-white text-xs font-bold"
              >
                <Download className="w-4 h-4" /> Télécharger (Excel / CSV)
              </a>
            )}
          </div>
        ))}
      </div>
      <p className="text-[11px] text-slate-500">Fichiers CSV au format français (séparateur point-virgule, virgule décimale) : ils s&apos;ouvrent directement dans Excel.</p>
    </div>
  );
}
