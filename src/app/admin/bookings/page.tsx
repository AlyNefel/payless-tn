"use client";

import React, { useState, useEffect } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import {
  CalendarCheck2,
  Search,
  CheckCircle2,
  Clock,
  Printer,
  Eye,
  X,
  MapPin,
  Car,
  CreditCard,
  User,
  Phone,
  Mail,
  FileText,
  RefreshCw,
  MoreVertical,
  ChevronDown,
  Trash2,
  MessageCircle,
  ExternalLink,
  AlertTriangle,
  Loader2,
  ShieldCheck,
  ShieldAlert,
} from "lucide-react";
import { useAdminLang } from "@/contexts/AdminLangContext";
import { ActionMenu, StatusBadge, ViewToggle, standardActions, useViewMode, usePermissions } from "@/components/admin/ui";
import { BookingQuickView } from "@/components/admin/BookingQuickView";

export interface BookingDisplayItem {
  id: string;
  _id?: string;
  reference: string;
  bookingReference?: string;
  customerName: string;
  customerPhone: string;
  customerEmail: string;
  vehicleName: string;
  licensePlate: string;
  pickupDate: string;
  returnDate: string;
  rentalDuration?: number;
  rentalDays?: number;
  pickupLocation: string;
  returnLocation: string;
  totalPrice?: number;
  totalAmount?: number;
  timbreFiscal?: number;
  contributionLF2026?: number;
  depositAmount: number;
  paymentStatus: "paid" | "partial" | "unpaid" | "refunded";
  status: "pending" | "confirmed" | "active" | "completed" | "cancelled" | "rejected";
  paymentMethod?: string;
  extras?: any[];
  createdAt: string;
}

