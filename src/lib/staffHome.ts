/**
 * Where a back-office account lands when it opens the admin: the dashboard ("Tableau de bord"),
 * except Worker Assistance accounts (their simplified workspace) and accountants (accounting dashboard).
 */
export function staffHome(role?: string | null): string {
  const r = String(role || "").toLowerCase();
  if (r === "worker") return "/admin/worker";
  if (r === "accountant") return "/admin/accounting";
  return "/admin";
}
