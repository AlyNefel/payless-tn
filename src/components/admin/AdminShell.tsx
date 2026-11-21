"use client";

import React, { Suspense, useState, useEffect } from "react";
import Link from "next/link";
import {
  LayoutDashboard,
  Car,
  CalendarDays,
  CalendarCheck2,
  Users,
  Tag,
  Receipt,
  Mail,
  Settings,
  Search,
  Bell,
  Plus,
  LogOut,
  ExternalLink,
  Menu,
  X,
  ChevronRight,
  ChevronDown,
  Layers,
  ShieldCheck,
  CheckCircle2,
  AlertTriangle,
  Clock,
  Sparkles,
  MapPin,
  SlidersHorizontal,
  Sun,
  Moon,
  Globe,
  Wrench,
  ListOrdered,
  Droplets,
  ClipboardCheck,
  ShieldAlert,
} from "lucide-react";
import { usePathname, useRouter, useSearchParams } from "next/navigation";
import { signOut } from "next-auth/react";
import { AdminLangProvider, useAdminLang } from "@/contexts/AdminLangContext";
import { RESOURCES, sectionForPath, type AccessLevel } from "@/lib/permissionsShared";
import { loadMe } from "./ui/usePermissions";
import { AdminFooter, BrandBlock, SidebarScene } from "./AdminBrand";
import { NotificationToasts, severityColor, severityIcon, timeAgo, useLiveNotifications } from "./useLiveNotifications";

interface NavItem {
  title: string;
  href: string;
  icon: React.ComponentType<{ className?: string }>;
  badge?: string;
}

interface NavGroup {
  id: string;
  groupTitle: { fr: string; en: string };
  icon: React.ComponentType<{ className?: string }>;
  items: NavItem[];
}

const NAV_GROUPS: NavGroup[] = [
  {
    id: "overview",
    groupTitle: { fr: "Vue d'ensemble", en: "Overview" },
    icon: LayoutDashboard,
    items: [
      { title: "Tableau de bord", href: "/admin", icon: LayoutDashboard },
      { title: "Espace assistance", href: "/admin/worker", icon: CheckCircle2 },
      { title: "Calendrier Flotte", href: "/admin/calendar", icon: CalendarDays },
    ],
  },
  {
    id: "operations",
    groupTitle: { fr: "Réservations & Planning", en: "Bookings & Planning" },
    icon: CalendarCheck2,
    items: [
      { title: "Reservation Manager", href: "/admin/bookings", icon: CalendarCheck2 },
      { title: "Étapes de Réservation", href: "/admin/steps", icon: ListOrdered },
    ],
  },
  {
    id: "fleet_management",
    groupTitle: { fr: "Flotte & Véhicules", en: "Fleet & Vehicles" },
    icon: Car,
    items: [
      { title: "Car Model Manager", href: "/admin/fleet", icon: Car },
      { title: "Location Manager", href: "/admin/locations", icon: MapPin },
    ],
  },
  {
    id: "finance_pricing",
    groupTitle: { fr: "Tarifs, Extras & Finances", en: "Rates, Extras & Finance" },
    icon: Receipt,
    items: [
      { title: "Tarifs par Période", href: "/admin/pricing", icon: Tag },
      { title: "Options & Équipements", href: "/admin/options", icon: SlidersHorizontal },
      { title: "Frais & Taxes (démo)", href: "/admin/fees", icon: SlidersHorizontal },
      { title: "Promos & Coupons", href: "/admin/promotions", icon: Tag },
    ],
  },
  {
    id: "garage",
    groupTitle: { fr: "Garage", en: "Garage" },
    icon: Wrench,
    items: [
      { title: "Vidange", href: "/admin/garage?tab=vidange", icon: Droplets },
      { title: "Maintenance", href: "/admin/garage?tab=maintenance", icon: Wrench },
      { title: "Visite technique", href: "/admin/garage?tab=inspection", icon: ClipboardCheck },
      { title: "Assurance", href: "/admin/garage?tab=assurance", icon: ShieldAlert },
    ],
  },
  {
    id: "accounting",
    groupTitle: { fr: "Comptabilité", en: "Accounting" },
    icon: Receipt,
    items: [
      { title: "Tableau de bord comptable", href: "/admin/accounting", icon: Receipt },
      { title: "Encaissements", href: "/admin/accounting?tab=payments", icon: Receipt },
      { title: "Dépenses", href: "/admin/accounting?tab=expenses", icon: Receipt },
      { title: "Contrats & factures", href: "/admin/accounting?tab=documents", icon: Receipt },
      { title: "Caisse", href: "/admin/accounting?tab=cash", icon: Receipt },
      { title: "Rapports", href: "/admin/accounting?tab=reports", icon: Receipt },
    ],
  },
  {
    id: "crm_comms",
    groupTitle: { fr: "Clients & Communications", en: "CRM & Communications" },
    icon: Users,
    items: [
      { title: "Customer Manager", href: "/admin/customers", icon: Users },
      { title: "Notification Manager", href: "/admin/notifications", icon: Bell },
      { title: "Journal Emails & Templates", href: "/admin/emails", icon: Mail },
    ],
  },
  {
    id: "system",
    groupTitle: { fr: "Système & Configuration", en: "System & Settings" },
    icon: Settings,
    items: [
      { title: "Paramètres Agence", href: "/admin/settings", icon: Settings },
      { title: "Utilisateurs", href: "/admin/users", icon: Users },
      { title: "Agents d'assistance", href: "/admin/users?role=worker", icon: Users },
      { title: "Comptables", href: "/admin/users?role=accountant", icon: Users },
      { title: "Journal d'audit", href: "/admin/audit", icon: ShieldCheck },
      { title: "Rôles & permissions", href: "/admin/roles", icon: ShieldCheck },
    ],
  },
  {
    id: "all_managers",
    groupTitle: { fr: "Tous les Managers (Raccourcis)", en: "All Managers (Quick Access)" },
    icon: Layers,
    items: [
      { title: "Car Model Manager", href: "/admin/fleet", icon: Car },
      { title: "Tarifs par Période", href: "/admin/pricing", icon: Tag },
      { title: "Garage & Vidanges", href: "/admin/garage", icon: Wrench },
      { title: "Tarifs Flotte", href: "/admin/fleet", icon: Car },
      { title: "Customer Manager", href: "/admin/customers", icon: Users },
      { title: "Notification Manager", href: "/admin/notifications", icon: Bell },
      { title: "Options & Équipements", href: "/admin/options", icon: SlidersHorizontal },
      { title: "Location Manager", href: "/admin/locations", icon: MapPin },
      { title: "Frais & Taxes Manager", href: "/admin/fees", icon: SlidersHorizontal },
      { title: "Reservation Manager", href: "/admin/bookings", icon: CalendarCheck2 },
      { title: "Étapes de Réservation", href: "/admin/steps", icon: ListOrdered },
    ],
  },
];