export default function AdminBookingsPage() {
  const { lang } = useAdminLang();
  const router = useRouter();
  const [bookings, setBookings] = useState<BookingDisplayItem[]>([]);
  const [view, setView] = useViewMode("bookings", "table");
  const { can } = usePermissions();
  const [viewing, setViewing] = useState<BookingDisplayItem | null>(null);
  const [loaded, setLoaded] = useState(false);
  const [activeTab, setActiveTab] = useState<string>("All");
  const [search, setSearch] = useState("");
  const [selectedBooking, setSelectedBooking] = useState<BookingDisplayItem | null>(null);
  const [showVoucherModal, setShowVoucherModal] = useState(false);
  const [statusChangeFeedback, setStatusChangeFeedback] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);

  // Dropdown menu & delete modal states
  const [actionMenuOpenId, setActionMenuOpenId] = useState<string | null>(null);
  const [bookingToDelete, setBookingToDelete] = useState<BookingDisplayItem | null>(null);
  const [isDeleting, setIsDeleting] = useState(false);
  const [sendingEmailForRef, setSendingEmailForRef] = useState<string | null>(null);

  const fetchBookings = async () => {
    setLoading(true);
    try {
      const res = await fetch("/api/admin/bookings?limit=100");
      const json = await res.json();
      if (json.success && Array.isArray(json.bookings)) {
        setBookings(
          json.bookings.map((b: any) => ({
            ...b,
            totalPrice: b.totalAmount >= 1000 ? Math.round(b.totalAmount / 100) : b.totalAmount,
            rentalDays: b.rentalDuration || 1,
            paymentMethod: b.paymentMethod || "Paiement à la livraison",
            depositAmount: b.depositAmount >= 1000 ? Math.round(b.depositAmount / 100) : b.depositAmount || 0,
            timbreFiscal: b.timbreFiscal ? (b.timbreFiscal >= 100 ? b.timbreFiscal / 100 : b.timbreFiscal) : 1,
            contributionLF2026: b.contributionLF2026 ? (b.contributionLF2026 >= 100 ? b.contributionLF2026 / 100 : b.contributionLF2026) : (b.rentalDuration || 1) * 2,
          }))
        );
      }
    } catch (e) {
      console.error("Failed to fetch bookings:", e);
    } finally {
      setLoading(false);
      setLoaded(true);
    }
  };

  useEffect(() => {
    // Deep links (dashboard, calendar, notifications): /admin/bookings?search=PAY-…
    const q = new URLSearchParams(window.location.search).get("search");
    if (q) setSearch(q);
    fetchBookings();
  }, []);

  // Tab counts
  const tabCounts = {
    All: bookings.length,
    pending: bookings.filter((b) => b.status === "pending").length,
    confirmed: bookings.filter((b) => b.status === "confirmed").length,
    active: bookings.filter((b) => b.status === "active").length,
    completed: bookings.filter((b) => b.status === "completed").length,
    cancelled: bookings.filter((b) => b.status === "cancelled" || b.status === "rejected").length,
  };

  // Filtered list
  const filteredBookings = bookings.filter((b) => {
    const matchesTab =
      activeTab === "All" ||
      b.status?.toLowerCase() === activeTab.toLowerCase() ||
      (activeTab === "cancelled" && b.status === "rejected");

    const matchesSearch =
      (b.reference || "").toLowerCase().includes(search.toLowerCase()) ||
      (b.bookingReference || "").toLowerCase().includes(search.toLowerCase()) ||
      (b.customerName || "").toLowerCase().includes(search.toLowerCase()) ||
      (b.customerPhone || "").includes(search) ||
      (b.vehicleName || "").toLowerCase().includes(search.toLowerCase()) ||
      (b.licensePlate || "").toLowerCase().includes(search.toLowerCase());

    return matchesTab && matchesSearch;
  });

  // Handle instant status change
  const handleStatusChange = async (id: string, newStatus: BookingDisplayItem["status"]) => {
    const previous = bookings;
    setBookings((prev) =>
      prev.map((b) => (b.id === id || b._id === id ? { ...b, status: newStatus } : b))
    );
    try {
      const res = await fetch(`/api/admin/bookings/${id}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ status: newStatus }),
      });
      const data = await res.json().catch(() => ({}));
      if (!res.ok) throw new Error(data.error || "Modification refusée");
      setStatusChangeFeedback(
        newStatus === "confirmed"
          ? (lang === "fr" ? "Réservation confirmée ! Email envoyé au client." : "Booking confirmed! Email sent to customer.")
          : (lang === "fr" ? "Statut mis à jour." : "Status updated.")
      );
    } catch (e) {
      // The server refused (permission, validation…): put the previous status back.
      setBookings(previous);
      setStatusChangeFeedback(e instanceof Error ? e.message : "Erreur");
    }
    setTimeout(() => setStatusChangeFeedback(null), 4000);
    setActionMenuOpenId(null);
  };

  // Handle Permanent Deletion
  const handleDeleteBooking = async () => {
    if (!bookingToDelete) return;
    const targetId = bookingToDelete._id || bookingToDelete.id;
    const ref = bookingToDelete.reference || bookingToDelete.bookingReference || targetId;
    setIsDeleting(true);

    try {
      const res = await fetch(`/api/admin/bookings?id=${targetId}`, {
        method: "DELETE",
      });
      const data = await res.json();
      if (res.ok && data.success) {
        setBookings((prev) => prev.filter((b) => (b._id || b.id) !== targetId));
        setStatusChangeFeedback(
          lang === "fr"
            ? `Réservation ${ref} supprimée définitivement avec succès.`
            : `Reservation ${ref} permanently deleted.`
        );
        setTimeout(() => setStatusChangeFeedback(null), 4000);
        setBookingToDelete(null);
      } else {
        alert(data.error || "Erreur lors de la suppression de la réservation.");
      }
    } catch (err) {
      console.error("Delete booking error:", err);
      alert("Erreur de communication avec le serveur.");
    } finally {
      setIsDeleting(false);
    }
  };

  // Handle Email Resend
  const handleResendEmail = async (bookingRef: string) => {
    setSendingEmailForRef(bookingRef);
    setActionMenuOpenId(null);
    try {
      const res = await fetch("/api/bookings/send-email", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ bookingReference: bookingRef }),
      });
      const data = await res.json();
      if (res.ok && data.success) {
        setStatusChangeFeedback(
          lang === "fr"
            ? `Email de confirmation avec facture PDF renvoyé à ${data.sentTo} !`
            : `Confirmation email with PDF invoice resent to ${data.sentTo}!`
        );
      } else {
        alert(`Échec de l'envoi : ${data.error || "Erreur serveur SMTP"}`);
      }
    } catch {
      alert("Erreur de connexion avec le serveur.");
    } finally {
      setSendingEmailForRef(null);
      setTimeout(() => setStatusChangeFeedback(null), 5000);
    }
  };

  const handlePrint = () => {
    window.print();
  };

  const getCleanPhone = (phone?: string) => {
    if (!phone) return "";
    let clean = phone.replace(/[^0-9]/g, "");
    if (clean.length === 8) clean = "216" + clean;
    return clean;
  };

  const whatsappUrlFor = (b: BookingDisplayItem) => {
    const cleanPhone = getCleanPhone(b.customerPhone);
    if (!cleanPhone) return null;
    const bookingRef = b.reference || b.bookingReference || b._id || b.id;
    const baseUrl = typeof window !== "undefined" ? window.location.origin : "";
    const msg =
      `Bonjour *${b.customerName}*,\n\n` +
      `✅ Votre réservation chez *Payless Car Rental Tunisie* est confirmée.\n\n` +
      `📋 *Référence* : ${bookingRef}\n` +
      `🚗 *Véhicule* : ${b.vehicleName}${b.licensePlate ? ` (${b.licensePlate})` : ""}\n` +
      `📅 *Période* : du ${b.pickupDate} au ${b.returnDate} (${b.rentalDays} jours)\n` +
      `📍 *Prise en charge* : ${b.pickupLocation}\n` +
      `💰 *Total TTC* : ${(b.totalPrice || 0).toLocaleString("fr-FR")} TND\n\n` +
      `📄 Bon de réservation : ${baseUrl}/api/bookings/pdf?ref=${bookingRef}`;
    return `https://wa.me/${cleanPhone}?text=${encodeURIComponent(msg)}`;
  };

  /** Unified actions: Voir / Modifier / Voir & modifier, then documents, status and delete. */
  const actionsFor = (b: BookingDisplayItem) => {
    const bookingId = b._id || b.id;
    const bookingRef = b.reference || b.bookingReference || bookingId;
    const wa = whatsappUrlFor(b);
    const extra = [
      { key: "pdf", label: "Facture PDF", icon: FileText, href: `/api/bookings/pdf?ref=${bookingRef}`, external: true },
      {
        key: "voucher",
        label: "Bon de réservation",
        icon: Printer,
        onClick: () => {
          setSelectedBooking(b);
          setShowVoucherModal(true);
        },
      },
      {
        key: "email",
        label: sendingEmailForRef === bookingRef ? "Envoi en cours…" : "Renvoyer l'email",
        icon: Mail,
        disabled: sendingEmailForRef === bookingRef,
        onClick: () => handleResendEmail(bookingRef),
      },
      ...(wa ? [{ key: "wa", label: "Confirmation WhatsApp", icon: MessageCircle, href: wa, external: true }] : []),
      ...(can("bookings.edit") && b.status === "pending"
        ? [{ key: "confirm", label: "Confirmer", icon: CheckCircle2, separated: true, onClick: () => handleStatusChange(bookingId, "confirmed") }]
        : []),
      ...(can("bookings.cancel") && !["cancelled", "rejected", "completed"].includes(b.status)
        ? [{ key: "cancel", label: "Annuler la réservation", icon: X, onClick: () => handleStatusChange(bookingId, "cancelled") }]
        : []),
    ];
    return standardActions({
      onView: () => setViewing(b),
      onEdit: () => router.push(`/admin/bookings/${bookingId}#statut`),
      viewEditHref: `/admin/bookings/${bookingId}`,
      onDelete: () => setBookingToDelete(b),
      deleteLabel: "Supprimer la réservation",
      can: { edit: can("bookings.edit"), delete: can("bookings.delete") },
      extra,
    });
  };

  return (
    <div className="space-y-6">
      {/* Header */}
      <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4">
        <div>
          <h1 className="text-2xl sm:text-3xl font-extrabold text-slate-900 dark:text-white tracking-tight">
            {lang === "fr" ? "Gestion des Réservations" : "Reservation Management"}
          </h1>
          <p className="text-xs sm:text-sm text-slate-500 dark:text-slate-400 mt-1">
            {lang === "fr"
              ? "Suivi en temps réel des contrats, validations, statuts fiscaux (LF 2026, Timbre), PDF et actions CRUD."
              : "Real-time contracts, confirmations, fiscal rules (LF 2026, stamp), official vouchers and full CRUD actions."}
          </p>
        </div>

        <div className="flex items-center gap-2">
          {statusChangeFeedback && (
            <div className="inline-flex items-center gap-2 px-3.5 py-2 rounded-xl bg-emerald-500/10 border border-emerald-500/20 text-emerald-600 dark:text-emerald-400 text-xs font-semibold animate-pulse">
              <CheckCircle2 className="w-4 h-4 shrink-0" />
              <span>{statusChangeFeedback}</span>
            </div>
          )}

          <ViewToggle value={view} onChange={setView} />
          <button
            onClick={fetchBookings}
            className="flex items-center gap-1.5 px-3 py-2 border border-slate-200 dark:border-slate-800 rounded-xl text-xs font-medium hover:bg-slate-100 dark:hover:bg-slate-800 transition-colors shadow-xs"
          >
            <RefreshCw className={`w-3.5 h-3.5 ${loading ? "animate-spin" : ""}`} />
            <span>{lang === "fr" ? "Actualiser" : "Refresh"}</span>
          </button>
        </div>
      </div>

      {/* FILTER TABS & SEARCH */}
      <div className="rounded-2xl bg-white dark:bg-[#0f141f] border border-slate-200 dark:border-slate-800 p-4 shadow-xs space-y-4">
        {/* Status Tabs */}
        <div className="flex flex-wrap items-center gap-2 border-b border-slate-200 dark:border-slate-800/80 pb-3">
          {[
            { key: "All", label: lang === "fr" ? "Toutes" : "All", count: tabCounts.All },
            { key: "pending", label: lang === "fr" ? "En Attente" : "Pending", count: tabCounts.pending },
            { key: "confirmed", label: lang === "fr" ? "Confirmées" : "Confirmed", count: tabCounts.confirmed },
            { key: "active", label: lang === "fr" ? "En Cours" : "Active", count: tabCounts.active },
            { key: "completed", label: lang === "fr" ? "Clôturées" : "Completed", count: tabCounts.completed },
            { key: "cancelled", label: lang === "fr" ? "Annulées" : "Cancelled", count: tabCounts.cancelled },
          ].map((tab) => (
            <button
              key={tab.key}
              onClick={() => setActiveTab(tab.key)}
              className={`px-3 py-1.5 rounded-xl text-xs font-semibold flex items-center gap-2 transition-all ${
                activeTab === tab.key
                  ? "bg-blue-600 text-white shadow-md shadow-blue-600/30"
                  : "bg-slate-100 hover:bg-slate-200 text-slate-700 dark:bg-slate-900/60 dark:hover:bg-slate-800 dark:text-slate-400 dark:hover:text-slate-200"
              }`}
            >
              <span>{tab.label}</span>
              <span
                className={`text-[10px] px-1.5 py-0.2 rounded-full ${
                  activeTab === tab.key
                    ? "bg-white/20 text-white"
                    : "bg-slate-200 dark:bg-slate-800 text-slate-700 dark:text-slate-400"
                }`}
              >
                {tab.count}
              </span>
            </button>
          ))}
        </div>

        {/* Search Input Bar */}
        <div className="relative">
          <Search className="w-4 h-4 text-slate-400 absolute left-3.5 top-1/2 -translate-y-1/2" />
          <input
            type="text"
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            placeholder={lang === "fr" ? "Rechercher par référence (ex: PAY-2026), client, téléphone, véhicule, matricule..." : "Search by reference, customer name, phone, vehicle, license plate..."}
            className="w-full rounded-xl bg-slate-50 dark:bg-slate-900 border border-slate-300 dark:border-slate-700/80 pl-10 pr-4 py-2.5 text-xs text-slate-900 dark:text-white placeholder-slate-400 focus:outline-none focus:border-blue-500"
          />
        </div>
      </div>

      {/* RESERVATIONS — cards or table (remembered per browser) */}
      {!loaded ? (
        <div className="py-16 flex justify-center">
          <Loader2 className="w-6 h-6 animate-spin text-slate-400" />
        </div>
      ) : filteredBookings.length === 0 ? (
        <div className="py-16 text-center text-sm text-slate-500 rounded-2xl border border-dashed border-slate-200 dark:border-slate-800">
          {bookings.length === 0
            ? lang === "fr" ? "Aucune réservation pour le moment." : "No reservations yet."
            : lang === "fr" ? "Aucune réservation ne correspond aux filtres." : "No reservation matches the filters."}
        </div>
      ) : view === "grid" ? (
        <div className="grid grid-cols-1 md:grid-cols-2 xl:grid-cols-3 gap-4">
          {filteredBookings.map((b) => {
            const bookingId = b._id || b.id;
            const bookingRef = b.reference || b.bookingReference || bookingId;
            return (
              <div key={bookingId} className="p-4 rounded-2xl bg-white dark:bg-[#0f141f] border border-slate-200 dark:border-slate-800 flex flex-col gap-3">
                <div className="flex items-start justify-between gap-2">
                  <button type="button" onClick={() => setViewing(b)} className="min-w-0 text-left">
                    <span className="block font-mono font-bold text-blue-600 dark:text-blue-400">{bookingRef}</span>
                    <span className="block text-sm font-bold text-slate-900 dark:text-white truncate">{b.customerName}</span>
                  </button>
                  <ActionMenu items={actionsFor(b)} label={`Actions pour ${bookingRef}`} size="sm" />
                </div>
                <div className="flex flex-wrap gap-1">
                  <StatusBadge status={b.status} />
                  <StatusBadge status={b.paymentStatus} kind="payment" />
                </div>
                <div className="text-xs space-y-1 text-slate-600 dark:text-slate-300">
                  <p className="flex items-center gap-1.5">
                    <Car className="w-3.5 h-3.5 text-slate-400" /> {b.vehicleName}
                    {b.licensePlate && <span className="font-mono text-[10px] text-amber-600 dark:text-amber-300">· {b.licensePlate}</span>}
                  </p>
                  <p className="flex items-center gap-1.5">
                    <Clock className="w-3.5 h-3.5 text-slate-400" /> {b.pickupDate} → {b.returnDate} ({b.rentalDays} j)
                  </p>
                  <p className="flex items-center gap-1.5 truncate">
                    <MapPin className="w-3.5 h-3.5 text-slate-400" /> {b.pickupLocation}
                  </p>
                </div>
                <div className="mt-auto pt-2 border-t border-slate-100 dark:border-slate-800 flex items-center justify-between">
                  <span className="text-sm font-black text-slate-900 dark:text-white">{(b.totalPrice || 0).toLocaleString("fr-FR")} TND</span>
                  <Link href={`/admin/bookings/${bookingId}`} className="text-xs font-bold text-blue-600 hover:underline">
                    Voir & modifier →
                  </Link>
                </div>
              </div>
            );
          })}
        </div>
      ) : (
        <div className="rounded-2xl bg-white dark:bg-[#0f141f] border border-slate-200 dark:border-slate-800 shadow-xs overflow-x-auto">
          <table className="w-full min-w-[900px] text-left text-xs text-slate-700 dark:text-slate-300">
            <thead className="bg-slate-50 dark:bg-slate-900/90 text-[11px] uppercase tracking-wider text-slate-500 dark:text-slate-400 border-b border-slate-200 dark:border-slate-800">
              <tr>
                <th className="px-4 py-3 font-semibold">{lang === "fr" ? "Référence" : "Reference"}</th>
                <th className="px-4 py-3 font-semibold">{lang === "fr" ? "Client" : "Customer"}</th>
                <th className="px-4 py-3 font-semibold">{lang === "fr" ? "Véhicule" : "Vehicle"}</th>
                <th className="px-4 py-3 font-semibold">{lang === "fr" ? "Dates" : "Dates"}</th>
                <th className="px-4 py-3 font-semibold">Total</th>
                <th className="px-4 py-3 font-semibold">{lang === "fr" ? "Paiement" : "Payment"}</th>
                <th className="px-4 py-3 font-semibold">{lang === "fr" ? "Statut" : "Status"}</th>
                <th className="px-4 py-3 w-12" aria-label="Actions" />
              </tr>
            </thead>
            <tbody className="divide-y divide-slate-200 dark:divide-slate-800/60">
              {filteredBookings.map((b) => {
                const bookingId = b._id || b.id;
                const bookingRef = b.reference || b.bookingReference || bookingId;
                return (
                  <tr key={bookingId} className="hover:bg-slate-50 dark:hover:bg-slate-900/40 transition-colors">
                    <td className="px-4 py-3">
                      <button type="button" onClick={() => setViewing(b)} className="font-mono font-bold text-blue-600 dark:text-blue-400 hover:underline">
                        {bookingRef}
                      </button>
                      <p className="text-[10px] text-slate-500 mt-0.5">
                        {b.createdAt ? new Date(b.createdAt).toLocaleDateString("fr-FR") : ""}
                      </p>
                    </td>
                    <td className="px-4 py-3">
                      <p className="font-semibold text-slate-900 dark:text-white">{b.customerName}</p>
                      <p className="text-[11px] text-slate-500 flex items-center gap-1 mt-0.5">
                        <Phone className="w-3 h-3" /> {b.customerPhone}
                      </p>
                    </td>
                    <td className="px-4 py-3">
                      <p className="font-medium text-slate-900 dark:text-white">{b.vehicleName}</p>
                      {b.licensePlate && <span className="font-mono text-[10px] font-bold text-amber-600 dark:text-amber-300">{b.licensePlate}</span>}
                    </td>
                    <td className="px-4 py-3">
                      <p className="font-medium">{b.pickupDate} → {b.returnDate}</p>
                      <p className="text-[10px] text-slate-500 truncate max-w-[200px]">{b.pickupLocation} ({b.rentalDays} j)</p>
                    </td>
                    <td className="px-4 py-3 font-bold text-slate-900 dark:text-white whitespace-nowrap">{(b.totalPrice || 0).toLocaleString("fr-FR")} TND</td>
                    <td className="px-4 py-3"><StatusBadge status={b.paymentStatus} kind="payment" /></td>
                    <td className="px-4 py-3">
                      {can("bookings.edit") ? (
                        <select
                          value={b.status}
                          aria-label={`Statut de ${bookingRef}`}
                          onChange={(e) => handleStatusChange(bookingId, e.target.value as BookingDisplayItem["status"])}
                          className="text-[11px] font-bold rounded-lg px-2 py-1.5 border border-slate-200 dark:border-slate-700 bg-white dark:bg-slate-900 cursor-pointer"
                        >
                          <option value="pending">{lang === "fr" ? "En attente" : "Pending"}</option>
                          <option value="confirmed">{lang === "fr" ? "Confirmée" : "Confirmed"}</option>
                          <option value="active">{lang === "fr" ? "En cours" : "Active"}</option>
                          <option value="completed">{lang === "fr" ? "Clôturée" : "Completed"}</option>
                          {can("bookings.cancel") && <option value="cancelled">{lang === "fr" ? "Annulée" : "Cancelled"}</option>}
                        </select>
                      ) : (
                        <StatusBadge status={b.status} />
                      )}
                    </td>
                    <td className="px-4 py-3 text-right">
                      <ActionMenu items={actionsFor(b)} label={`Actions pour ${bookingRef}`} size="sm" />
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      )}

      <BookingQuickView
        booking={
          viewing
            ? {
                _id: viewing._id || viewing.id,
                reference: viewing.reference,
                status: viewing.status,
                paymentStatus: viewing.paymentStatus,
                customerName: viewing.customerName,
                customerPhone: viewing.customerPhone,
                customerEmail: viewing.customerEmail,
                vehicleName: viewing.vehicleName,
                licensePlate: viewing.licensePlate,
                pickupDate: viewing.pickupDate,
                returnDate: viewing.returnDate,
                pickupLocation: viewing.pickupLocation,
                returnLocation: viewing.returnLocation,
                totalAmount: viewing.totalAmount,
              }
            : null
        }
        onClose={() => setViewing(null)}
      />

      {/* MODAL: DELETE RESERVATION CONFIRMATION */}
      {bookingToDelete && (
        <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-black/75 backdrop-blur-sm animate-in fade-in">
          <div className="w-full max-w-lg rounded-3xl bg-white dark:bg-[#0f141f] border border-red-200 dark:border-red-900/60 shadow-2xl p-6 sm:p-7 space-y-5 animate-in zoom-in-95">
            <div className="flex items-start gap-3">
              <div className="w-12 h-12 rounded-2xl bg-red-100 dark:bg-red-950/50 flex items-center justify-center text-red-600 shrink-0">
                <Trash2 className="w-6 h-6" />
              </div>
              <div className="flex-1">
                <h3 className="text-lg font-extrabold text-slate-900 dark:text-white tracking-tight">
                  Supprimer définitivement la réservation ?
                </h3>
                <p className="text-xs text-slate-500 mt-1">
                  Cette action est irréversible et supprimera toutes les données associées de la base de données.
                </p>
              </div>
              <button
                type="button"
                onClick={() => setBookingToDelete(null)}
                className="p-1.5 rounded-xl bg-slate-100 dark:bg-slate-800 text-slate-400 hover:text-slate-700 dark:hover:text-white transition-colors"
              >
                <X className="w-5 h-5" />
              </button>
            </div>

            {/* Booking Summary Box */}
            <div className="rounded-2xl bg-slate-50 dark:bg-slate-900/70 p-4 border border-slate-200 dark:border-slate-800 space-y-2 text-xs">
              <div className="flex justify-between items-center pb-2 border-b border-slate-200 dark:border-slate-800">
                <span className="font-semibold text-slate-500">Référence :</span>
                <span className="font-mono font-bold text-blue-600 dark:text-blue-400">
                  {bookingToDelete.reference || bookingToDelete.bookingReference}
                </span>
              </div>
              <div className="flex justify-between items-center">
                <span className="text-slate-500">Client :</span>
                <span className="font-bold text-slate-900 dark:text-white">{bookingToDelete.customerName}</span>
              </div>
              <div className="flex justify-between items-center">
                <span className="text-slate-500">Téléphone :</span>
                <span className="font-medium text-slate-700 dark:text-slate-300">{bookingToDelete.customerPhone}</span>
              </div>
              <div className="flex justify-between items-center">
                <span className="text-slate-500">Véhicule réservé :</span>
                <span className="font-bold text-slate-900 dark:text-white">{bookingToDelete.vehicleName}</span>
              </div>
              <div className="flex justify-between items-center">
                <span className="text-slate-500">Dates :</span>
                <span className="text-slate-700 dark:text-slate-300">{bookingToDelete.pickupDate} &rarr; {bookingToDelete.returnDate}</span>
              </div>
              <div className="flex justify-between items-center pt-2 border-t border-slate-200 dark:border-slate-800">
                <span className="font-bold text-slate-700 dark:text-slate-300">Montant total :</span>
                <span className="font-mono font-black text-slate-900 dark:text-white text-sm">
                  {(bookingToDelete.totalPrice || 0).toLocaleString("fr-FR")} TND
                </span>
              </div>
            </div>

            {/* Fleet Stock Notice */}
            <div className="p-3.5 bg-emerald-50 dark:bg-emerald-950/30 rounded-xl border border-emerald-200 dark:border-emerald-800 text-xs text-emerald-800 dark:text-emerald-300 flex items-start gap-2.5">
              <CheckCircle2 className="w-4 h-4 text-emerald-600 shrink-0 mt-0.5" />
              <span>
                <strong>Restitution de stock automatique :</strong> Le quota d'unités physiques disponibles du véhicule sera automatiquement ré-incrémenté sur le parc.
              </span>
            </div>

            {/* Action Buttons */}
            <div className="flex items-center justify-end gap-3 pt-2">
              <button
                type="button"
                onClick={() => setBookingToDelete(null)}
                disabled={isDeleting}
                className="px-4 py-2.5 rounded-xl border border-slate-300 dark:border-slate-700 bg-white dark:bg-slate-800 text-slate-700 dark:text-slate-300 text-xs font-bold hover:bg-slate-100 transition-colors"
              >
                Annuler
              </button>
              <button
                type="button"
                onClick={handleDeleteBooking}
                disabled={isDeleting}
                className="px-5 py-2.5 rounded-xl bg-red-600 hover:bg-red-700 text-white text-xs font-bold shadow-md shadow-red-600/30 active:scale-95 transition-all flex items-center gap-2 disabled:opacity-50"
              >
                {isDeleting ? <Loader2 className="w-4 h-4 animate-spin" /> : <Trash2 className="w-4 h-4" />}
                <span>{isDeleting ? "Suppression en cours..." : "Confirmer la suppression"}</span>
              </button>
            </div>
          </div>
        </div>
      )}

      {/* OFFICIAL VOUCHER & BOOKING DETAILS MODAL */}
      {showVoucherModal && selectedBooking && (
        <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-black/85 backdrop-blur-md overflow-y-auto">
          <div className="w-full max-w-2xl rounded-3xl bg-white dark:bg-[#0f141f] border border-slate-200 dark:border-slate-700 shadow-2xl p-6 sm:p-8 my-8 max-h-[95vh] overflow-y-auto">
            {/* Modal header with Print and Close buttons */}
            <div className="flex items-center justify-between pb-4 border-b border-slate-200 dark:border-slate-800 no-print">
              <div className="flex items-center gap-2">
                <FileText className="w-5 h-5 text-blue-600 dark:text-blue-400" />
                <h3 className="text-base font-bold text-slate-900 dark:text-white">
                  {lang === "fr" ? "Bon de Réservation / Voucher Officiel" : "Official Booking Voucher"}
                </h3>
              </div>
              <div className="flex items-center gap-2">
                <button
                  onClick={handlePrint}
                  className="inline-flex items-center gap-1.5 px-3 py-1.5 rounded-xl bg-blue-600 hover:bg-blue-500 text-white text-xs font-semibold shadow-md shadow-blue-600/30"
                >
                  <Printer className="w-3.5 h-3.5" />
                  <span>{lang === "fr" ? "Imprimer le Voucher" : "Print Voucher"}</span>
                </button>
                <button
                  onClick={() => setShowVoucherModal(false)}
                  className="p-1.5 rounded-xl bg-slate-100 hover:bg-slate-200 dark:bg-slate-800 dark:hover:bg-slate-700 text-slate-500 dark:text-slate-400 hover:text-slate-900 dark:hover:text-white"
                >
                  <X className="w-5 h-5" />
                </button>
              </div>
            </div>

            {/* Printable Voucher Paper */}
            <div
              id="printable-voucher"
              className="mt-6 rounded-2xl bg-white text-slate-900 p-6 sm:p-8 shadow-xl border border-slate-200 space-y-6"
            >
              {/* Voucher Brand & Header */}
              <div className="flex items-start justify-between border-b-2 border-slate-900 pb-5">
                <div>
                  <h2 className="text-2xl font-black tracking-tight text-blue-800">
                    PAYLESS CAR RENTAL
                  </h2>
                  <p className="text-xs text-slate-600 font-semibold tracking-wider uppercase">
                    Bon de Location Officiel • Voucher
                  </p>
                  <p className="text-[11px] text-slate-500 mt-1">
                    Houimli Rent a Car SARL • RC Ariana B0123452020 • MF 1234567/A/M/000
                  </p>
                </div>

                <div className="text-right">
                  <div className="inline-block px-3 py-1 bg-slate-100 rounded border border-slate-300 font-mono text-sm font-black text-slate-900">
                    {selectedBooking.reference || selectedBooking.bookingReference}
                  </div>
                  <p className="text-[11px] text-slate-500 mt-1">
                    Émis le {selectedBooking.createdAt ? new Date(selectedBooking.createdAt).toLocaleDateString("fr-FR") : "Récent"}
                  </p>
                </div>
              </div>

              {/* Customer & Vehicle Info Grid */}
              <div className="grid grid-cols-1 sm:grid-cols-2 gap-5 text-xs">
                {/* Client Section */}
                <div className="rounded-xl bg-slate-50 p-4 border border-slate-200">
                  <span className="text-[10px] font-bold uppercase tracking-wider text-slate-500">
                    Informations Locataire
                  </span>
                  <p className="text-sm font-bold text-slate-900 mt-1">
                    {selectedBooking.customerName}
                  </p>
                  <p className="text-slate-600 mt-0.5">{selectedBooking.customerEmail}</p>
                  <p className="text-slate-600 font-medium">{selectedBooking.customerPhone}</p>
                  <p className="text-slate-500 text-[11px] mt-2">
                    Permis de conduire vérifié à la prise en charge
                  </p>
                </div>

                {/* Vehicle Section */}
                <div className="rounded-xl bg-slate-50 p-4 border border-slate-200">
                  <span className="text-[10px] font-bold uppercase tracking-wider text-slate-500">
                    Véhicule Assigné
                  </span>
                  <p className="text-sm font-bold text-slate-900 mt-1">
                    {selectedBooking.vehicleName}
                  </p>
                  <p className="text-slate-600 font-mono font-bold mt-0.5">
                    Matricule: {selectedBooking.licensePlate || "TUN-2026"}
                  </p>
                  <p className="text-slate-600">Catégorie: Tourisme & Confort</p>
                  <p className="text-slate-500 text-[11px] mt-2">
                    Carburant: Niveau plein à plein
                  </p>
                </div>
              </div>

              {/* Itinerary Schedule */}
              <div className="rounded-xl border border-slate-300 overflow-hidden text-xs">
                <div className="grid grid-cols-2 bg-slate-100 font-bold p-3 border-b border-slate-300">
                  <span>Prise en charge (Départ)</span>
                  <span>Restitution (Retour)</span>
                </div>
                <div className="grid grid-cols-2 p-3 gap-2">
                  <div>
                    <p className="font-bold text-slate-900">{selectedBooking.pickupDate}</p>
                    <p className="text-slate-600 text-[11px]">{selectedBooking.pickupLocation}</p>
                  </div>
                  <div>
                    <p className="font-bold text-slate-900">{selectedBooking.returnDate}</p>
                    <p className="text-slate-600 text-[11px]">{selectedBooking.returnLocation}</p>
                  </div>
                </div>
              </div>

              {/* Pricing breakdown: Table view, omitting all 0 DT items */}
              <div className="rounded-xl border border-slate-200 overflow-hidden text-xs">
                <table className="w-full text-left">
                  <thead>
                    <tr className="bg-slate-100 font-bold text-slate-700 border-b border-slate-200">
                      <th className="p-3">Désignation</th>
                      <th className="p-3 text-right">Montant (TND)</th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-slate-200">
                    <tr>
                      <td className="p-3 text-slate-700">
                        Location de base ({selectedBooking.rentalDays} jours)
                      </td>
                      <td className="p-3 text-right font-mono font-bold text-slate-900">
                        {((selectedBooking.totalPrice || 0) - (selectedBooking.contributionLF2026 || (selectedBooking.rentalDays || 1) * 2) - 1).toLocaleString("fr-FR")} TND
                      </td>
                    </tr>
                    {(selectedBooking.contributionLF2026 || 0) > 0 && (
                      <tr>
                        <td className="p-3 text-slate-700">
                          Contribution fiscale LF 2026 (2 DT / j × {selectedBooking.rentalDays} j)
                        </td>
                        <td className="p-3 text-right font-mono font-bold text-slate-900">
                          +{(selectedBooking.contributionLF2026 || (selectedBooking.rentalDays || 1) * 2).toLocaleString("fr-FR")} TND
                        </td>
                      </tr>
                    )}
                    {(selectedBooking.timbreFiscal || 0) > 0 && (
                      <tr>
                        <td className="p-3 text-slate-700">Timbre fiscal de quittance</td>
                        <td className="p-3 text-right font-mono font-bold text-slate-900">
                          +{selectedBooking.timbreFiscal} TND
                        </td>
                      </tr>
                    )}
                  </tbody>
                  <tfoot>
                    <tr className="bg-slate-50 font-bold border-t-2 border-slate-900">
                      <td className="p-3 text-sm text-slate-900">TOTAL RÈGLEMENT T.T.C</td>
                      <td className="p-3 text-right font-mono text-base text-blue-800">
                        {(selectedBooking.totalPrice || 0).toLocaleString("fr-FR")} TND
                      </td>
                    </tr>
                    {selectedBooking.depositAmount > 0 && (
                      <tr className="bg-amber-50/60 text-amber-900 border-t border-amber-200">
                        <td className="p-2.5 text-xs">Caution de garantie (Empreinte CB bloquée & restituée)</td>
                        <td className="p-2.5 text-right font-mono font-bold">
                          {(selectedBooking.depositAmount || 0).toLocaleString("fr-FR")} TND
                        </td>
                      </tr>
                    )}
                  </tfoot>
                </table>
              </div>

              {/* Signatures box */}
              <div className="grid grid-cols-2 gap-8 pt-4 border-t border-slate-200 text-xs">
                <div>
                  <p className="font-semibold text-slate-700">Signature du Client:</p>
                  <div className="h-14 border-b border-dashed border-slate-400 mt-2"></div>
                </div>
                <div className="text-right">
                  <p className="font-semibold text-slate-700">Cachet & Signature Agence:</p>
                  {/* eslint-disable-next-line @next/next/no-img-element -- printed voucher, local asset */}
                  <img
                    src="/brand/cachet-signature.png"
                    alt="Cachet et signature de Houimli Rent a Car SARL"
                    className="ml-auto mt-1 h-28 w-auto"
                  />
                </div>
              </div>

              {/* Footer notes */}
              <div className="text-[10px] text-slate-500 text-center border-t border-slate-200 pt-3">
                Assistance dépannage 24h/7j en Tunisie: +216 25 120 130 • Houimli Rent a Car SARL.
              </div>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
