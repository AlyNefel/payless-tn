"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import Link from "next/link";
import { X, Bell, AlertTriangle, CheckCircle2, Wrench } from "lucide-react";

export interface LiveNotification {
  id: string;
  type: string;
  title: string;
  message: string;
  createdAt: string;
  link?: string;
  severity: "info" | "success" | "warning" | "critical";
  category?: string;
  unread: boolean;
}

type Lang = "fr" | "en";
const POLL_MS = 20_000;

function pick(v: unknown, lang: Lang): string {
  if (v && typeof v === "object") {
    const o = v as Record<string, string>;
    return o[lang] || o.fr || o.en || "";
  }
  return String(v || "");
}

export function timeAgo(dateStr: string, lang: Lang): string {
  const diff = Math.max(0, Math.floor((Date.now() - new Date(dateStr).getTime()) / 1000));
  if (diff < 60) return lang === "en" ? "just now" : "à l'instant";
  if (diff < 3600) return lang === "en" ? `${Math.floor(diff / 60)} min ago` : `il y a ${Math.floor(diff / 60)} min`;
  if (diff < 86400) return lang === "en" ? `${Math.floor(diff / 3600)} h ago` : `il y a ${Math.floor(diff / 3600)} h`;
  return new Date(dateStr).toLocaleDateString(lang === "en" ? "en-GB" : "fr-FR");
}

/** Short two-tone chime (no asset needed). Silently ignored when audio is blocked. */
function chime(critical: boolean) {
  try {
    const Ctx = window.AudioContext || (window as unknown as { webkitAudioContext?: typeof AudioContext }).webkitAudioContext;
    if (!Ctx) return;
    const ctx = new Ctx();
    const tones = critical ? [880, 660, 880] : [660, 880];
    tones.forEach((f, i) => {
      const o = ctx.createOscillator();
      const g = ctx.createGain();
      o.frequency.value = f;
      o.type = "sine";
      g.gain.setValueAtTime(0.0001, ctx.currentTime + i * 0.15);
      g.gain.exponentialRampToValueAtTime(0.15, ctx.currentTime + i * 0.15 + 0.02);
      g.gain.exponentialRampToValueAtTime(0.0001, ctx.currentTime + i * 0.15 + 0.14);
      o.connect(g).connect(ctx.destination);
      o.start(ctx.currentTime + i * 0.15);
      o.stop(ctx.currentTime + i * 0.15 + 0.15);
    });
    setTimeout(() => ctx.close().catch(() => {}), 1000);
  } catch {
    /* ignore */
  }
}

/**
 * Live back-office notifications: polls every 20 s (and on tab focus), raises a toast,
 * a sound and a desktop notification for each new alert. Survives network errors
 * (exponential back-off) and never polls in a hidden tab.
 */