/** The read-only notice only makes sense on sections that have something to edit. */
const READ_ONLY_RELEVANT = (section: string | null) =>
  Boolean(section) && (RESOURCES.find((r) => r.key === section)?.actions || []).some((a) => a !== "view");

/** Reports the current query string (kept in its own Suspense boundary so pages never wait for it). */
function QueryWatcher({ onChange }: { onChange: (q: string) => void }) {
  const params = useSearchParams();
  const q = params.toString();
  useEffect(() => onChange(q), [q, onChange]);
  return null;
}

/**
 * Menu entry state, query-aware: "/admin/garage?tab=assurance" is active only on that section;
 * an entry without a query is active when no sibling entry of the same page matches the query.
 */
function navMatch(href: string, pathname: string, query: string, siblings: string[]): boolean {
  const [path, qs] = href.split("?");
  if (path === "/admin") return pathname === "/admin";
  if (!(pathname === path || pathname.startsWith(`${path}/`))) return false;
  const current = new URLSearchParams(query);
  if (qs) {
    const want = new URLSearchParams(qs);
    for (const [k, v] of want) {
      // First section of a page = its default (no ?tab=): Vidange for the garage.
      const first = siblings.filter((h) => h.split("?")[0] === path && h.includes("?"))[0];
      const isDefault = first === href && !current.get(k);
      if (current.get(k) !== v && !isDefault) return false;
    }
    return true;
  }
  // No query on this entry: active unless a sibling entry with a query matches better.
  return !siblings.some((h) => h !== href && h.startsWith(`${path}?`) && navMatch(h, pathname, query, []));
}

