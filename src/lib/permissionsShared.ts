/**
 * Client-safe RBAC definitions: resources, their actions and the system roles.
 * A permission is the string `${resource}.${action}` (e.g. "bookings.cancel").
 */

export type Action = "view" | "create" | "edit" | "delete" | "cancel" | "export" | "upload";

export interface ResourceDef {
  key: string;
  label: string;
  group: string;
  href?: string;
  actions: Action[];
}

export const ACTION_LABELS: Record<Action, string> = {
  view: "Voir",
  create: "Créer",
  edit: "Modifier",
  delete: "Supprimer",
  cancel: "Annuler",
  export: "Exporter",
  upload: "Téléverser",
};

export const RESOURCES: ResourceDef[] = [
  { key: "dashboard", label: "Tableau de bord", group: "Pilotage", href: "/admin", actions: ["view"] },
  { key: "reporting", label: "Rapports", group: "Pilotage", actions: ["view", "export"] },
  { key: "bookings", label: "Réservations", group: "Réservations", href: "/admin/bookings", actions: ["view", "create", "edit", "cancel", "delete", "export"] },
  { key: "calendar", label: "Calendrier", group: "Réservations", href: "/admin/calendar", actions: ["view"] },
  { key: "steps", label: "Étapes de réservation", group: "Réservations", href: "/admin/steps", actions: ["view", "edit"] },
  { key: "customers", label: "Clients", group: "Réservations", href: "/admin/customers", actions: ["view", "create", "edit", "delete", "export"] },
  { key: "fleet", label: "Flotte & véhicules", group: "Flotte", href: "/admin/fleet", actions: ["view", "create", "edit", "delete"] },
  { key: "pricing", label: "Tarifs par période", group: "Flotte", href: "/admin/pricing", actions: ["view", "edit"] },
  { key: "garage", label: "Garage", group: "Flotte", href: "/admin/garage", actions: ["view", "edit"] },
  { key: "locations", label: "Agences", group: "Flotte", href: "/admin/locations", actions: ["view", "create", "edit", "delete"] },
  { key: "media", label: "Médias (photos)", group: "Flotte", actions: ["upload", "edit", "delete"] },
  { key: "options", label: "Options & équipements", group: "Commerce", href: "/admin/options", actions: ["view", "create", "edit", "delete"] },
  { key: "fees", label: "Frais & taxes", group: "Commerce", href: "/admin/fees", actions: ["view", "edit"] },
  { key: "promotions", label: "Promotions", group: "Commerce", href: "/admin/promotions", actions: ["view", "create", "edit", "delete"] },
  { key: "finance", label: "Finances", group: "Commerce", href: "/admin/finance", actions: ["view", "export"] },
  { key: "notifications", label: "Notifications", group: "Communication", href: "/admin/notifications", actions: ["view", "edit"] },
  { key: "emails", label: "Emails", group: "Communication", href: "/admin/emails", actions: ["view", "edit"] },
  { key: "settings", label: "Paramètres", group: "Système", href: "/admin/settings", actions: ["view", "edit"] },
  { key: "users", label: "Utilisateurs", group: "Système", href: "/admin/users", actions: ["view", "create", "edit", "delete"] },
  { key: "roles", label: "Rôles & permissions", group: "Système", href: "/admin/roles", actions: ["view", "create", "edit", "delete"] },
];

export const ALL_PERMISSIONS: string[] = RESOURCES.flatMap((r) => r.actions.map((a) => `${r.key}.${a}`));

/** Legacy coarse key kept for the menu / page guards. */
export type SectionKey = string;
export type AccessLevel = "none" | "view" | "edit";

export interface RoleDef {
  key: string;
  name: string;
  description?: string;
  permissions: string[];
  isSystem: boolean;
  color?: string;
}

const all = (resources: string[], actions?: Action[]) =>
  RESOURCES.filter((r) => resources.includes(r.key)).flatMap((r) =>
    r.actions.filter((a) => !actions || actions.includes(a)).map((a) => `${r.key}.${a}`)
  );
const every = (exclude: string[] = []) => RESOURCES.filter((r) => !exclude.includes(r.key)).map((r) => r.key);

export const SUPERADMIN_KEY = "superadmin";

export const SYSTEM_ROLES: RoleDef[] = [
  {
    key: "superadmin",
    name: "Super admin",
    description: "Accès total, non modifiable.",
    permissions: ALL_PERMISSIONS,
    isSystem: true,
    color: "violet",
  },
  {
    key: "admin",
    name: "Administrateur",
    description: "Gère toute l'agence sauf les utilisateurs et les rôles.",
    permissions: [...all(every(["users", "roles"])), "users.view", "roles.view"],
    isSystem: true,
    color: "blue",
  },
  {
    key: "manager",
    name: "Manager",
    description: "Opérations, flotte et commerce ; paramètres en lecture.",
    permissions: [
      ...all(every(["users", "roles", "settings", "emails", "finance"])),
      "settings.view",
      "emails.view",
      "finance.view",
    ],
    isSystem: true,
    color: "emerald",
  },
  {
    key: "staff",
    name: "Agent (accès limité)",
    description: "Comptoir : réservations, garage et notifications.",
    permissions: [
      "dashboard.view",
      "bookings.view",
      "bookings.create",
      "bookings.edit",
      "calendar.view",
      "customers.view",
      "fleet.view",
      "garage.view",
      "garage.edit",
      "locations.view",
      "notifications.view",
      "notifications.edit",
      "media.upload",
    ],
    isSystem: true,
    color: "amber",
  },
];

/** Section (menu) access derived from granular permissions. */
export function sectionAccess(permissions: Set<string> | string[], resource: string): AccessLevel {
  const set = permissions instanceof Set ? permissions : new Set(permissions);
  const def = RESOURCES.find((r) => r.key === resource);
  if (!def) return "none";
  const has = def.actions.filter((a) => set.has(`${resource}.${a}`));
  if (has.length === 0) return "none";
  return has.some((a) => a !== "view") ? "edit" : "view";
}

/** Section matching an admin pathname (longest href prefix wins). */
export function sectionForPath(pathname: string): SectionKey | null {
  if (pathname === "/admin" || pathname === "/admin/") return "dashboard";
  const match = RESOURCES.filter((s) => s.href && s.href !== "/admin" && pathname.startsWith(s.href)).sort(
    (a, b) => (b.href || "").length - (a.href || "").length
  )[0];
  return match ? match.key : null;
}

export function slugifyRoleKey(name: string): string {
  return (
    name
      .normalize("NFD")
      .replace(/[̀-ͯ]/g, "")
      .toLowerCase()
      .replace(/[^a-z0-9]+/g, "_")
      .replace(/^_+|_+$/g, "")
      .slice(0, 40) || "role"
  );
}

/** Back-compat label map (system roles); custom roles carry their own name. */
export const ROLE_LABELS: Record<string, string> = Object.fromEntries(SYSTEM_ROLES.map((r) => [r.key, r.name]));
