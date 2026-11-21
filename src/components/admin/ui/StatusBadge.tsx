import { Ban, CheckCircle2, Clock, CreditCard, PlayCircle, Flag, XCircle, type LucideIcon } from "lucide-react";

/** One definition of booking / payment status labels, colours and icons for every admin screen. */
export const BOOKING_STATUS: Record<string, { label: string; cls: string; icon?: LucideIcon }> = {
  pending: { label: "En attente", cls: "bg-orange-100 text-orange-700 ring-orange-200 dark:bg-orange-500/15 dark:text-orange-300 dark:ring-orange-500/20", icon: Clock },
  confirmed: { label: "Confirmée", cls: "bg-emerald-100 text-emerald-700 ring-emerald-200 dark:bg-emerald-500/15 dark:text-emerald-300 dark:ring-emerald-500/20", icon: CheckCircle2 },
  awaiting_payment: { label: "Paiement attendu", cls: "bg-amber-100 text-amber-800 ring-amber-200 dark:bg-amber-500/15 dark:text-amber-300 dark:ring-amber-500/20", icon: CreditCard },
  paid: { label: "Payée", cls: "bg-teal-100 text-teal-800 ring-teal-200 dark:bg-teal-500/15 dark:text-teal-300 dark:ring-teal-500/20", icon: CheckCircle2 },
  active: { label: "En cours", cls: "bg-blue-100 text-blue-700 ring-blue-200 dark:bg-blue-500/15 dark:text-blue-300 dark:ring-blue-500/20", icon: PlayCircle },
  completed: { label: "Terminée", cls: "bg-violet-100 text-violet-700 ring-violet-200 dark:bg-violet-500/15 dark:text-violet-300 dark:ring-violet-500/20", icon: Flag },
  cancelled: { label: "Annulée", cls: "bg-rose-100 text-rose-700 ring-rose-200 dark:bg-rose-500/15 dark:text-rose-300 dark:ring-rose-500/20", icon: Ban },
  rejected: { label: "Refusée", cls: "bg-rose-100 text-rose-700 ring-rose-200 dark:bg-rose-500/15 dark:text-rose-300 dark:ring-rose-500/20", icon: XCircle },
};

export const PAYMENT_STATUS: Record<string, { label: string; cls: string; icon?: LucideIcon }> = {
  unpaid: { label: "Non payé", cls: "bg-red-100 text-red-700 ring-red-200 dark:bg-red-500/15 dark:text-red-300 dark:ring-red-500/20" },
  partial: { label: "Acompte", cls: "bg-amber-100 text-amber-800 ring-amber-200 dark:bg-amber-500/15 dark:text-amber-300 dark:ring-amber-500/20" },
  paid: { label: "Payé", cls: "bg-emerald-100 text-emerald-700 ring-emerald-200 dark:bg-emerald-500/15 dark:text-emerald-300 dark:ring-emerald-500/20" },
  refunded: { label: "Remboursé", cls: "bg-slate-200 text-slate-700 ring-slate-300 dark:bg-slate-700 dark:text-slate-200 dark:ring-slate-600" },
  failed: { label: "Échec", cls: "bg-red-100 text-red-700 ring-red-200 dark:bg-red-500/15 dark:text-red-300 dark:ring-red-500/20" },
};

export function StatusBadge({ status, kind = "booking" }: { status?: string; kind?: "booking" | "payment" }) {
  const map = kind === "booking" ? BOOKING_STATUS : PAYMENT_STATUS;
  const s = map[status || ""] || { label: status || "—", cls: "bg-slate-100 text-slate-700 ring-slate-200 dark:bg-slate-800 dark:text-slate-300 dark:ring-slate-700" };
  const Icon = s.icon;
  return (
    <span className={`inline-flex items-center gap-1 px-2.5 py-1 rounded-full text-[11px] font-bold whitespace-nowrap ring-1 ring-inset ${s.cls}`}>
      {Icon && <Icon className="w-3.5 h-3.5" aria-hidden />}
      {s.label}
    </span>
  );
}