function AdminLayoutContent({
  children,
}: {
  children: React.ReactNode;
}) {
  const { lang, setLang, t } = useAdminLang();
  const pathname = usePathname();
  const [query, setQuery] = useState("");
  const router = useRouter();
  const [mobileMenuOpen, setMobileMenuOpen] = useState(false);
  const [notificationsOpen, setNotificationsOpen] = useState(false);
  const live = useLiveNotifications(pathname !== "/admin/login", lang === "en" ? "en" : "fr");

  // Role-based access: which sections the signed-in user may see / edit.
  const [access, setAccess] = useState<Record<string, AccessLevel> | null>(null);
  const [me, setMe] = useState<{ name?: string; email?: string; role?: string; roleName?: string } | null>(null);
  useEffect(() => {
    if (pathname === "/admin/login") return;
    loadMe(true).then((d) => {
      if (d) {
        setAccess(d.access);
        setMe(d.user);
      }
    });
  }, [pathname === "/admin/login"]);
  const canSee = (href: string) => {
    if (!access) return true; // until loaded: APIs still enforce permissions server-side
    const key = sectionForPath(href);
    return !key || (access[key] && access[key] !== "none");
  };
  const visibleGroups = NAV_GROUPS.map((g) => ({ ...g, items: g.items.filter((i) => canSee(i.href)) })).filter(
    (g) => g.items.length > 0
  );
  const currentSection = sectionForPath(pathname);
  const currentAccess: AccessLevel = access && currentSection ? access[currentSection] || "none" : "edit";
  const [showSearchModal, setShowSearchModal] = useState(false);
  const [showQuickBookingModal, setShowQuickBookingModal] = useState(false);
  const [theme, setTheme] = useState<"dark" | "light">("light");

  // Track expanded groups in sidebar (accordion / collapsible submenus)
  const [collapsedGroups, setCollapsedGroups] = useState<Record<string, boolean>>({
    all_managers: true, // collapsed by default to keep sidebar compact
  });

  const toggleGroup = (groupId: string) => {
    setCollapsedGroups((prev) => ({
      ...prev,
      [groupId]: !prev[groupId],
    }));
  };

  // Live data for Quick Booking modal (direct reservation)
  const [adminLocations, setAdminLocations] = useState<any[]>([]);
  const [adminVehicles, setAdminVehicles] = useState<any[]>([]);
  const [quickForm, setQuickForm] = useState(() => {
    const pDate = new Date();
    pDate.setDate(pDate.getDate() + 1);
    const rDate = new Date();
    rDate.setDate(rDate.getDate() + 4);
    return {
      customerName: "",
      phone: "",
      email: "",
      vehicleId: "",
      pickupLocationId: "",
      returnLocationId: "",
      pickupDate: pDate.toISOString().split("T")[0],
      returnDate: rDate.toISOString().split("T")[0],
    };
  });
  const [isSubmittingQuick, setIsSubmittingQuick] = useState(false);
  const [quickResult, setQuickResult] = useState<null | {
    reference: string;
    bookingId?: string;
    plates?: string;
    whatsappUrl?: string;
  }>(null);
  const [quickError, setQuickError] = useState("");

  useEffect(() => {
    fetch("/api/locations")
      .then((r) => r.json())
      .then((res) => {
        if (res.success && Array.isArray(res.locations) && res.locations.length > 0) {
          setAdminLocations(res.locations);
          setQuickForm((f) => ({
            ...f,
            pickupLocationId: f.pickupLocationId || res.locations[0]._id,
            returnLocationId: f.returnLocationId || res.locations[0]._id,
          }));
        }
      })
      .catch(() => {});

    fetch("/api/vehicles?limit=100")
      .then((r) => r.json())
      .then((res) => {
        if (res.success && Array.isArray(res.vehicles) && res.vehicles.length > 0) {
          setAdminVehicles(res.vehicles);
          setQuickForm((f) => ({
            ...f,
            vehicleId: f.vehicleId || res.vehicles[0]._id,
          }));
        }
      })
      .catch(() => {});
  }, []);

  const handleQuickBookingSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setIsSubmittingQuick(true);
    setQuickError("");
    try {
      const nameParts = quickForm.customerName.trim().split(" ");
      const firstName = nameParts[0] || "Client";
      const lastName = nameParts.slice(1).join(" ") || "Direct";
      const email = quickForm.email.trim() || `client.${Date.now()}@payless.tn`;

      const selectedVeh = adminVehicles.find((v) => v._id === quickForm.vehicleId) || adminVehicles[0];
      const selectedPickup = adminLocations.find((l) => l._id === quickForm.pickupLocationId) || adminLocations[0];
      const selectedReturn = adminLocations.find((l) => l._id === quickForm.returnLocationId) || selectedPickup;

      if (!selectedPickup?._id) {
        setQuickError("Aucune agence active : créez d'abord une agence dans « Agences ».");
        setIsSubmittingQuick(false);
        return;
      }
      if (!selectedVeh) {
        setQuickError("Veuillez sélectionner un véhicule.");
        setIsSubmittingQuick(false);
        return;
      }

      const payload = {
        vehicleId: selectedVeh._id,
        pickupLocationId: selectedPickup?._id,
        returnLocationId: selectedReturn?._id || selectedPickup?._id,
        pickupDate: quickForm.pickupDate,
        returnDate: quickForm.returnDate,
        customer: {
          firstName,
          lastName,
          email,
          phone: quickForm.phone.trim() || "+216 22 123 456",
          country: "Tunisie",
          preferredLanguage: lang,
        },
        customerNotes: "Réservation directe créée par l'administrateur (Comptoir / Téléphone)",
        customerLanguage: lang,
        accountOption: "guest",
      };

      const res = await fetch("/api/bookings", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(payload),
      });

      const data = await res.json();
      if (data.success) {
        setQuickResult({
          reference: data.bookingReference,
          bookingId: data.bookingId,
          plates: data.assignedPlates,
          whatsappUrl: data.whatsappUrl,
        });
        setQuickForm((f) => ({ ...f, customerName: "", phone: "", email: "" }));
      } else {
        setQuickError(data.error || "Erreur lors de la création de la réservation.");
      }
    } catch (err) {
      setQuickError("Erreur de connexion avec le serveur.");
    } finally {
      setIsSubmittingQuick(false);
    }
  };

  const getNavTitle = (href: string, fallback: string) => {
    if (href === "/admin") return lang === "fr" ? "Tableau de bord" : "Dashboard";
    if (href === "/admin/fleet") return lang === "fr" ? "Gestion Flotte" : "Fleet Manager";
    if (href === "/admin/pricing") return lang === "fr" ? "Tarifs par Période" : "Period Pricing";
    if (href === "/admin/bookings") return lang === "fr" ? "Réservations" : "Reservations";
    if (href === "/admin/steps") return lang === "fr" ? "Étapes de Réservation" : "Reservation Steps";
    if (href === "/admin/calendar") return lang === "fr" ? "Calendrier Flotte" : "Fleet Calendar";
    if (href === "/admin/garage") return lang === "fr" ? "Garage & Vidanges" : "Garage & Maintenance";
    if (href === "/admin/locations") return lang === "fr" ? "Agences & Villes" : "Agencies & Locations";
    if (href === "/admin/options") return lang === "fr" ? "Options & Équipements" : "Options & Equipment";
    if (href === "/admin/fees") return lang === "fr" ? "Frais & Taxes (démo)" : "Fees & Taxes (demo)";
    if (href === "/admin/customers") return lang === "fr" ? "Clients (CRM)" : "Customers (CRM)";
    if (href === "/admin/finance") return lang === "fr" ? "Finances & Règlements" : "Finance & Payments";
    if (href === "/admin/promotions") return lang === "fr" ? "Codes Promo" : "Promo Codes";
    if (href === "/admin/notifications") return lang === "fr" ? "Notifications" : "Notifications";
    if (href === "/admin/emails") return lang === "fr" ? "Journal Emails" : "Email Logs";
    if (href === "/admin/settings") return lang === "fr" ? "Paramètres" : "Settings";
    if (href === "/admin/users") return lang === "fr" ? "Utilisateurs" : "Users";
    if (href === "/admin/users?role=worker") return lang === "fr" ? "Agents d'assistance" : "Assistance workers";
    if (href === "/admin/worker") return lang === "fr" ? "Espace assistance" : "Assistance workspace";
    if (href === "/admin/roles") return lang === "fr" ? "Rôles & permissions" : "Roles & permissions";
    return fallback;
  };

  // Load and apply theme
  useEffect(() => {
    const savedTheme = localStorage.getItem("payless-admin-theme") as "dark" | "light" | null;
    if (savedTheme) {
      setTheme(savedTheme);
      if (savedTheme === "dark") {
        document.documentElement.classList.add("dark");
      } else {
        document.documentElement.classList.remove("dark");
      }
    } else {
      document.documentElement.classList.remove("dark");
    }
  }, []);

  const toggleTheme = () => {
    const newTheme = theme === "dark" ? "light" : "dark";
    setTheme(newTheme);
    localStorage.setItem("payless-admin-theme", newTheme);
    if (newTheme === "dark") {
      document.documentElement.classList.add("dark");
    } else {
      document.documentElement.classList.remove("dark");
    }
  };

  // Close mobile menu on route change
  useEffect(() => {
    setMobileMenuOpen(false);
    setNotificationsOpen(false);
  }, [pathname]);

  // If path is /admin/login, render children cleanly without the dashboard shell
  if (pathname === "/admin/login") {
    return <>{children}</>;
  }

  const unreadCount = live.unreadCount;
  const markAllAsRead = () => live.markAllRead();

  const handleSignOut = async () => {
    document.cookie =
      "authjs.session-token=; path=/; expires=Thu, 01 Jan 1970 00:00:00 GMT";
    await signOut({ redirect: false });
    router.push("/admin/login");
  };

  return (
    <div className="min-h-screen bg-[#eef3fb] dark:bg-black text-slate-900 dark:text-slate-100 flex flex-col lg:flex-row antialiased transition-colors duration-300 selection:bg-blue-600 selection:text-white">
      <Suspense fallback={null}>
        <QueryWatcher onChange={setQuery} />
      </Suspense>
      {/* DESKTOP SIDEBAR */}
      <aside className="hidden lg:flex flex-col w-72 shrink-0 bg-gradient-to-b from-[#0a2463] via-[#0d3488] to-[#0a2463] text-white sticky top-0 h-screen z-30 shadow-[4px_0_24px_rgba(10,36,99,0.25)]">
        {/* Brand Header */}
        <div className="px-6 pt-6 pb-4">
          <BrandBlock />
        </div>

        {/* Navigation Groups with Collapsible Submenus */}
        <div className="flex-1 overflow-y-auto px-3.5 py-2 space-y-1.5 admin-sidebar-scroll">
          {visibleGroups.map((group) => {
            const GroupIcon = group.icon;
            const title = lang === "en" ? group.groupTitle.en : group.groupTitle.fr;
            const isCollapsed = Boolean(collapsedGroups[group.id]);
            const hasActiveChild = group.items.some(
              (item) => navMatch(item.href, pathname, query, [])
            );

            return (
              <div
                key={group.id}
                className={`rounded-2xl transition-all duration-200 ${
                  group.id === "all_managers"
                    ? "bg-white/5 border border-white/10 p-1"
                    : ""
                }`}
              >
                {/* Group Header Button (Accordion toggle) */}
                <button
                  type="button"
                  onClick={() => toggleGroup(group.id)}
                  className={`w-full px-3 py-2 flex items-center justify-between rounded-xl text-left transition-colors cursor-pointer group ${
                    hasActiveChild && isCollapsed
                      ? "bg-white/10 text-white"
                      : "text-blue-100/75 hover:text-white hover:bg-white/10"
                  }`}
                >
                  <div className="flex items-center gap-2">
                    <GroupIcon className={`w-3.5 h-3.5 ${hasActiveChild ? "text-white" : "text-blue-200/70"}`} />
                    <span className="text-[11px] font-black uppercase tracking-wider truncate">
                      {title}
                    </span>
                  </div>

                  <div className="flex items-center gap-1.5 shrink-0">
                    {group.id === "all_managers" && (
                      <span className="text-[9px] font-bold px-1.5 py-0.2 rounded-full bg-white/15 text-white">
                        {group.items.length}
                      </span>
                    )}
                    <ChevronDown
                      className={`w-3.5 h-3.5 transition-transform duration-200 ${
                        isCollapsed ? "-rotate-90 text-blue-200/60" : "rotate-0 text-blue-100"
                      }`}
                    />
                  </div>
                </button>

                {/* Submenu Items with smooth expand */}
                {!isCollapsed && (
                  <div className="space-y-0.5 pt-1 pl-1.5 pr-0.5 animate-in fade-in slide-in-from-top-1 duration-150">
                    {group.items.map((item) => {
                      const Icon = item.icon;
                      const isActive = navMatch(item.href, pathname, query, group.items.map((i) => i.href));

                      return (
                        <Link
                          key={item.href + item.title}
                          href={item.href}
                          className={`flex items-center justify-between px-3 py-2.5 rounded-xl text-[13px] font-semibold transition-all group ${
                            isActive
                              ? "bg-[#1d6ff2] text-white shadow-lg shadow-black/25"
                              : "text-blue-50/90 hover:text-white hover:bg-white/10"
                          }`}
                        >
                          <div className="flex items-center gap-2.5 min-w-0">
                            <Icon
                              className={`w-4 h-4 shrink-0 transition-transform group-hover:scale-110 ${
                                isActive
                                  ? "text-white"
                                  : "text-blue-200/80 group-hover:text-white"
                              }`}
                            />
                            <span className="truncate">{getNavTitle(item.href, item.title)}</span>
                          </div>
                        </Link>
                      );
                    })}
                  </div>
                )}
              </div>
            );
          })}
        </div>

        <SidebarScene />

        {/* User Card & Logout */}
        <div className="px-4 py-3 bg-[#0a2463] border-t border-white/10">
          <div className="p-2.5 rounded-xl bg-white/10 border border-white/10 flex items-center justify-between">
            <div className="flex items-center gap-2.5">
              <div className="w-9 h-9 rounded-full bg-gradient-to-tr from-blue-600 to-indigo-600 flex items-center justify-center text-white font-bold text-xs shadow-md shadow-blue-600/20">
                {(me?.name || "A").charAt(0).toUpperCase()}
              </div>
              <div className="overflow-hidden">
                <p className="text-xs font-bold text-white truncate">
                  {me?.name || "…"}
                </p>
                <p className="text-[10px] text-blue-100/70 truncate">
                  {me?.roleName || me?.role || ""}{me?.email ? ` · ${me.email}` : ""}
                </p>
              </div>
            </div>
            <button
              onClick={handleSignOut}
              className="p-1.5 rounded-lg text-blue-100/80 hover:text-white hover:bg-red-500/80 transition-colors"
              title="Se déconnecter"
            >
              <LogOut className="w-4 h-4" />
            </button>
          </div>
        </div>
      </aside>

      {/* MOBILE DRAWER */}
      {mobileMenuOpen && (
        <div className="fixed inset-0 z-50 flex lg:hidden">
          <div
            onClick={() => setMobileMenuOpen(false)}
            className="fixed inset-0 bg-black/60 backdrop-blur-sm transition-opacity"
          />
          <div className="relative w-72 max-w-[82vw] bg-gradient-to-b from-[#0a2463] via-[#0d3488] to-[#0a2463] text-white flex flex-col h-full z-10 p-4">
            <div className="flex items-start justify-between pb-3 border-b border-white/10">
              <div className="flex-1">
                <BrandBlock compact />
              </div>
              <button
                onClick={() => setMobileMenuOpen(false)}
                aria-label="Fermer le menu"
                className="p-1.5 rounded-lg text-blue-100 hover:bg-white/10"
              >
                <X className="w-5 h-5" />
              </button>
            </div>

            <div className="flex-1 overflow-y-auto py-3 space-y-2">
              {visibleGroups.map((group) => {
                const GroupIcon = group.icon;
                const title = lang === "en" ? group.groupTitle.en : group.groupTitle.fr;
                const isCollapsed = Boolean(collapsedGroups[group.id]);
                const hasActiveChild = group.items.some(
                  (item) => navMatch(item.href, pathname, query, [])
                );

                return (
                  <div key={group.id} className="rounded-xl border border-white/10 p-1">
                    <button
                      type="button"
                      onClick={() => toggleGroup(group.id)}
                      className={`w-full px-2.5 py-1.5 flex items-center justify-between rounded-lg text-left transition-colors ${
                        hasActiveChild && isCollapsed
                          ? "bg-white/10 text-white"
                          : "text-blue-100/80"
                      }`}
                    >
                      <div className="flex items-center gap-2">
                        <GroupIcon className="w-3.5 h-3.5 text-blue-200" />
                        <span className="text-[10px] font-black uppercase tracking-wider">{title}</span>
                      </div>
                      <ChevronDown
                        className={`w-3.5 h-3.5 transition-transform duration-200 ${
                          isCollapsed ? "-rotate-90" : "rotate-0"
                        }`}
                      />
                    </button>

                    {!isCollapsed && (
                      <div className="space-y-0.5 pt-1 pl-1">
                        {group.items.map((item) => {
                          const Icon = item.icon;
                          const isActive = navMatch(item.href, pathname, query, group.items.map((i) => i.href));
                          return (
                            <Link
                              key={item.href + item.title}
                              href={item.href}
                              onClick={() => setMobileMenuOpen(false)}
                              className={`flex items-center justify-between px-2.5 py-1.5 rounded-lg text-xs font-semibold ${
                                isActive
                                  ? "bg-[#1d6ff2] text-white shadow-sm"
                                  : "text-blue-50/90 hover:bg-white/10"
                              }`}
                            >
                              <div className="flex items-center gap-2">
                                <Icon className="w-3.5 h-3.5" />
                                <span>{getNavTitle(item.href, item.title)}</span>
                              </div>
                            </Link>
                          );
                        })}
                      </div>
                    )}
                  </div>
                );
              })}
            </div>

            <div className="pt-3 border-t border-white/10">
              <button
                onClick={handleSignOut}
                className="w-full flex items-center gap-2 px-3 py-2 rounded-xl text-xs font-semibold text-white hover:bg-red-500/80"
              >
                <LogOut className="w-4 h-4" />
                <span>Déconnexion</span>
              </button>
            </div>
          </div>
        </div>
      )}

      {/* MAIN VIEWPORT */}
      <div className="flex-1 flex flex-col min-w-0 w-full overflow-x-hidden">
        {/* TOP NAVIGATION BAR */}
        <header className="h-16 sm:h-20 bg-white dark:bg-[#0a0a0a]/90 border-b border-slate-200/70 dark:border-neutral-800 shadow-[0_2px_16px_rgba(10,36,99,0.06)] px-3 sm:px-6 md:px-8 flex items-center justify-between sticky top-0 z-20 transition-colors duration-300 w-full max-w-full">
          {/* Mobile hamburger & search */}
          <div className="flex items-center gap-2 sm:gap-4 shrink-0">
            <button
              onClick={() => setMobileMenuOpen(true)}
              className="lg:hidden p-2 sm:p-2.5 rounded-xl bg-slate-100 dark:bg-slate-900 border border-slate-200 dark:border-slate-800 text-slate-700 dark:text-slate-300 hover:text-slate-900 dark:hover:text-white shrink-0"
              title="Menu Navigation"
            >
              <Menu className="w-5 h-5" />
            </button>

            {/* Mobile-only Search Button */}
            <button
              onClick={() => router.push("/admin/bookings")}
              className="sm:hidden p-2 rounded-xl bg-slate-100 dark:bg-slate-900 border border-slate-200 dark:border-slate-800 text-slate-600 dark:text-slate-400 hover:text-slate-900 dark:hover:text-white shrink-0"
              title="Rechercher"
            >
              <Search className="w-4 h-4" />
            </button>

            {/* Desktop/Tablet Quick Search trigger */}
            <div
              onClick={() => router.push("/admin/bookings")}
              className="hidden sm:flex items-center gap-2 px-3.5 py-2 rounded-xl bg-slate-100 dark:bg-slate-900/90 hover:bg-slate-200/70 dark:hover:bg-slate-800 border border-slate-200 dark:border-slate-800 text-slate-500 dark:text-slate-400 text-xs cursor-pointer transition-all hover:border-slate-300 dark:hover:border-slate-700 sm:w-44 md:w-56 2xl:w-80 shadow-sm"
            >
              <Search className="w-3.5 h-3.5 text-slate-400 shrink-0" />
              <span className="flex-1 truncate">Recherche matricule, client, réf...</span>
              <kbd className="hidden md:inline-block px-1.5 py-0.5 rounded bg-white dark:bg-slate-800 border border-slate-200 dark:border-slate-700 text-[10px] text-slate-500 dark:text-slate-400 font-mono">
                Ctrl+K
              </kbd>
            </div>
          </div>

          {/* Right actions */}
          <div className="flex items-center gap-1.5 sm:gap-2.5 shrink-0">
            {/* LANGUAGE SWITCHER (FR / EN) */}
            <button
              onClick={() => setLang(lang === "fr" ? "en" : "fr")}
              className="p-1.5 sm:px-3 sm:py-2 rounded-xl bg-slate-100 dark:bg-slate-900 border border-slate-200 dark:border-slate-800 text-slate-800 dark:text-slate-200 hover:bg-slate-200 dark:hover:bg-slate-800 transition-all shadow-sm flex items-center gap-1 font-bold text-xs"
              title={lang === "fr" ? "Switch to English" : "Passer en Français"}
            >
              <Globe className="w-3.5 h-3.5 text-blue-600 dark:text-blue-400 shrink-0" />
              <span className="uppercase text-[11px] sm:text-xs">{lang}</span>
            </button>

            {/* THEME TOGGLE BUTTON (Dark / Light) */}
            <button
              onClick={toggleTheme}
              className="p-2 sm:p-2.5 rounded-xl bg-slate-100 dark:bg-slate-900 border border-slate-200 dark:border-slate-800 text-slate-700 dark:text-amber-400 hover:bg-slate-200 dark:hover:bg-slate-800 transition-all shadow-sm flex items-center gap-1.5"
              title={theme === "dark" ? "Passer en Mode Clair" : "Passer en Mode Sombre"}
            >
              {theme === "dark" ? (
                <>
                  <Sun className="w-4 h-4 text-amber-400 animate-spin-slow shrink-0" />
                  <span className="hidden xl:inline text-[11px] font-semibold text-slate-300">
                    Clair
                  </span>
                </>
              ) : (
                <>
                  <Moon className="w-4 h-4 text-slate-700 shrink-0" />
                  <span className="hidden xl:inline text-[11px] font-semibold text-slate-700">
                    Sombre
                  </span>
                </>
              )}
            </button>

            {/* Quick New Booking Button */}
            <button
              onClick={() => setShowQuickBookingModal(true)}
              className="inline-flex items-center gap-1.5 px-2.5 py-2 sm:px-3.5 sm:py-2 rounded-xl bg-gradient-to-r from-blue-600 to-blue-500 hover:from-blue-500 hover:to-blue-600 text-white text-xs font-semibold shadow-md shadow-blue-600/20 hover:shadow-blue-600/30 transition-all hover:scale-[1.02] active:scale-[0.98]"
            >
              <Plus className="w-3.5 h-3.5 shrink-0" />
              <span className="hidden md:inline">Nouvelle réservation</span>
              <span className="md:hidden text-[11px] font-bold">Créer</span>
            </button>

            {/* Notifications Bell with Popover */}
            <div className="relative">
              <button
                onClick={() => {
                  setNotificationsOpen(!notificationsOpen);
                  live.requestDesktopPermission();
                }}
                className="relative p-2 sm:p-2.5 rounded-xl bg-slate-100 dark:bg-slate-900 border border-slate-200 dark:border-slate-800 text-slate-700 dark:text-slate-300 hover:text-slate-900 dark:hover:text-white transition-colors shadow-sm"
                title="Notifications"
              >
                <Bell className="w-4 h-4" />
                {unreadCount > 0 && (
                  <span className="absolute -top-1 -right-1 flex h-4 min-w-[16px] px-1 items-center justify-center rounded-full bg-red-500 text-[10px] font-bold text-white shadow-md shadow-red-500/50">
                    {unreadCount > 99 ? "99+" : unreadCount}
                  </span>
                )}
              </button>

              {notificationsOpen && (
                <div className="absolute right-0 mt-3 w-80 sm:w-96 rounded-2xl bg-white dark:bg-[#0f141f] border border-slate-200 dark:border-slate-800 shadow-2xl p-4 z-40">
                  <div className="flex items-center justify-between pb-3 border-b border-slate-200 dark:border-slate-800">
                    <div className="flex items-center gap-2">
                      <Bell className="w-4 h-4 text-blue-600 dark:text-blue-400" />
                      <h4 className="text-sm font-bold text-slate-900 dark:text-white">
                        Notifications Récentes
                      </h4>
                    </div>
                    {unreadCount > 0 && (
                      <button
                        onClick={markAllAsRead}
                        className="text-[11px] text-blue-600 dark:text-blue-400 hover:underline font-medium"
                      >
                        Tout marquer lu
                      </button>
                    )}
                  </div>

                  <div className="divide-y divide-slate-100 dark:divide-slate-800/80 max-h-80 overflow-y-auto py-1">
                    {live.items.length === 0 && (
                      <p className="py-6 text-center text-xs text-slate-500">Aucune notification pour le moment.</p>
                    )}
                    {live.items.map((n) => {
                      const Icon = severityIcon(n);
                      const body = (
                        <div className="flex items-start gap-2.5">
                          <Icon className={`w-4 h-4 mt-0.5 shrink-0 ${severityColor[n.severity]}`} />
                          <div className="flex-1 min-w-0">
                            <div className="flex items-start justify-between gap-2">
                              <p className="text-xs font-bold text-slate-900 dark:text-white">{n.title}</p>
                              <span className="text-[10px] text-slate-400 whitespace-nowrap">{timeAgo(n.createdAt, lang === "en" ? "en" : "fr")}</span>
                            </div>
                            <p className="text-[11px] text-slate-600 dark:text-slate-400 mt-0.5">{n.message}</p>
                          </div>
                        </div>
                      );
                      const cls = `block py-3 px-2 rounded-xl transition-colors ${
                        n.unread ? "bg-blue-50/50 dark:bg-blue-900/10" : "hover:bg-slate-50 dark:hover:bg-slate-800/40"
                      }`;
                      return n.link ? (
                        <Link
                          key={n.id}
                          href={n.link}
                          className={cls}
                          onClick={() => {
                            live.markRead(n.id);
                            setNotificationsOpen(false);
                          }}
                        >
                          {body}
                        </Link>
                      ) : (
                        <button key={n.id} type="button" className={`${cls} w-full text-left`} onClick={() => live.markRead(n.id)}>
                          {body}
                        </button>
                      );
                    })}
                  </div>

                  <div className="pt-2 border-t border-slate-200 dark:border-slate-800 text-center">
                    <Link
                      href="/admin/notifications"
                      onClick={() => setNotificationsOpen(false)}
                      className="text-xs text-blue-600 dark:text-blue-400 hover:underline font-semibold"
                    >
                      Voir le centre de notifications →
                    </Link>
                  </div>
                </div>
              )}
            </div>

            {/* Visit Public Site */}
            <Link
              href="/fr"
              target="_blank"
              className="hidden lg:flex items-center gap-1.5 px-3 py-2 rounded-xl bg-slate-100 dark:bg-slate-900 border border-slate-200 dark:border-slate-800 text-slate-600 dark:text-slate-400 hover:text-slate-900 dark:hover:text-white text-xs font-medium transition-colors shadow-sm"
              title="Ouvrir le site public"
            >
              <ExternalLink className="w-3.5 h-3.5" aria-hidden />
              <span className="hidden xl:inline">Voir le site</span>
              <span className="sr-only xl:hidden">Voir le site</span>
            </Link>

            {/* Signed-in user + country (decorative, as on the mock-ups) */}
            <div className="hidden md:flex items-center gap-2 pl-2 ml-1 border-l border-slate-200 dark:border-slate-800">
              <span className="w-9 h-9 rounded-full bg-gradient-to-br from-[#1d6ff2] to-[#0a2463] text-white flex items-center justify-center text-sm font-bold shadow" aria-hidden>
                {(me?.name || "A").charAt(0).toUpperCase()}
              </span>
              <span className="hidden 2xl:block text-sm font-bold text-[#0a2463] dark:text-white max-w-[9rem] truncate">{me?.name || "Admin"}</span>
              <span className="w-9 h-6 rounded-md overflow-hidden shadow ring-1 ring-black/5" title="Tunisie" aria-label="Tunisie">
                <svg viewBox="0 0 30 20" className="w-full h-full" aria-hidden>
                  <rect width="30" height="20" fill="#e70013" />
                  <circle cx="15" cy="10" r="5" fill="#fff" />
                  <circle cx="16" cy="10" r="3.6" fill="#e70013" />
                  <circle cx="17" cy="10" r="2.9" fill="#fff" />
                  <path d="M16.2 10l2.6-.85-1.6 2.2V8.65l1.6 2.2z" fill="#e70013" />
                </svg>
              </span>
            </div>
          </div>
        </header>

        {/* PAGE CONTENT CONTAINER */}
        <main className="flex-1 p-4 md:p-8 overflow-y-auto transition-colors duration-300">
          {currentAccess === "none" ? (
            <div className="max-w-xl mx-auto mt-16 p-8 rounded-2xl bg-white dark:bg-[#0f141f] border border-slate-200 dark:border-slate-800 text-center space-y-3">
              <ShieldCheck className="w-10 h-10 mx-auto text-slate-400" />
              <h1 className="text-lg font-bold text-slate-900 dark:text-white">Accès limité</h1>
              <p className="text-xs text-slate-500">
                Votre rôle ne donne pas accès à cette section. Contactez le super administrateur pour obtenir les droits.
              </p>
              <Link href="/admin" className="inline-block px-4 py-2 rounded-xl bg-blue-600 text-white text-xs font-bold">
                Retour au tableau de bord
              </Link>
            </div>
          ) : (
            <>
              {currentAccess === "view" && READ_ONLY_RELEVANT(currentSection) && (
                <div className="mb-4 p-3 rounded-xl bg-amber-50 dark:bg-amber-950/30 border border-amber-200 dark:border-amber-800 text-amber-900 dark:text-amber-200 text-xs font-semibold flex items-center gap-2">
                  <ShieldCheck className="w-4 h-4 shrink-0" />
                  Accès en lecture seule : les modifications de cette section sont réservées aux rôles autorisés.
                </div>
              )}
              {children}
            </>
          )}
        </main>
        <AdminFooter />
      </div>

      {/* QUICK NEW BOOKING MODAL */}
      <NotificationToasts toasts={live.toasts} onDismiss={live.dismissToast} onOpen={(n) => live.markRead(n.id)} />

      {showQuickBookingModal && (
        <div className="fixed inset-0 z-50 flex items-end sm:items-center justify-center p-0 sm:p-4 bg-black/60 backdrop-blur-sm">
          <div className="w-full sm:max-w-lg max-h-[94vh] overflow-y-auto rounded-t-2xl sm:rounded-2xl bg-white dark:bg-[#0f141f] border border-slate-200 dark:border-slate-700 shadow-2xl p-6 text-slate-900 dark:text-slate-100">
            <div className="flex items-center justify-between pb-4 border-b border-slate-200 dark:border-slate-800">
              <div className="flex items-center gap-2">
                <div className="w-8 h-8 rounded-lg bg-blue-100 dark:bg-blue-600/20 text-blue-600 dark:text-blue-400 flex items-center justify-center">
                  <Plus className="w-4 h-4" />
                </div>
                <div>
                  <h3 className="text-base font-bold text-slate-900 dark:text-white">
                    Créer une Réservation Directe
                  </h3>
                  <p className="text-xs text-slate-500 dark:text-slate-400">
                    Guichet aéroport ou réservation téléphonique
                  </p>
                </div>
              </div>
              <button
                onClick={() => {
                  setShowQuickBookingModal(false);
                  setQuickResult(null);
                }}
                className="p-1.5 rounded-lg hover:bg-slate-100 dark:hover:bg-slate-800 text-slate-400"
              >
                <X className="w-4 h-4" />
              </button>
            </div>

            {quickResult && (
              <div className="mt-4 space-y-4 text-xs">
                <div className="p-4 rounded-xl bg-emerald-50 dark:bg-emerald-950/40 border border-emerald-200 dark:border-emerald-800 text-emerald-900 dark:text-emerald-200">
                  <p className="font-bold text-sm flex items-center gap-2">
                    <CheckCircle2 className="w-4 h-4" /> Réservation {quickResult.reference} créée
                  </p>
                  <p className="mt-1">
                    {quickResult.plates
                      ? `Véhicule affecté automatiquement : ${quickResult.plates}`
                      : "Aucun véhicule libre n'a pu être affecté automatiquement — choisissez-le dans la réservation."}
                  </p>
                </div>
                <div className="grid grid-cols-1 sm:grid-cols-2 gap-2">
                  {quickResult.whatsappUrl && (
                    <a
                      href={quickResult.whatsappUrl}
                      target="_blank"
                      rel="noopener noreferrer"
                      className="inline-flex items-center justify-center gap-2 px-4 py-3 rounded-xl bg-emerald-600 hover:bg-emerald-500 text-white font-bold"
                    >
                      Envoyer la confirmation WhatsApp
                    </a>
                  )}
                  {quickResult.bookingId && (
                    <button
                      type="button"
                      onClick={() => {
                        const id = quickResult.bookingId;
                        setShowQuickBookingModal(false);
                        setQuickResult(null);
                        router.push(`/admin/bookings/${id}`);
                      }}
                      className="inline-flex items-center justify-center gap-2 px-4 py-3 rounded-xl bg-blue-600 hover:bg-blue-500 text-white font-bold"
                    >
                      Ouvrir la réservation
                    </button>
                  )}
                </div>
                <button
                  type="button"
                  onClick={() => setQuickResult(null)}
                  className="w-full px-4 py-2 rounded-xl bg-slate-100 dark:bg-slate-800 text-slate-700 dark:text-slate-300 font-semibold"
                >
                  Créer une autre réservation
                </button>
              </div>
            )}

            {!quickResult && quickError && (
              <div className="mt-3 p-2.5 rounded-xl bg-red-50 dark:bg-red-950/40 border border-red-200 dark:border-red-800 text-xs text-red-600 dark:text-red-400 font-medium">
                {quickError}
              </div>
            )}

            {!quickResult && (
            <form
              onSubmit={handleQuickBookingSubmit}
              className="mt-4 space-y-3.5 text-xs"
            >
              <div>
                <label className="block text-slate-700 dark:text-slate-300 font-semibold mb-1">
                  Nom Complet du Client *
                </label>
                <input
                  type="text"
                  required
                  value={quickForm.customerName}
                  onChange={(e) => setQuickForm({ ...quickForm, customerName: e.target.value })}
                  placeholder="Ex: Mohamed Ben Salem"
                  className="w-full rounded-xl bg-slate-50 dark:bg-slate-900 border border-slate-300 dark:border-slate-700 px-3.5 py-2.5 text-slate-900 dark:text-white focus:outline-none focus:border-blue-500 font-medium"
                />
              </div>

              <div>
                <label className="block text-slate-700 dark:text-slate-300 font-semibold mb-1">
                  Email (optionnel — pour recevoir le bon PDF)
                </label>
                <input
                  type="email"
                  value={quickForm.email}
                  onChange={(e) => setQuickForm({ ...quickForm, email: e.target.value })}
                  placeholder="client@email.com"
                  className="w-full rounded-xl bg-slate-50 dark:bg-slate-900 border border-slate-300 dark:border-slate-700 px-3.5 py-2.5 text-slate-900 dark:text-white focus:outline-none focus:border-blue-500"
                />
              </div>

              <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
                <div>
                  <label className="block text-slate-700 dark:text-slate-300 font-semibold mb-1">
                    Téléphone (WhatsApp) *
                  </label>
                  <input
                    type="tel"
                    required
                    value={quickForm.phone}
                    onChange={(e) => setQuickForm({ ...quickForm, phone: e.target.value })}
                    placeholder="+216 22 123 456"
                    className="w-full rounded-xl bg-slate-50 dark:bg-slate-900 border border-slate-300 dark:border-slate-700 px-3.5 py-2.5 text-slate-900 dark:text-white focus:outline-none focus:border-blue-500"
                  />
                </div>

                <div>
                  <label className="block text-slate-700 dark:text-slate-300 font-semibold mb-1">
                    Modèle * (immatriculation affectée automatiquement)
                  </label>
                  <select
                    required
                    value={quickForm.vehicleId}
                    onChange={(e) => setQuickForm({ ...quickForm, vehicleId: e.target.value })}
                    className="w-full rounded-xl bg-slate-50 dark:bg-slate-900 border border-slate-300 dark:border-slate-700 px-3 py-2.5 text-slate-900 dark:text-white focus:outline-none focus:border-blue-500 font-medium"
                  >
                    {adminVehicles.length === 0 ? (
                      <option value="">Chargement de la flotte...</option>
                    ) : (
                      adminVehicles.map((v) => (
                        <option key={v._id} value={v._id}>
                          {v.brand} {v.model} — {Math.round((v.pricing?.daily || 0) / 100)} TND/j{v.availableUnits !== undefined ? ` · ${v.availableUnits} dispo.` : ""}
                        </option>
                      ))
                    )}
                  </select>
                </div>
              </div>

              <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
                <div>
                  <label className="block text-slate-700 dark:text-slate-300 font-semibold mb-1">
                    Agence de Prise en Charge *
                  </label>
                  <select
                    value={quickForm.pickupLocationId}
                    onChange={(e) => setQuickForm({ ...quickForm, pickupLocationId: e.target.value })}
                    className="w-full rounded-xl bg-slate-50 dark:bg-slate-900 border border-slate-300 dark:border-slate-700 px-3 py-2.5 text-slate-900 dark:text-white focus:outline-none focus:border-blue-500"
                  >
                    {adminLocations.length === 0 ? (
                      <option value="">Aucune agence active</option>
                    ) : (
                      adminLocations.map((loc) => {
                        const name = typeof loc.name === "object" ? loc.name[lang] || loc.name.fr || loc.name.en : loc.name;
                        return (
                          <option key={loc._id} value={loc._id}>
                            {name} {loc.city ? `(${loc.city})` : ""}
                          </option>
                        );
                      })
                    )}
                  </select>
                </div>

                <div>
                  <label className="block text-slate-700 dark:text-slate-300 font-semibold mb-1">
                    Agence de Restitution *
                  </label>
                  <select
                    value={quickForm.returnLocationId}
                    onChange={(e) => setQuickForm({ ...quickForm, returnLocationId: e.target.value })}
                    className="w-full rounded-xl bg-slate-50 dark:bg-slate-900 border border-slate-300 dark:border-slate-700 px-3 py-2.5 text-slate-900 dark:text-white focus:outline-none focus:border-blue-500"
                  >
                    {adminLocations.length === 0 ? (
                      <option value="">Aucune agence active</option>
                    ) : (
                      adminLocations.map((loc) => {
                        const name = typeof loc.name === "object" ? loc.name[lang] || loc.name.fr || loc.name.en : loc.name;
                        return (
                          <option key={loc._id} value={loc._id}>
                            {name} {loc.city ? `(${loc.city})` : ""}
                          </option>
                        );
                      })
                    )}
                  </select>
                </div>
              </div>

              <div className="grid grid-cols-2 gap-3">
                <div>
                  <label className="block text-slate-700 dark:text-slate-300 font-semibold mb-1">
                    Date Départ
                  </label>
                  <input
                    type="date"
                    required
                    value={quickForm.pickupDate}
                    onChange={(e) => setQuickForm({ ...quickForm, pickupDate: e.target.value })}
                    className="w-full rounded-xl bg-slate-50 dark:bg-slate-900 border border-slate-300 dark:border-slate-700 px-3 py-2 text-slate-900 dark:text-white focus:outline-none focus:border-blue-500 font-medium"
                  />
                </div>
                <div>
                  <label className="block text-slate-700 dark:text-slate-300 font-semibold mb-1">
                    Date Retour
                  </label>
                  <input
                    type="date"
                    required
                    value={quickForm.returnDate}
                    onChange={(e) => setQuickForm({ ...quickForm, returnDate: e.target.value })}
                    className="w-full rounded-xl bg-slate-50 dark:bg-slate-900 border border-slate-300 dark:border-slate-700 px-3 py-2 text-slate-900 dark:text-white focus:outline-none focus:border-blue-500 font-medium"
                  />
                </div>
              </div>

              <div className="pt-3 border-t border-slate-200 dark:border-slate-800 flex items-center justify-end gap-3">
                <button
                  type="button"
                  onClick={() => setShowQuickBookingModal(false)}
                  className="px-4 py-2 rounded-xl bg-slate-100 dark:bg-slate-800 hover:bg-slate-200 dark:hover:bg-slate-700 text-slate-700 dark:text-slate-300 font-medium"
                >
                  Annuler
                </button>
                <button
                  type="submit"
                  disabled={isSubmittingQuick}
                  className="px-5 py-2 rounded-xl bg-blue-600 hover:bg-blue-500 text-white font-semibold shadow-md shadow-blue-600/30 disabled:opacity-50 transition-all flex items-center gap-2"
                >
                  {isSubmittingQuick && <div className="w-3.5 h-3.5 border-2 border-white/30 border-t-white rounded-full animate-spin" />}
                  <span>{isSubmittingQuick ? "Création..." : "Confirmer la réservation"}</span>
                </button>
              </div>
            </form>
            )}
          </div>
        </div>
      )}
    </div>
  );
}

export function AdminShell({
  children,
}: {
  children: React.ReactNode;
}) {
  return (
    <AdminLangProvider>
      <AdminLayoutContent>{children}</AdminLayoutContent>
    </AdminLangProvider>
  );
}
