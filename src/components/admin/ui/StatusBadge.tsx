/** One definition of booking / payment status labels and colours for every admin screen. */
export const BOOKING_STATUS: Record<string, { label: string; cls: string }> = {
  pending: { label: "En attente", cls: "bg-amber-100 text-amber-800 dark:bg-amber-500/15 dark:text-amber-300" },
  confirmed: { label: "Confirmée", cls: "bg-blue-100 text-blue-800 dark:bg-blue-500/15 dark:text-blue-300" },
  awaiting_payment: { label: "Paiement attendu", cls: "bg-orange-100 text-orange-800 dark:bg-orange-500/15 dark:text-orange-300" },
  paid: { label: "Payée", cls: "bg-teal-100 text-teal-800 dark:bg-teal-500/15 dark:text-teal-300" },
  active: { label: "En cours", cls: "bg-emerald-100 text-emerald-800 dark:bg-emerald-500/15 dark:text-emerald-300" },
  completed: { label: "Clôturée", cls: "bg-indigo-100 text-indigo-800 dark:bg-indigo-500/15 dark:text-indigo-300" },
  cancelled: { label: "Annulée", cls: "bg-rose-100 text-rose-800 dark:bg-rose-500/15 dark:text-rose-300" },
  rejected: { label: "Refusée", cls: "bg-rose-100 text-rose-800 dark:bg-rose-500/15 dark:text-rose-300" },
};

export const PAYMENT_STATUS: Record<string, { label: string; cls: string }> = {
  unpaid: { label: "Non payé", cls: "bg-red-100 text-red-700 dark:bg-red-500/15 dark:text-red-300" },
  partial: { label: "Acompte", cls: "bg-amber-100 text-amber-800 dark:bg-amber-500/15 dark:text-amber-300" },
  paid: { label: "Payé", cls: "bg-emerald-100 text-emerald-800 dark:bg-emerald-500/15 dark:text-emerald-300" },
  refunded: { label: "Remboursé", cls: "bg-slate-200 text-slate-700 dark:bg-slate-700 dark:text-slate-200" },
  failed: { label: "Échec", cls: "bg-red-100 text-red-700 dark:bg-red-500/15 dark:text-red-300" },
};

export function StatusBadge({ status, kind = "booking" }: { status?: string; kind?: "booking" | "payment" }) {
  const map = kind === "booking" ? BOOKING_STATUS : PAYMENT_STATUS;
  const s = map[status || ""] || { label: status || "—", cls: "bg-slate-100 text-slate-700 dark:bg-slate-800 dark:text-slate-300" };
  return <span className={`inline-flex items-center px-2 py-0.5 rounded-full text-[10px] font-bold whitespace-nowrap ${s.cls}`}>{s.label}</span>;
}
