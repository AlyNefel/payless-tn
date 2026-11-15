/** Client-safe definitions of the back-office sections and default role permissions. */

export type AccessLevel = "none" | "view" | "edit";
export type StaffRole = "admin" | "manager" | "staff";

export const ADMIN_SECTIONS = [
  { key: "dashboard", label: "Tableau de bord", href: "/admin" },
  { key: "bookings", label: "Réservations", href: "/admin/bookings" },
  { key: "calendar", label: "Calendrier", href: "/admin/calendar" },
  { key: "steps", label: "Étapes de réservation", href: "/admin/steps" },
  { key: "fleet", label: "Flotte & véhicules", href: "/admin/fleet" },
  { key: "pricing", label: "Tarifs par période", href: "/admin/pricing" },
  { key: "garage", label: "Garage", href: "/admin/garage" },
  { key: "locations", label: "Agences", href: "/admin/locations" },
  { key: "options", label: "Options & équipements", href: "/admin/options" },
  { key: "fees", label: "Frais & taxes", href: "/admin/fees" },
  { key: "finance", label: "Finances", href: "/admin/finance" },
  { key: "promotions", label: "Promotions", href: "/admin/promotions" },
  { key: "customers", label: "Clients", href: "/admin/customers" },
  { key: "notifications", label: "Notifications", href: "/admin/notifications" },
  { key: "emails", label: "Emails", href: "/admin/emails" },
  { key: "settings", label: "Paramètres", href: "/admin/settings" },
  { key: "users", label: "Utilisateurs & rôles", href: "/admin/users" },
] as const;

export type SectionKey = (typeof ADMIN_SECTIONS)[number]["key"];
export type RolePermissions = Record<StaffRole, Record<SectionKey, AccessLevel>>;

const all = (level: AccessLevel) =>
  Object.fromEntries(ADMIN_SECTIONS.map((s) => [s.key, level])) as Record<SectionKey, AccessLevel>;

export const DEFAULT_ROLE_PERMISSIONS: RolePermissions = {
  admin: { ...all("edit"), users: "none" },
  manager: { ...all("edit"), settings: "view", emails: "view", finance: "view", users: "none" },
  staff: {
    ...all("none"),
    dashboard: "view",
    bookings: "edit",
    calendar: "view",
    fleet: "view",
    garage: "edit",
    locations: "view",
    customers: "view",
    notifications: "edit",
  },
};

export const ROLE_LABELS: Record<string, string> = {
  superadmin: "Super admin",
  admin: "Administrateur",
  manager: "Manager",
  staff: "Agent (accès limité)",
};

/** Section matching an admin pathname (longest href prefix wins). */
export function sectionForPath(pathname: string): SectionKey | null {
  if (pathname === "/admin" || pathname === "/admin/") return "dashboard";
  const match = ADMIN_SECTIONS.filter((s) => s.href !== "/admin" && pathname.startsWith(s.href)).sort(
    (a, b) => b.href.length - a.href.length
  )[0];
  return match ? match.key : null;
}
