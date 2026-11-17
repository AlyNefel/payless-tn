"use client";

import { Suspense, useState } from "react";
import { usePathname, useRouter, useSearchParams } from "next/navigation";
import { Banknote, BarChart3, Calculator, FileText, Lock, Receipt, Wallet } from "lucide-react";
import { CashTab } from "@/components/admin/accounting/CashTab";
import { DashboardTab } from "@/components/admin/accounting/DashboardTab";
import { DocumentsTab } from "@/components/admin/accounting/DocumentsTab";
import { ExpensesTab } from "@/components/admin/accounting/ExpensesTab";
import { PaymentsTab } from "@/components/admin/accounting/PaymentsTab";
import { ReportsTab } from "@/components/admin/accounting/ReportsTab";
import { PeriodBar, presetPeriod, type Period } from "@/components/admin/accounting/shared";

const TABS = [
  { key: "dashboard", label: "Tableau de bord", icon: BarChart3 },
  { key: "payments", label: "Encaissements", icon: Banknote },
  { key: "expenses", label: "Dépenses", icon: Wallet },
  { key: "documents", label: "Contrats & factures", icon: FileText },
  { key: "cash", label: "Caisse", icon: Lock },
  { key: "reports", label: "Rapports", icon: Receipt },
] as const;
type TabKey = (typeof TABS)[number]["key"];

function Accounting() {
  const router = useRouter();
  const pathname = usePathname();
  const params = useSearchParams();
  const tab = (TABS.find((t) => t.key === params.get("tab"))?.key || "dashboard") as TabKey;
  const [period, setPeriod] = useState<Period>(() => presetPeriod("month"));
  // Bumped after any change so the other tabs reload their figures.
  const [version, setVersion] = useState(0);
  const changed = () => setVersion((v) => v + 1);
  const go = (key: TabKey) => router.replace(`${pathname}?tab=${key}`, { scroll: false });

  return (
    <div className="space-y-4">
      <div className="flex items-start gap-3">
        <span className="p-2.5 rounded-xl bg-blue-50 dark:bg-blue-500/10 text-blue-600 shrink-0">
          <Calculator className="w-5 h-5" />
        </span>
        <div className="min-w-0">
          <h1 className="text-xl sm:text-2xl font-extrabold tracking-tight text-slate-900 dark:text-white">Comptabilité</h1>
          <p className="text-xs text-slate-500">Encaissements, dépenses, caisse, contrats, factures et rapports — chiffres calculés à partir des mouvements enregistrés.</p>
        </div>
      </div>

      <div role="tablist" aria-label="Sections de la comptabilité" className="flex gap-1.5 overflow-x-auto -mx-1 px-1 pb-1">
        {TABS.map((t) => (
          <button
            key={t.key}
            role="tab"
            type="button"
            aria-selected={tab === t.key}
            onClick={() => go(t.key)}
            className={`shrink-0 inline-flex items-center gap-1.5 px-3.5 h-10 rounded-xl text-xs font-bold ${
              tab === t.key ? "bg-slate-900 text-white dark:bg-white dark:text-slate-900" : "border border-slate-200 dark:border-slate-800 text-slate-600 dark:text-slate-300 bg-white dark:bg-[#0f141f]"
            }`}
          >
            <t.icon className="w-4 h-4" /> {t.label}
          </button>
        ))}
      </div>

      {tab === "dashboard" && (
        <>
          <PeriodBar period={period} onChange={setPeriod} />
          <DashboardTab period={period} refreshKey={version} />
        </>
      )}
      {tab === "payments" && <PaymentsTab period={period} setPeriod={setPeriod} onChanged={changed} />}
      {tab === "expenses" && <ExpensesTab period={period} setPeriod={setPeriod} onChanged={changed} />}
      {tab === "documents" && <DocumentsTab onChanged={changed} refreshKey={version} />}
      {tab === "cash" && <CashTab onChanged={changed} />}
      {tab === "reports" && <ReportsTab period={period} setPeriod={setPeriod} />}
    </div>
  );
}

export default function AccountingPage() {
  return (
    <Suspense fallback={null}>
      <Accounting />
    </Suspense>
  );
}
