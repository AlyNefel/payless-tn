"use client";

import React, { useState } from "react";
import Link from "next/link";
import {
  TrendingUp,
  Car,
  CalendarCheck,
  Percent,
  ArrowUpRight,
  ArrowDownRight,
  Clock,
  MapPin,
  CheckCircle2,
  AlertCircle,
  Eye,
  ChevronRight,
  Filter,
  Download,
  Calendar,
  Sparkles,
  Phone,
  Search as SearchIcon,
  Wrench,
} from "lucide-react";
import {
  AreaChart,
  Area,
  XAxis,
  YAxis,
  CartesianGrid,
  Tooltip,
  ResponsiveContainer,
  BarChart,
  Bar,
} from "recharts";
import { useAdminLang } from "@/contexts/AdminLangContext";
import { useEffect, useMemo } from "react";
import type { BookingItem } from "./mockData";
import { BookingQuickView } from "@/components/admin/BookingQuickView";


export default function AdminDashboardPage() {
  const { lang } = useAdminLang();
  // Real data only: an empty agency shows zeros, never sample numbers.
  const [bookings, setBookings] = useState<any[]>([]);
  const [fleet, setFleet] = useState<{ total: number; maintenance: number }>({ total: 0, maintenance: 0 });
  const [selectedBooking, setSelectedBooking] = useState<BookingItem | null>(null);
  const [timeRange, setTimeRange] = useState<"year" | "month" | "week">("year");
  const [searchTable, setSearchTable] = useState("");

  useEffect(() => {
    // Every booking of the chart window (12 months → day after tomorrow), page by page, plus every
    // car on the road: the figures no longer depend on how many bookings were created recently.
    (async () => {
      const now = new Date();
      const pad = (n: number) => String(n).padStart(2, "0");
      const iso = (d: Date) => `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
      const from = iso(new Date(now.getFullYear(), now.getMonth() - 11, 1));
      const to = iso(new Date(now.getFullYear(), now.getMonth(), now.getDate() + 2));
      const all = new Map<string, any>();
      try {
        for (let page = 1; page <= 25; page++) {
          const json = await fetch(`/api/admin/bookings?dateField=pickup&from=${from}&to=${to}&limit=200&page=${page}`).then((r) => r.json());
          for (const b of json.bookings || []) all.set(b._id, b);
          if (!json.success || (json.bookings || []).length < 200) break;
        }
        const active = await fetch("/api/admin/bookings?status=active&limit=200").then((r) => r.json());
        for (const b of active.bookings || []) all.set(b._id, b);
        setBookings(
          [...all.values()].map((b: any) => ({
            ...b,
            totalPrice: b.totalAmount >= 1000 ? Math.round(b.totalAmount / 100) : b.totalAmount,
            rentalDays: b.rentalDuration || 1,
          }))
        );
      } catch {
        /* dashboard stays empty */
      }
    })();

    fetch("/api/admin/vehicles?limit=200")
      .then((res) => (res.ok ? res.json() : { vehicles: [] }))
      .then((json) => {
        const units = (json.vehicles || []).flatMap((v: any) =>
          v.units?.length ? v.units : Array.from({ length: Math.max(1, v.totalUnits || 1) }, () => ({ status: v.status === "maintenance" ? "maintenance" : "active" }))
        );
        setFleet({
          total: units.filter((u: any) => u.status !== "out_of_service").length,
          maintenance: units.filter((u: any) => u.status === "maintenance").length,
        });
      })
      .catch(() => {});
  }, []);

  const totalRevenue = useMemo(() => {
    return bookings.reduce((sum, b) => sum + (b.totalPrice || 0), 0);
  }, [bookings]);

  const activeCount = useMemo(() => {
    return bookings.filter((b) => b.status === "active").length;
  }, [bookings]);

  const confirmedCount = useMemo(() => {
    return bookings.filter((b) => b.status === "confirmed").length;
  }, [bookings]);

  const pendingCount = useMemo(() => {
    return bookings.filter((b) => b.status === "pending").length;
  }, [bookings]);

  // ── Figures computed from real bookings ─────────────────────────────
  const stats = useMemo(() => {
    const live = bookings.filter((b) => !["cancelled", "rejected"].includes(b.status));
    const now = new Date();
    const monthKey = (d: Date) => `${d.getFullYear()}-${d.getMonth()}`;
    const thisMonth = monthKey(now);
    const prev = new Date(now.getFullYear(), now.getMonth() - 1, 1);
    const revenueOf = (key: string) =>
      live.filter((b) => b.pickupDate && monthKey(new Date(b.pickupDate)) === key).reduce((s, b) => s + (b.totalPrice || 0), 0);
    const monthRevenue = revenueOf(thisMonth);
    const prevRevenue = revenueOf(monthKey(prev));
    const trend = prevRevenue > 0 ? Math.round(((monthRevenue - prevRevenue) / prevRevenue) * 1000) / 10 : null;

    const months = Array.from({ length: 12 }, (_, i) => new Date(now.getFullYear(), now.getMonth() - 11 + i, 1));
    const chart = months.map((m) => {
      const key = monthKey(m);
      const inMonth = live.filter((b) => b.pickupDate && monthKey(new Date(b.pickupDate)) === key);
      return {
        month: m.toLocaleDateString("fr-FR", { month: "short" }),
        revenue: inMonth.reduce((s, b) => s + (b.totalPrice || 0), 0),
        bookings: inMonth.length,
      };
    });

    const today = new Date(now.getFullYear(), now.getMonth(), now.getDate());
    const dayAfter = new Date(today.getTime() + 2 * 86_400_000);
    const dayLabel = (iso: string) => {
      const d = new Date(iso);
      const sameDay = (x: Date) => d.getFullYear() === x.getFullYear() && d.getMonth() === x.getMonth() && d.getDate() === x.getDate();
      if (sameDay(today)) return lang === "fr" ? "Aujourd'hui" : "Today";
      if (sameDay(new Date(today.getTime() + 86_400_000))) return lang === "fr" ? "Demain" : "Tomorrow";
      return d.toLocaleDateString("fr-FR");
    };
    const toItem = (b: any, kind: "pickup" | "return") => ({
      id: `${kind}-${b._id || b.id}`,
      booking: b,
      customer: b.customerName,
      phone: b.customerPhone,
      vehicle: b.vehicleName,
      plate: b.licensePlate || "—",
      time: (kind === "pickup" ? b.pickupTime : b.returnTime) || "—",
      location: kind === "pickup" ? b.pickupLocation : b.returnLocation,
      date: dayLabel(kind === "pickup" ? b.pickupDate : b.returnDate),
    });
    const inWindow = (iso?: string) => {
      if (!iso) return false;
      const d = new Date(iso);
      return d >= today && d < dayAfter;
    };
    const pickups = live
      .filter((b) => ["confirmed", "paid", "awaiting_payment", "pending"].includes(b.status) && inWindow(b.pickupDate))
      .sort((a, b) => String(a.pickupDate).localeCompare(String(b.pickupDate)))
      .map((b) => toItem(b, "pickup"));
    const returns = live
      .filter((b) => b.status === "active" && (inWindow(b.returnDate) || (b.returnDate && new Date(b.returnDate) < today)))
      .sort((a, b) => String(a.returnDate).localeCompare(String(b.returnDate)))
      .map((b) => toItem(b, "return"));

    const onRoad = bookings.filter((b) => b.status === "active").length;
    const rentable = Math.max(0, fleet.total - fleet.maintenance);
    const utilization = rentable > 0 ? Math.round((onRoad / rentable) * 100) : 0;
    return { monthRevenue, trend, chart, pickups, returns, onRoad, utilization };
  }, [bookings, fleet, lang]);

  const upcomingPickups = stats.pickups;
  const upcomingReturns = stats.returns;
  const fleetAvailable = Math.max(0, fleet.total - fleet.maintenance - stats.onRoad);
  const pct = (n: number) => (fleet.total > 0 ? Math.round((n / fleet.total) * 100) : 0);

  return (
    <div className="space-y-8">
      {/* Top Banner / Welcome */}
      <div className="flex flex-col md:flex-row md:items-center justify-between gap-4">
        <div>
          <div className="inline-flex items-center gap-2 px-3 py-1 rounded-full bg-blue-500/10 border border-blue-500/20 text-blue-600 dark:text-blue-400 text-xs font-semibold mb-2">
            <Sparkles className="w-3.5 h-3.5" />
            <span>Tableau de bord exécutif • PAYLESS TUNISIE</span>
          </div>
          <h1 className="text-2xl sm:text-3xl font-black text-slate-900 dark:text-white tracking-tight">
            Vue d&apos;ensemble de l&apos;Agence
          </h1>
          <p className="text-xs sm:text-sm text-slate-500 dark:text-slate-400 mt-1">
            Performances financières, rotations de flotte et réservations en temps réel.
          </p>
        </div>

        <div className="flex items-center gap-3">
          <div className="inline-flex items-center rounded-xl bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-800 p-1 text-xs shadow-sm">
            <button
              onClick={() => setTimeRange("week")}
              className={`px-3 py-1.5 rounded-lg transition-all ${
                timeRange === "week"
                  ? "bg-blue-600 text-white font-medium shadow-sm"
                  : "text-slate-600 dark:text-slate-400 hover:text-slate-900 dark:hover:text-white"
              }`}
            >
              7 Jours
            </button>
            <button
              onClick={() => setTimeRange("month")}
              className={`px-3 py-1.5 rounded-lg transition-all ${
                timeRange === "month"
                  ? "bg-blue-600 text-white font-medium shadow-sm"
                  : "text-slate-600 dark:text-slate-400 hover:text-slate-900 dark:hover:text-white"
              }`}
            >
              30 Jours
            </button>
            <button
              onClick={() => setTimeRange("year")}
              className={`px-3 py-1.5 rounded-lg transition-all ${
                timeRange === "year"
                  ? "bg-blue-600 text-white font-medium shadow-sm"
                  : "text-slate-600 dark:text-slate-400 hover:text-slate-900 dark:hover:text-white"
              }`}
            >
              Année 2026
            </button>
          </div>

          <Link
            href="/admin/garage"
            className="inline-flex items-center gap-2 px-3.5 py-2 rounded-xl bg-orange-50 hover:bg-orange-100 dark:bg-orange-950/40 dark:hover:bg-orange-900/50 border border-orange-200 dark:border-orange-800 text-orange-700 dark:text-orange-300 text-xs font-semibold transition-colors shadow-sm"
          >
            <Wrench className="w-4 h-4 text-orange-500" />
            <span>Garage & Vidanges</span>
          </Link>
          <Link
            href="/admin/fleet"
            className="hidden sm:inline-flex items-center gap-2 px-4 py-2 rounded-xl bg-white dark:bg-slate-900 hover:bg-slate-100 dark:hover:bg-slate-800 border border-slate-200 dark:border-slate-800 text-slate-700 dark:text-slate-200 text-xs font-semibold transition-colors shadow-sm"
          >
            <Car className="w-4 h-4 text-amber-500 dark:text-amber-400" />
            <span>Inventaire Flotte</span>
          </Link>
        </div>
      </div>

      {/* 4 TOP KPI CARDS */}
      <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-4">
        {/* KPI 1: Total Revenue */}
        <div className="rounded-2xl bg-white dark:bg-gradient-to-br dark:from-[#0f141f] dark:to-slate-900/90 border border-slate-200 dark:border-slate-800 p-5 shadow-sm dark:shadow-xl relative overflow-hidden group charging-card">
          <div className="flex items-center justify-between">
            <span className="text-xs font-semibold text-slate-500 dark:text-slate-400 uppercase tracking-wider">
              {lang === "fr" ? "Chiffre d'Affaires" : "Total Revenue"}
            </span>
            <div className="w-10 h-10 rounded-xl bg-blue-500/10 border border-blue-500/20 text-blue-600 dark:text-blue-400 flex items-center justify-center">
              <TrendingUp className="w-5 h-5" />
            </div>
          </div>
          <div className="mt-4">
            <div className="text-2xl sm:text-3xl font-extrabold text-slate-900 dark:text-white tracking-tight">
              {stats.monthRevenue.toLocaleString("fr-FR")} <span className="text-sm font-semibold text-slate-500 dark:text-slate-400">TND</span>
            </div>
            <div className="mt-2 flex items-center gap-1.5 text-xs">
              {stats.trend !== null ? (
                <span className={`inline-flex items-center font-semibold ${stats.trend >= 0 ? "text-emerald-600 dark:text-emerald-400" : "text-red-600 dark:text-red-400"}`}>
                  <ArrowUpRight className={`w-3.5 h-3.5 mr-0.5 ${stats.trend < 0 ? "rotate-90" : ""}`} />
                  {stats.trend > 0 ? "+" : ""}
                  {stats.trend}%
                </span>
              ) : null}
              <span className="text-slate-500 dark:text-slate-400">
                {stats.trend !== null ? (lang === "fr" ? "vs mois précédent" : "vs last month") : lang === "fr" ? "ce mois-ci (départs)" : "this month (pickups)"}
              </span>
            </div>
          </div>
        </div>

        {/* KPI 2: Active Rentals */}
        <div className="rounded-2xl bg-white dark:bg-gradient-to-br dark:from-[#0f141f] dark:to-slate-900/90 border border-slate-200 dark:border-slate-800 p-5 shadow-sm dark:shadow-xl relative overflow-hidden group charging-card">
          <div className="flex items-center justify-between">
            <span className="text-xs font-semibold text-slate-500 dark:text-slate-400 uppercase tracking-wider">
              {lang === "fr" ? "Locations Actives" : "Active Rentals"}
            </span>
            <div className="w-10 h-10 rounded-xl bg-emerald-500/10 border border-emerald-500/20 text-emerald-600 dark:text-emerald-400 flex items-center justify-center">
              <Car className="w-5 h-5" />
            </div>
          </div>
          <div className="mt-4">
            <div className="text-2xl sm:text-3xl font-extrabold text-slate-900 dark:text-white tracking-tight">
              {activeCount} <span className="text-sm font-semibold text-slate-500 dark:text-slate-400">{lang === "fr" ? "Véhicules" : "Vehicles"}</span>
            </div>
            <div className="mt-2 flex items-center gap-1.5 text-xs">
              <span className="text-slate-500 dark:text-slate-400">{lang === "fr" ? "actuellement sur la route" : "currently on the road"}</span>
            </div>
          </div>
        </div>

        {/* KPI 3: Confirmed Reservations */}
        <div className="rounded-2xl bg-white dark:bg-gradient-to-br dark:from-[#0f141f] dark:to-slate-900/90 border border-slate-200 dark:border-slate-800 p-5 shadow-sm dark:shadow-xl relative overflow-hidden group charging-card">
          <div className="flex items-center justify-between">
            <span className="text-xs font-semibold text-slate-500 dark:text-slate-400 uppercase tracking-wider">
              {lang === "fr" ? "Réservations Confirmées" : "Confirmed Bookings"}
            </span>
            <div className="w-10 h-10 rounded-xl bg-amber-500/10 border border-amber-500/20 text-amber-600 dark:text-amber-400 flex items-center justify-center">
              <CalendarCheck className="w-5 h-5" />
            </div>
          </div>
          <div className="mt-4">
            <div className="text-2xl sm:text-3xl font-extrabold text-slate-900 dark:text-white tracking-tight">
              {confirmedCount} <span className="text-sm font-semibold text-slate-500 dark:text-slate-400">{lang === "fr" ? "dossiers" : "bookings"}</span>
            </div>
            <div className="mt-2 flex items-center gap-1.5 text-xs">
              <span className="inline-flex items-center text-blue-600 dark:text-blue-400 font-semibold">
                {pendingCount} {lang === "fr" ? "en attente" : "pending"}
              </span>
              <span className="text-slate-500 dark:text-slate-400">{lang === "fr" ? "à traiter" : "to process"}</span>
            </div>
          </div>
        </div>

        {/* KPI 4: Fleet Utilization Rate */}
        <div className="rounded-2xl bg-white dark:bg-gradient-to-br dark:from-[#0f141f] dark:to-slate-900/90 border border-slate-200 dark:border-slate-800 p-5 shadow-sm dark:shadow-xl relative overflow-hidden group charging-card">
          <div className="flex items-center justify-between">
            <span className="text-xs font-semibold text-slate-500 dark:text-slate-400 uppercase tracking-wider">
              {lang === "fr" ? "Taux d'Utilisation Flotte" : "Fleet Utilization"}
            </span>
            <div className="w-10 h-10 rounded-xl bg-purple-500/10 border border-purple-500/20 text-purple-600 dark:text-purple-400 flex items-center justify-center">
              <Percent className="w-5 h-5" />
            </div>
          </div>
          <div className="mt-4">
            <div className="text-2xl sm:text-3xl font-extrabold text-slate-900 dark:text-white tracking-tight">
              {stats.utilization}% <span className="text-sm font-semibold text-slate-500 dark:text-slate-400">({fleet.total} {lang === "fr" ? "voitures" : "cars"})</span>
            </div>
            <div className="mt-2 flex items-center gap-1.5 text-xs">
              <span className="text-slate-500 dark:text-slate-400">
                {stats.onRoad} {lang === "fr" ? "en location aujourd'hui" : "rented today"}
              </span>
            </div>
          </div>
        </div>
      </div>

      {/* CHARTS & FLEET STATUS ROW */}
      <div className="grid grid-cols-1 lg:grid-cols-3 gap-6">
        {/* Main Revenue Chart (2 cols) */}
        <div className="lg:col-span-2 rounded-2xl bg-white dark:bg-[#0f141f] border border-slate-200 dark:border-slate-800 p-5 shadow-sm dark:shadow-xl">
          <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-3 mb-6">
            <div>
              <h2 className="text-base font-bold text-slate-900 dark:text-white">
                Évolution Mensuelle des Revenus (TND)
              </h2>
              <p className="text-xs text-slate-500 dark:text-slate-400">
                Performances commerciales cumulées 2026
              </p>
            </div>
            <div className="flex items-center gap-4 text-xs">
              <div className="flex items-center gap-2">
                <span className="w-3 h-3 rounded-full bg-blue-500" />
                <span className="text-slate-700 dark:text-slate-300">Revenus (TND)</span>
              </div>
              <div className="flex items-center gap-2">
                <span className="w-3 h-3 rounded-full bg-amber-400" />
                <span className="text-slate-700 dark:text-slate-300">Volume Réservations</span>
              </div>
            </div>
          </div>

          <div className="h-72 w-full">
            <ResponsiveContainer width="100%" height="100%">
              <AreaChart data={stats.chart} margin={{ top: 10, right: 10, left: 0, bottom: 0 }}>
                <defs>
                  <linearGradient id="colorRevenue" x1="0" y1="0" x2="0" y2="1">
                    <stop offset="5%" stopColor="#3b82f6" stopOpacity={0.4} />
                    <stop offset="95%" stopColor="#3b82f6" stopOpacity={0.0} />
                  </linearGradient>
                </defs>
                <CartesianGrid strokeDasharray="3 3" stroke="#e2e8f0" className="dark:stroke-slate-800" />
                <XAxis dataKey="month" stroke="#64748b" tick={{ fontSize: 11 }} />
                <YAxis
                  stroke="#64748b"
                  tick={{ fontSize: 11 }}
                  tickFormatter={(val) => `${(val / 1000).toFixed(0)}k`}
                />
                <Tooltip
                  contentStyle={{
                    backgroundColor: "#0b0f17",
                    borderColor: "#334155",
                    borderRadius: "0.75rem",
                    color: "#fff",
                    fontSize: "12px",
                  }}
                  formatter={(value: any, name: any) => [
                    name === "revenue" ? `${Number(value).toLocaleString()} TND` : value,
                    name === "revenue" ? "Revenu Total" : "Réservations",
                  ]}
                />
                <Area
                  type="monotone"
                  dataKey="revenue"
                  stroke="#3b82f6"
                  strokeWidth={2.5}
                  fillOpacity={1}
                  fill="url(#colorRevenue)"
                />
              </AreaChart>
            </ResponsiveContainer>
          </div>
        </div>

        {/* Fleet Status Summary Card (1 col) */}
        <div className="rounded-2xl bg-white dark:bg-[#0f141f] border border-slate-200 dark:border-slate-800 p-5 shadow-sm dark:shadow-xl flex flex-col justify-between">
          <div>
            <div className="flex items-center justify-between pb-3 border-b border-slate-200 dark:border-slate-800">
              <h2 className="text-base font-bold text-slate-900 dark:text-white">Statut de la Flotte</h2>
              <span className="text-xs font-semibold px-2 py-0.5 rounded-full bg-blue-100 dark:bg-blue-500/20 text-blue-700 dark:text-blue-300">
                25 Total
              </span>
            </div>

            <p className="text-xs text-slate-500 dark:text-slate-400 mt-2">
              Disponibilité immédiate sur les 11 agences et aéroports de Tunisie
            </p>

            <div className="mt-5 space-y-4">
              {/* Available */}
              <div>
                <div className="flex justify-between text-xs font-medium mb-1.5">
                  <span className="flex items-center gap-2 text-emerald-600 dark:text-emerald-400">
                    <span className="w-2 h-2 rounded-full bg-emerald-500" />
                    Disponible en agence
                  </span>
                  <span className="text-slate-900 dark:text-white font-bold">{fleetAvailable} ({pct(fleetAvailable)}%)</span>
                </div>
                <div className="w-full bg-slate-100 dark:bg-slate-800 h-2.5 rounded-full overflow-hidden">
                  <div className="bg-emerald-500 h-full rounded-full" style={{ width: `${pct(fleetAvailable)}%` }} />
                </div>
              </div>

              {/* Rented */}
              <div>
                <div className="flex justify-between text-xs font-medium mb-1.5">
                  <span className="flex items-center gap-2 text-blue-600 dark:text-blue-400">
                    <span className="w-2 h-2 rounded-full bg-blue-500" />
                    En location (sur route)
                  </span>
                  <span className="text-slate-900 dark:text-white font-bold">{stats.onRoad} ({pct(stats.onRoad)}%)</span>
                </div>
                <div className="w-full bg-slate-100 dark:bg-slate-800 h-2.5 rounded-full overflow-hidden">
                  <div className="bg-blue-500 h-full rounded-full" style={{ width: `${pct(stats.onRoad)}%` }} />
                </div>
              </div>

              {/* Maintenance */}
              <div>
                <div className="flex justify-between text-xs font-medium mb-1.5">
                  <span className="flex items-center gap-2 text-amber-600 dark:text-amber-400">
                    <span className="w-2 h-2 rounded-full bg-amber-500" />
                    En maintenance / Atelier
                  </span>
                  <span className="text-slate-900 dark:text-white font-bold">{fleet.maintenance} ({pct(fleet.maintenance)}%)</span>
                </div>
                <div className="w-full bg-slate-100 dark:bg-slate-800 h-2.5 rounded-full overflow-hidden">
                  <div className="bg-amber-500 h-full rounded-full" style={{ width: `${pct(fleet.maintenance)}%` }} />
                </div>
              </div>
            </div>
          </div>

          <div className="mt-6 pt-4 border-t border-slate-200 dark:border-slate-800">
            <Link
              href="/admin/calendar"
              className="w-full flex items-center justify-center gap-2 py-2.5 rounded-xl bg-slate-100 hover:bg-slate-200 dark:bg-slate-800 dark:hover:bg-slate-700 text-xs font-semibold text-slate-800 dark:text-white transition-colors"
            >
              <Calendar className="w-4 h-4 text-amber-500 dark:text-amber-400" />
              <span>Ouvrir le Calendrier de Disponibilité</span>
            </Link>
          </div>
        </div>
      </div>

      {/* UPCOMING PICKUPS & RETURNS (TODAY & TOMORROW) */}
      <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
        {/* Departures / Pickups */}
        <div className="rounded-2xl bg-white dark:bg-[#0f141f] border border-slate-200 dark:border-slate-800 p-5 shadow-sm dark:shadow-xl">
          <div className="flex items-center justify-between pb-3 border-b border-slate-200 dark:border-slate-800">
            <div className="flex items-center gap-2">
              <div className="w-2 h-2 rounded-full bg-emerald-500 animate-pulse" />
              <h2 className="text-base font-bold text-slate-900 dark:text-white">Départs & Livraisons Prévus</h2>
            </div>
            <span className="text-xs px-2.5 py-0.5 rounded-full bg-emerald-100 dark:bg-emerald-500/20 text-emerald-700 dark:text-emerald-300 font-semibold">
              {upcomingPickups.length} {lang === "fr" ? "prévu(s)" : "planned"}
            </span>
          </div>

          <div className="divide-y divide-slate-100 dark:divide-slate-800/70 mt-3">
            {upcomingPickups.length === 0 && (
              <p className="py-6 text-center text-xs text-slate-500">{lang === "fr" ? "Aucun départ aujourd'hui ni demain." : "No pickups today or tomorrow."}</p>
            )}
            {upcomingPickups.map((item) => (
              <button
                type="button"
                key={item.id}
                onClick={() => setSelectedBooking(item.booking)}
                className="w-full text-left py-3 flex items-start justify-between gap-3 hover:bg-slate-50 dark:hover:bg-slate-900/50 rounded-lg px-1"
              >
                <div className="space-y-1">
                  <div className="flex items-center gap-2">
                    <span className="text-xs font-bold text-slate-900 dark:text-white">{item.customer}</span>
                    <span className="text-[10px] px-1.5 py-0.5 rounded bg-slate-100 dark:bg-slate-800 text-slate-700 dark:text-slate-300 font-mono">
                      {item.plate}
                    </span>
                  </div>
                  <p className="text-xs text-blue-600 dark:text-blue-400 font-medium">{item.vehicle}</p>
                  <p className="text-[11px] text-slate-500 dark:text-slate-400 flex items-center gap-1">
                    <MapPin className="w-3 h-3 text-slate-400 dark:text-slate-500" />
                    {item.location}
                  </p>
                </div>

                <div className="text-right shrink-0">
                  <div className="inline-flex items-center gap-1 px-2 py-0.5 rounded bg-blue-50 dark:bg-blue-500/10 border border-blue-200 dark:border-blue-500/20 text-blue-700 dark:text-blue-300 font-mono text-xs font-bold">
                    <Clock className="w-3 h-3" />
                    {item.time}
                  </div>
                  <p className="text-[11px] text-amber-600 dark:text-amber-400 font-medium mt-1">{item.date}</p>
                </div>
              </button>
            ))}
          </div>
        </div>

        {/* Arrivals / Returns */}
        <div className="rounded-2xl bg-white dark:bg-[#0f141f] border border-slate-200 dark:border-slate-800 p-5 shadow-sm dark:shadow-xl">
          <div className="flex items-center justify-between pb-3 border-b border-slate-200 dark:border-slate-800">
            <div className="flex items-center gap-2">
              <div className="w-2 h-2 rounded-full bg-blue-500 animate-pulse" />
              <h2 className="text-base font-bold text-slate-900 dark:text-white">Retours & Restitutions Prévus</h2>
            </div>
            <span className="text-xs px-2.5 py-0.5 rounded-full bg-blue-100 dark:bg-blue-500/20 text-blue-700 dark:text-blue-300 font-semibold">
              {upcomingReturns.length} {lang === "fr" ? "prévu(s)" : "planned"}
            </span>
          </div>

          <div className="divide-y divide-slate-100 dark:divide-slate-800/70 mt-3">
            {upcomingReturns.length === 0 && (
              <p className="py-6 text-center text-xs text-slate-500">{lang === "fr" ? "Aucun retour prévu aujourd'hui ni demain." : "No returns today or tomorrow."}</p>
            )}
            {upcomingReturns.map((item) => (
              <button
                type="button"
                key={item.id}
                onClick={() => setSelectedBooking(item.booking)}
                className="w-full text-left py-3 flex items-start justify-between gap-3 hover:bg-slate-50 dark:hover:bg-slate-900/50 rounded-lg px-1"
              >
                <div className="space-y-1">
                  <div className="flex items-center gap-2">
                    <span className="text-xs font-bold text-slate-900 dark:text-white">{item.customer}</span>
                    <span className="text-[10px] px-1.5 py-0.5 rounded bg-slate-100 dark:bg-slate-800 text-slate-700 dark:text-slate-300 font-mono">
                      {item.plate}
                    </span>
                  </div>
                  <p className="text-xs text-emerald-600 dark:text-emerald-400 font-medium">{item.vehicle}</p>
                  <p className="text-[11px] text-slate-500 dark:text-slate-400 flex items-center gap-1">
                    <MapPin className="w-3 h-3 text-slate-400 dark:text-slate-500" />
                    {item.location}
                  </p>
                </div>

                <div className="text-right shrink-0">
                  <div className="inline-flex items-center gap-1 px-2 py-0.5 rounded bg-amber-50 dark:bg-amber-500/10 border border-amber-200 dark:border-amber-500/20 text-amber-700 dark:text-amber-300 font-mono text-xs font-bold">
                    <Clock className="w-3 h-3" />
                    {item.time}
                  </div>
                  <p className="text-[11px] text-slate-500 dark:text-slate-400 font-medium mt-1">{item.date}</p>
                </div>
              </button>
            ))}
          </div>
        </div>
      </div>

      {/* RECENT RESERVATIONS TABLE */}
      <div className="rounded-2xl bg-white dark:bg-[#0f141f] border border-slate-200 dark:border-slate-800 shadow-sm dark:shadow-xl overflow-hidden">
        <div className="p-5 flex flex-col sm:flex-row sm:items-center justify-between gap-3 border-b border-slate-200 dark:border-slate-800">
          <div>
            <h2 className="text-base font-bold text-slate-900 dark:text-white">
              {lang === "fr" ? "Dernières Réservations Enregistrées" : "Latest Bookings"}
            </h2>
            <p className="text-xs text-slate-500 dark:text-slate-400">
              {lang === "fr" ? "Transactions récentes et statuts de validation" : "Recent transactions and approval status"}
            </p>
          </div>

          <div className="flex items-center gap-3">
            <div className="relative">
              <SearchIcon className="w-3.5 h-3.5 text-slate-400 absolute left-3 top-1/2 -translate-y-1/2" />
              <input
                type="text"
                value={searchTable}
                onChange={(e) => setSearchTable(e.target.value)}
                placeholder={lang === "fr" ? "Rechercher..." : "Search..."}
                className="pl-8 pr-3 py-1.5 rounded-lg border border-slate-200 dark:border-slate-800 bg-slate-50 dark:bg-slate-900 text-xs focus:outline-none focus:border-blue-500 text-slate-900 dark:text-white"
              />
            </div>

            <Link
              href="/admin/bookings"
              className="inline-flex items-center gap-1.5 text-xs text-blue-600 dark:text-blue-400 hover:underline font-medium shrink-0"
            >
              <span>{lang === "fr" ? "Voir tout" : "View all"} ({bookings.length})</span>
              <ChevronRight className="w-4 h-4" />
            </Link>
          </div>
        </div>

        <div className="overflow-x-auto">
          <table className="w-full text-left text-xs text-slate-700 dark:text-slate-300">
            <thead className="bg-slate-50 dark:bg-slate-900/80 text-[11px] uppercase tracking-wider text-slate-500 dark:text-slate-400 border-b border-slate-200 dark:border-slate-800">
              <tr>
                <th className="px-5 py-3 font-semibold">{lang === "fr" ? "Référence" : "Reference"}</th>
                <th className="px-5 py-3 font-semibold">{lang === "fr" ? "Client" : "Customer"}</th>
                <th className="px-5 py-3 font-semibold">{lang === "fr" ? "Véhicule" : "Vehicle"}</th>
                <th className="px-5 py-3 font-semibold">{lang === "fr" ? "Dates de Location" : "Rental Dates"}</th>
                <th className="px-5 py-3 font-semibold">{lang === "fr" ? "Total (TND)" : "Total (TND)"}</th>
                <th className="px-5 py-3 font-semibold">{lang === "fr" ? "Statut" : "Status"}</th>
                <th className="px-5 py-3 font-semibold text-right">{lang === "fr" ? "Action" : "Action"}</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-slate-100 dark:divide-slate-800/60">
              {bookings
                .filter((b) => {
                  if (!searchTable) return true;
                  const q = searchTable.toLowerCase();
                  return (
                    (b.reference || "").toLowerCase().includes(q) ||
                    (b.customerName || "").toLowerCase().includes(q) ||
                    (b.vehicleName || "").toLowerCase().includes(q)
                  );
                })
                .slice(0, 6)
                .map((b) => (
                <tr key={b.id} className="hover:bg-slate-50 dark:hover:bg-slate-900/50 transition-colors">
                  <td className="px-5 py-4 font-mono font-medium text-blue-600 dark:text-blue-400">
                    {b.reference}
                  </td>
                  <td className="px-5 py-4">
                    <p className="font-semibold text-slate-900 dark:text-white">{b.customerName}</p>
                    <p className="text-[11px] text-slate-500 dark:text-slate-400">{b.customerPhone}</p>
                  </td>
                  <td className="px-5 py-4">
                    <p className="text-slate-900 dark:text-white font-medium">{b.vehicleName}</p>
                    <p className="text-[11px] text-slate-500 font-mono">{b.licensePlate}</p>
                  </td>
                  <td className="px-5 py-4">
                    <p className="text-slate-800 dark:text-slate-200">
                      {b.pickupDate} &rarr; {b.returnDate}
                    </p>
                    <p className="text-[11px] text-slate-500 dark:text-slate-400">{b.rentalDays} jours de location</p>
                  </td>
                  <td className="px-5 py-4 font-bold text-slate-900 dark:text-white">
                    {b.totalPrice.toLocaleString()} TND
                  </td>
                  <td className="px-5 py-4">
                    {b.status === "active" && (
                      <span className="px-2.5 py-1 rounded-full text-[10px] font-bold bg-emerald-100 dark:bg-emerald-500/20 text-emerald-700 dark:text-emerald-300 border border-emerald-300 dark:border-emerald-500/30">
                        Active
                      </span>
                    )}
                    {b.status === "confirmed" && (
                      <span className="px-2.5 py-1 rounded-full text-[10px] font-bold bg-blue-100 dark:bg-blue-500/20 text-blue-700 dark:text-blue-300 border border-blue-300 dark:border-blue-500/30">
                        Confirmée
                      </span>
                    )}
                    {b.status === "pending" && (
                      <span className="px-2.5 py-1 rounded-full text-[10px] font-bold bg-amber-100 dark:bg-amber-500/20 text-amber-700 dark:text-amber-300 border border-amber-300 dark:border-amber-500/30">
                        En attente
                      </span>
                    )}
                    {b.status === "completed" && (
                      <span className="px-2.5 py-1 rounded-full text-[10px] font-bold bg-slate-100 dark:bg-slate-700/50 text-slate-700 dark:text-slate-300 border border-slate-300 dark:border-slate-600/30">
                        Terminée
                      </span>
                    )}
                    {b.status === "cancelled" && (
                      <span className="px-2.5 py-1 rounded-full text-[10px] font-bold bg-red-100 dark:bg-red-500/20 text-red-700 dark:text-red-300 border border-red-300 dark:border-red-500/30">
                        Annulée
                      </span>
                    )}
                  </td>
                  <td className="px-5 py-4 text-right">
                    <button
                      onClick={() => setSelectedBooking(b)}
                      className="px-3 py-1.5 rounded-lg bg-slate-100 hover:bg-slate-200 dark:bg-slate-800 dark:hover:bg-slate-700 text-slate-700 dark:text-slate-300 hover:text-slate-900 dark:hover:text-white transition-colors"
                    >
                      Détails
                    </button>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </div>

      {/* QUICK INSPECTION MODAL */}
      <BookingQuickView
        booking={
          selectedBooking
            ? {
                _id: (selectedBooking as any)._id || selectedBooking.id,
                reference: selectedBooking.reference,
                status: selectedBooking.status,
                paymentStatus: selectedBooking.paymentStatus,
                customerName: selectedBooking.customerName,
                customerPhone: selectedBooking.customerPhone,
                customerEmail: selectedBooking.customerEmail,
                vehicleName: selectedBooking.vehicleName,
                licensePlate: selectedBooking.licensePlate,
                pickupDate: selectedBooking.pickupDate,
                returnDate: selectedBooking.returnDate,
                pickupLocation: selectedBooking.pickupLocation,
                returnLocation: selectedBooking.returnLocation,
                totalAmount: (selectedBooking as any).totalAmount,
              }
            : null
        }
        onClose={() => setSelectedBooking(null)}
      />
    </div>
  );
}