export function useLiveNotifications(enabled: boolean, lang: Lang) {
  const [items, setItems] = useState<LiveNotification[]>([]);
  const [unreadCount, setUnreadCount] = useState(0);
  const [toasts, setToasts] = useState<LiveNotification[]>([]);
  const [connected, setConnected] = useState(true);
  const seenIds = useRef<Set<string>>(new Set());
  const firstLoad = useRef(true);
  const failures = useRef(0);
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const langRef = useRef(lang);
  useEffect(() => {
    langRef.current = lang;
  }, [lang]);

  const map = useCallback(
    (n: any): LiveNotification => ({
      id: String(n._id),
      type: n.type,
      title: pick(n.title, langRef.current),
      message: pick(n.message, langRef.current),
      createdAt: n.createdAt,
      link: n.link,
      severity: n.severity || (n.priority === "high" ? "warning" : "info"),
      category: n.category,
      unread: !n.isRead,
    }),
    []
  );

  const poll = useCallback(async () => {
    if (!enabled) return;
    if (typeof document !== "undefined" && document.visibilityState === "hidden") {
      timer.current = setTimeout(poll, POLL_MS);
      return;
    }
    try {
      const res = await fetch("/api/admin/notifications?limit=15", { cache: "no-store" });
      if (res.status === 401 || res.status === 403) return; // signed out: stop polling
      if (!res.ok) throw new Error(String(res.status));
      const data = await res.json();
      const list: LiveNotification[] = (data.notifications || []).map(map);
      setItems(list);
      setUnreadCount(Number(data.unreadCount ?? list.filter((n) => n.unread).length));

      // New = never seen before (id based: immune to clock skew and to reminders that become due).
      const fresh = list.filter((n) => n.unread && !seenIds.current.has(n.id));
      list.forEach((n) => seenIds.current.add(n.id));
      if (!firstLoad.current) {
        if (fresh.length > 0) {
          setToasts((t) => [...fresh.slice(0, 3), ...t].slice(0, 4));
          chime(fresh.some((n) => n.severity === "critical" || n.severity === "warning"));
          if (typeof Notification !== "undefined" && Notification.permission === "granted" && document.visibilityState !== "visible") {
            fresh.slice(0, 3).forEach((n) => {
              try {
                const dn = new Notification(n.title, { body: n.message, tag: n.id, icon: "/icon-192.png" });
                dn.onclick = () => {
                  window.focus();
                  if (n.link) window.location.href = n.link;
                };
              } catch {
                /* ignore */
              }
            });
          }
        }
      }
      firstLoad.current = false;
      failures.current = 0;
      setConnected(true);
      timer.current = setTimeout(poll, POLL_MS);
    } catch {
      failures.current += 1;
      setConnected(false);
      timer.current = setTimeout(poll, Math.min(POLL_MS * 2 ** failures.current, 5 * 60_000));
    }
  }, [enabled, map]);

  useEffect(() => {
    if (!enabled) return;
    poll();
    const onVisible = () => {
      if (document.visibilityState === "visible") {
        if (timer.current) clearTimeout(timer.current);
        poll();
      }
    };
    document.addEventListener("visibilitychange", onVisible);
    window.addEventListener("online", onVisible);
    return () => {
      if (timer.current) clearTimeout(timer.current);
      document.removeEventListener("visibilitychange", onVisible);
      window.removeEventListener("online", onVisible);
    };
  }, [enabled, poll]);

  // Auto-dismiss toasts.
  useEffect(() => {
    if (toasts.length === 0) return;
    const t = setTimeout(() => setToasts((x) => x.slice(0, -1)), 8000);
    return () => clearTimeout(t);
  }, [toasts]);

  const markRead = useCallback(async (id: string) => {
    setItems((list) => list.map((n) => (n.id === id ? { ...n, unread: false } : n)));
    setUnreadCount((c) => Math.max(0, c - 1));
    await fetch("/api/admin/notifications", {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ id, isRead: true }),
    }).catch(() => {});
  }, []);

  const markAllRead = useCallback(async () => {
    setItems((list) => list.map((n) => ({ ...n, unread: false })));
    setUnreadCount(0);
    await fetch("/api/admin/notifications", {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ markAllRead: true }),
    }).catch(() => {});
  }, []);

  const dismissToast = useCallback((id: string) => setToasts((t) => t.filter((n) => n.id !== id)), []);

  const requestDesktopPermission = useCallback(() => {
    if (typeof Notification !== "undefined" && Notification.permission === "default") {
      Notification.requestPermission().catch(() => {});
    }
  }, []);

  return { items, unreadCount, toasts, connected, markRead, markAllRead, dismissToast, requestDesktopPermission, refresh: poll };
}

export function severityIcon(n: LiveNotification) {
  if (n.severity === "critical" || n.severity === "warning") return AlertTriangle;
  if (n.severity === "success") return CheckCircle2;
  if (n.category === "maintenance") return Wrench;
  return Bell;
}

export const severityColor: Record<LiveNotification["severity"], string> = {
  critical: "text-red-500",
  warning: "text-amber-500",
  success: "text-emerald-500",
  info: "text-blue-500",
};

export function NotificationToasts({
  toasts,
  onDismiss,
  onOpen,
}: {
  toasts: LiveNotification[];
  onDismiss: (id: string) => void;
  onOpen: (n: LiveNotification) => void;
}) {
  if (toasts.length === 0) return null;
  return (
    <div className="fixed bottom-4 right-4 left-4 sm:left-auto z-[70] flex flex-col gap-2 sm:w-96" role="status" aria-live="polite">
      {toasts.map((n) => {
        const Icon = severityIcon(n);
        return (
          <div
            key={n.id}
            className={`p-3.5 rounded-2xl shadow-2xl border bg-white dark:bg-[#0f141f] flex gap-3 animate-in slide-in-from-bottom-2 ${
              n.severity === "critical" ? "border-red-300 dark:border-red-800" : n.severity === "warning" ? "border-amber-300 dark:border-amber-800" : "border-slate-200 dark:border-slate-800"
            }`}
          >
            <Icon className={`w-5 h-5 shrink-0 mt-0.5 ${severityColor[n.severity]}`} />
            <div className="flex-1 min-w-0">
              {n.link ? (
                <Link href={n.link} onClick={() => onOpen(n)} className="text-xs font-bold text-slate-900 dark:text-white hover:underline">
                  {n.title}
                </Link>
              ) : (
                <p className="text-xs font-bold text-slate-900 dark:text-white">{n.title}</p>
              )}
              <p className="text-[11px] text-slate-600 dark:text-slate-400 mt-0.5 line-clamp-3">{n.message}</p>
            </div>
            <button type="button" onClick={() => onDismiss(n.id)} className="p-1 h-fit rounded-lg text-slate-400 hover:bg-slate-100 dark:hover:bg-slate-800" aria-label="Fermer">
              <X className="w-3.5 h-3.5" />
            </button>
          </div>
        );
      })}
    </div>
  );
}
