"use client";

import { useEffect, useRef, useState, type ComponentType } from "react";
import { createPortal } from "react-dom";
import Link from "next/link";
import { Eye, MoreVertical, Pencil, SquarePen, Trash2, Copy } from "lucide-react";

export interface ActionItem {
  key: string;
  label: string;
  icon?: ComponentType<{ className?: string }>;
  onClick?: () => void;
  href?: string;
  external?: boolean;
  danger?: boolean;
  disabled?: boolean;
  /** Draws a separator above this item. */
  separated?: boolean;
}

/**
 * The unified row action pattern: View / Edit / View & Edit first, then entity-specific actions,
 * destructive actions last. Rendered in a portal so table overflow never clips it.
 */
export function standardActions(opts: {
  onView?: () => void;
  onEdit?: () => void;
  viewEditHref?: string;
  onViewEdit?: () => void;
  onDuplicate?: () => void;
  onDelete?: () => void;
  deleteLabel?: string;
  extra?: ActionItem[];
  can?: { edit?: boolean; delete?: boolean; create?: boolean };
}): ActionItem[] {
  const can = { edit: true, delete: true, create: true, ...(opts.can || {}) };
  const items: ActionItem[] = [];
  if (opts.onView) items.push({ key: "view", label: "Voir", icon: Eye, onClick: opts.onView });
  if (opts.onEdit && can.edit) items.push({ key: "edit", label: "Modifier", icon: Pencil, onClick: opts.onEdit });
  if ((opts.viewEditHref || opts.onViewEdit) && can.edit)
    items.push({ key: "view-edit", label: "Voir & modifier", icon: SquarePen, href: opts.viewEditHref, onClick: opts.onViewEdit });
  if (opts.onDuplicate && can.create) items.push({ key: "duplicate", label: "Dupliquer", icon: Copy, onClick: opts.onDuplicate });
  (opts.extra || []).forEach((e, i) => items.push({ ...e, separated: e.separated ?? i === 0 }));
  if (opts.onDelete && can.delete)
    items.push({ key: "delete", label: opts.deleteLabel || "Supprimer", icon: Trash2, onClick: opts.onDelete, danger: true, separated: true });
  return items;
}

export function ActionMenu({ items, label = "Actions", size = "md" }: { items: ActionItem[]; label?: string; size?: "sm" | "md" }) {
  const [open, setOpen] = useState(false);
  const [pos, setPos] = useState<{ top: number; left: number; up: boolean }>({ top: 0, left: 0, up: false });
  const btnRef = useRef<HTMLButtonElement>(null);
  const menuRef = useRef<HTMLDivElement>(null);

  const place = () => {
    const r = btnRef.current?.getBoundingClientRect();
    if (!r) return;
    const width = 208;
    const estimated = items.length * 38 + 16;
    const up = r.bottom + estimated > window.innerHeight - 8 && r.top > estimated;
    setPos({
      top: up ? r.top - estimated - 4 : r.bottom + 4,
      left: Math.max(8, Math.min(r.right - width, window.innerWidth - width - 8)),
      up,
    });
  };

  useEffect(() => {
    if (!open) return;
    const close = (e: Event) => {
      if (e instanceof KeyboardEvent && e.key !== "Escape") return;
      if (e.type === "mousedown" && (menuRef.current?.contains(e.target as Node) || btnRef.current?.contains(e.target as Node))) return;
      setOpen(false);
      if (e instanceof KeyboardEvent) btnRef.current?.focus();
    };
    document.addEventListener("mousedown", close);
    document.addEventListener("keydown", close);
    window.addEventListener("scroll", close, true);
    window.addEventListener("resize", close);
    menuRef.current?.querySelector<HTMLElement>("[role=menuitem]")?.focus();
    return () => {
      document.removeEventListener("mousedown", close);
      document.removeEventListener("keydown", close);
      window.removeEventListener("scroll", close, true);
      window.removeEventListener("resize", close);
    };
  }, [open]);

  if (items.length === 0) return null;

  const itemCls = (it: ActionItem) =>
    `w-full flex items-center gap-2.5 px-3 py-2 rounded-lg text-xs font-semibold text-left transition-colors outline-none disabled:opacity-40 ${
      it.danger
        ? "text-red-600 dark:text-red-400 hover:bg-red-50 dark:hover:bg-red-950/40 focus:bg-red-50 dark:focus:bg-red-950/40"
        : "text-slate-700 dark:text-slate-200 hover:bg-slate-100 dark:hover:bg-slate-800 focus:bg-slate-100 dark:focus:bg-slate-800"
    }`;

  const onKeyNav = (e: React.KeyboardEvent) => {
    if (e.key !== "ArrowDown" && e.key !== "ArrowUp") return;
    e.preventDefault();
    const els = [...(menuRef.current?.querySelectorAll<HTMLElement>("[role=menuitem]") || [])];
    const i = els.indexOf(document.activeElement as HTMLElement);
    els[(i + (e.key === "ArrowDown" ? 1 : -1) + els.length) % els.length]?.focus();
  };

  return (
    <>
      <button
        ref={btnRef}
        type="button"
        aria-haspopup="menu"
        aria-expanded={open}
        aria-label={label}
        onClick={(e) => {
          e.stopPropagation();
          place();
          setOpen((o) => !o);
        }}
        className={`inline-flex items-center justify-center rounded-lg text-slate-500 hover:text-slate-900 dark:hover:text-white hover:bg-slate-100 dark:hover:bg-slate-800 transition-colors ${
          size === "sm" ? "w-8 h-8" : "w-9 h-9"
        }`}
      >
        <MoreVertical className="w-4 h-4" />
      </button>
      {open &&
        createPortal(
          <div
            ref={menuRef}
            role="menu"
            aria-label={label}
            onKeyDown={onKeyNav}
            style={{ top: pos.top, left: pos.left }}
            className="fixed z-[80] w-52 p-1.5 rounded-xl bg-white dark:bg-[#0f141f] border border-slate-200 dark:border-slate-700 shadow-2xl animate-in fade-in zoom-in-95 duration-100"
          >
            {items.map((it) => {
              const Icon = it.icon;
              const content = (
                <>
                  {Icon && <Icon className="w-4 h-4 shrink-0" />}
                  <span className="truncate">{it.label}</span>
                </>
              );
              return (
                <div key={it.key}>
                  {it.separated && <div className="my-1 border-t border-slate-100 dark:border-slate-800" />}
                  {it.href && !it.disabled ? (
                    it.external ? (
                      <a role="menuitem" href={it.href} target="_blank" rel="noopener noreferrer" className={itemCls(it)} onClick={() => setOpen(false)}>
                        {content}
                      </a>
                    ) : (
                      <Link role="menuitem" href={it.href} className={itemCls(it)} onClick={() => setOpen(false)}>
                        {content}
                      </Link>
                    )
                  ) : (
                    <button
                      role="menuitem"
                      type="button"
                      disabled={it.disabled}
                      className={itemCls(it)}
                      onClick={(e) => {
                        e.stopPropagation();
                        setOpen(false);
                        it.onClick?.();
                      }}
                    >
                      {content}
                    </button>
                  )}
                </div>
              );
            })}
          </div>,
          document.body
        )}
    </>
  );
}
