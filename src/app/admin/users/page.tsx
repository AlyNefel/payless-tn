"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import Link from "next/link";
import { Users, UserPlus, Loader2, CheckCircle2, AlertTriangle, Search, X, ShieldCheck, Mail, Clock } from "lucide-react";
import {
  ActionMenu,
  QuickView,
  Field,
  Section,
  ViewToggle,
  btn,
  standardActions,
  useViewMode,
  usePermissions,
} from "@/components/admin/ui";

interface AdminUser {
  _id: string;
  name: string;
  email: string;
  phone?: string;
  role: string;
  isActive: boolean;
  lastLoginAt?: string;
  createdAt?: string;
}

interface RoleLite {
  key: string;
  name: string;
  isSystem: boolean;
  userCount?: number;
}

const inputCls =
  "w-full h-10 px-3 rounded-xl border border-slate-200 dark:border-slate-700 bg-slate-50 dark:bg-slate-900 text-xs font-semibold text-slate-900 dark:text-white outline-none focus:ring-2 focus:ring-blue-500";

type FormState = {
  id?: string;
  name: string;
  email: string;
  phone: string;
  role: string;
  password: string;
  isActive: boolean;
  /** "View & Edit": the form also shows the read-only account information. */
  info?: AdminUser;
};
const EMPTY: FormState = { name: "", email: "", phone: "", role: "staff", password: "", isActive: true };

function initials(name: string) {
  return name
    .split(/\s+/)
    .map((p) => p[0])
    .join("")
    .slice(0, 2)
    .toUpperCase();
}

export default function UsersPage() {
  const { can, me } = usePermissions();
  const [view, setView] = useViewMode("users", "table");
  const [users, setUsers] = useState<AdminUser[]>([]);
  const [roles, setRoles] = useState<RoleLite[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");
  const [search, setSearch] = useState("");
  const [roleFilter, setRoleFilter] = useState("all");
  const [viewing, setViewing] = useState<AdminUser | null>(null);
  const [form, setForm] = useState<FormState | null>(null);
  const [saving, setSaving] = useState(false);
  const [toast, setToast] = useState<{ ok: boolean; text: string } | null>(null);

  const notify = (ok: boolean, text: string) => {
    setToast({ ok, text });
    setTimeout(() => setToast(null), 3500);
  };

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const [u, r] = await Promise.all([fetch("/api/admin/users"), fetch("/api/admin/roles")]);
      if (u.status === 403) {
        setError("Votre rôle ne permet pas de voir les utilisateurs.");
        return;
      }
      const ud = await u.json();
      const rd = r.ok ? await r.json() : { roles: [] };
      setUsers(ud.users || []);
      setRoles(rd.roles || []);
      setError("");
    } catch {
      setError("Chargement impossible.");
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    // /admin/users?role=worker → dedicated "Agents d'assistance" view (filter + default role).
    const preset = new URLSearchParams(window.location.search).get("role");
    if (preset) setRoleFilter(preset);
    load();
  }, [load]);

  const roleName = (key: string) => roles.find((r) => r.key === key)?.name || key;

  const filtered = useMemo(() => {
    const q = search.trim().toLowerCase();
    return users.filter(
      (u) =>
        (roleFilter === "all" || u.role === roleFilter) &&
        (!q || `${u.name} ${u.email} ${u.phone || ""}`.toLowerCase().includes(q))
    );
  }, [users, search, roleFilter]);

  const call = async (url: string, method: string, body: unknown, okText: string) => {
    setSaving(true);
    try {
      const res = await fetch(url, {
        method,
        headers: { "Content-Type": "application/json" },
        body: body ? JSON.stringify(body) : undefined,
      });
      const data = await res.json().catch(() => ({}));
      if (!res.ok || data.success === false) throw new Error(data.error || "Échec");
      notify(true, okText);
      await load();
      return true;
    } catch (e) {
      notify(false, e instanceof Error ? e.message : "Erreur");
      return false;
    } finally {
      setSaving(false);
    }
  };

  const submit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!form) return;
    const payload: Record<string, unknown> = {
      name: form.name,
      email: form.email,
      phone: form.phone || undefined,
      role: form.role,
      ...(form.password ? { password: form.password } : {}),
    };
    const ok = form.id
      ? await call("/api/admin/users", "PATCH", { id: form.id, ...payload, isActive: form.isActive }, "Utilisateur mis à jour")
      : await call("/api/admin/users", "POST", payload, "Utilisateur créé");
    if (ok) setForm(null);
  };

  const remove = async (u: AdminUser) => {
    if (!confirm(`Supprimer définitivement le compte de ${u.name} ?`)) return;
    await call(`/api/admin/users?id=${u._id}`, "DELETE", null, "Utilisateur supprimé");
  };

  const toggleActive = (u: AdminUser) =>
    call("/api/admin/users", "PATCH", { id: u._id, isActive: !u.isActive }, u.isActive ? "Compte désactivé" : "Compte activé");

  const actionsFor = (u: AdminUser) =>
    standardActions({
      onView: () => setViewing(u),
      onEdit: () => setForm({ id: u._id, name: u.name, email: u.email, phone: u.phone || "", role: u.role, password: "", isActive: u.isActive }),
      onViewEdit: () =>
        setForm({ id: u._id, name: u.name, email: u.email, phone: u.phone || "", role: u.role, password: "", isActive: u.isActive, info: u }),
      onDelete: String(u._id) !== me?.user?.id ? () => remove(u) : undefined,
      can: { edit: can("users.edit"), delete: can("users.delete") },
      extra: can("users.edit")
        ? [
            { key: "toggle", label: u.isActive ? "Suspendre le compte" : "Activer le compte", onClick: () => toggleActive(u) },
            {
              key: "password",
              label: "Réinitialiser le mot de passe",
              onClick: () => {
                const pwd = prompt(`Nouveau mot de passe pour ${u.name} (8 caractères min.)`);
                if (pwd) call("/api/admin/users", "PATCH", { id: u._id, password: pwd }, "Mot de passe modifié");
              },
            },
          ]
        : [],
    });

  const roleBadge = (k: string) => (
    <span
      className={`inline-flex px-2 py-0.5 rounded-full text-[10px] font-bold ${
        k === "superadmin"
          ? "bg-violet-100 text-violet-800 dark:bg-violet-500/15 dark:text-violet-300"
          : "bg-slate-100 text-slate-700 dark:bg-slate-800 dark:text-slate-300"
      }`}
    >
      {roleName(k)}
    </span>
  );

  return (
    <div className="max-w-7xl mx-auto space-y-6 pb-16">
      {toast && (
        <div
          role="status"
          className={`fixed top-20 right-4 z-[90] px-4 py-3 rounded-2xl shadow-xl text-xs font-semibold flex items-center gap-2 text-white ${toast.ok ? "bg-emerald-600" : "bg-red-600"}`}
        >
          {toast.ok ? <CheckCircle2 className="w-4 h-4" /> : <AlertTriangle className="w-4 h-4" />}
          {toast.text}
        </div>
      )}

      <div className="flex flex-col sm:flex-row sm:items-end justify-between gap-4">
        <div>
          <h1 className="text-2xl font-black text-slate-900 dark:text-white flex items-center gap-2">
            <Users className="w-6 h-6 text-blue-600" /> {roleFilter === "worker" ? "Agents d'assistance" : roleFilter === "accountant" ? "Comptables" : "Utilisateurs"}
          </h1>
          <p className="text-xs text-slate-500 mt-1">
            Comptes du back-office. Les droits de chaque rôle se règlent dans{" "}
            <Link href="/admin/roles" className="text-blue-600 hover:underline font-semibold">
              Rôles & permissions
            </Link>
            .
          </p>
        </div>
        {can("users.create") && (
          <button type="button" onClick={() => setForm({ ...EMPTY, role: roleFilter !== "all" ? roleFilter : EMPTY.role })} className={`${btn.base} ${btn.primary}`}>
            <UserPlus className="w-4 h-4" /> {roleFilter === "worker" ? "Nouvel agent" : roleFilter === "accountant" ? "Nouveau comptable" : "Nouvel utilisateur"}
          </button>
        )}
      </div>

      <div className="flex flex-col sm:flex-row gap-2">
        <div className="relative flex-1">
          <Search className="w-4 h-4 absolute left-3 top-1/2 -translate-y-1/2 text-slate-400" />
          <input value={search} onChange={(e) => setSearch(e.target.value)} placeholder="Rechercher nom, email, téléphone…" className={`${inputCls} pl-9`} />
        </div>
        <select value={roleFilter} onChange={(e) => setRoleFilter(e.target.value)} className={`${inputCls} sm:w-56`}>
          <option value="all">Tous les rôles</option>
          {roles.map((r) => (
            <option key={r.key} value={r.key}>
              {r.name}
            </option>
          ))}
        </select>
        <ViewToggle value={view} onChange={setView} />
      </div>

      {error ? (
        <div className="p-6 rounded-2xl border border-slate-200 dark:border-slate-800 text-center text-sm text-slate-500">{error}</div>
      ) : loading && users.length === 0 ? (
        <div className="py-20 flex justify-center">
          <Loader2 className="w-6 h-6 animate-spin text-slate-400" />
        </div>
      ) : filtered.length === 0 ? (
        <div className="py-16 text-center text-sm text-slate-500">Aucun utilisateur.</div>
      ) : view === "grid" ? (
        <div className="grid grid-cols-1 sm:grid-cols-2 xl:grid-cols-3 gap-4">
          {filtered.map((u) => (
            <div key={u._id} className="p-4 rounded-2xl bg-white dark:bg-[#0f141f] border border-slate-200 dark:border-slate-800 flex flex-col gap-3">
              <div className="flex items-start gap-3">
                <div className="w-10 h-10 rounded-full bg-gradient-to-tr from-blue-600 to-indigo-600 text-white flex items-center justify-center text-xs font-bold shrink-0">
                  {initials(u.name)}
                </div>
                <button type="button" onClick={() => setViewing(u)} className="flex-1 min-w-0 text-left">
                  <p className="text-sm font-bold text-slate-900 dark:text-white truncate">{u.name}</p>
                  <p className="text-xs text-slate-500 truncate">{u.email}</p>
                </button>
                <ActionMenu items={actionsFor(u)} label={`Actions pour ${u.name}`} size="sm" />
              </div>
              <div className="flex flex-wrap items-center gap-1.5">
                {roleBadge(u.role)}
                <ActiveBadge on={u.isActive} />
              </div>
              <p className="text-[11px] text-slate-500">
                Dernière connexion : {u.lastLoginAt ? new Date(u.lastLoginAt).toLocaleString("fr-FR") : "jamais"}
              </p>
            </div>
          ))}
        </div>
      ) : (
        <div className="rounded-2xl bg-white dark:bg-[#0f141f] border border-slate-200 dark:border-slate-800 overflow-x-auto">
          <table className="w-full text-xs min-w-[640px]">
            <thead>
              <tr className="text-left text-[11px] uppercase tracking-wide text-slate-500 border-b border-slate-100 dark:border-slate-800">
                <th className="p-3">Utilisateur</th>
                <th className="p-3">Rôle</th>
                <th className="p-3">Statut</th>
                <th className="p-3">Dernière connexion</th>
                <th className="p-3 w-12" aria-label="Actions" />
              </tr>
            </thead>
            <tbody className="divide-y divide-slate-100 dark:divide-slate-800">
              {filtered.map((u) => (
                <tr key={u._id} className="hover:bg-slate-50 dark:hover:bg-slate-900/50">
                  <td className="p-3">
                    <button type="button" onClick={() => setViewing(u)} className="flex items-center gap-2.5 text-left">
                      <span className="w-8 h-8 rounded-full bg-gradient-to-tr from-blue-600 to-indigo-600 text-white flex items-center justify-center text-[10px] font-bold shrink-0">
                        {initials(u.name)}
                      </span>
                      <span>
                        <span className="block font-bold text-slate-900 dark:text-white">{u.name}</span>
                        <span className="block text-slate-500">{u.email}</span>
                      </span>
                    </button>
                  </td>
                  <td className="p-3">
                    {roleBadge(u.role)}
                  </td>
                  <td className="p-3">
                    <ActiveBadge on={u.isActive} />
                  </td>
                  <td className="p-3 text-slate-500">{u.lastLoginAt ? new Date(u.lastLoginAt).toLocaleString("fr-FR") : "—"}</td>
                  <td className="p-3 text-right">
                    <ActionMenu items={actionsFor(u)} label={`Actions pour ${u.name}`} size="sm" />
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}

      {/* View (read-only) — with a way to switch to editing */}
      <QuickView
        open={Boolean(viewing)}
        onClose={() => setViewing(null)}
        title={viewing?.name}
        subtitle={viewing?.email}
        badge={viewing ? <ActiveBadge on={viewing.isActive} /> : null}
        footer={
          viewing &&
          can("users.edit") && (
            <button
              type="button"
              className={`${btn.base} ${btn.primary}`}
              onClick={() => {
                const u = viewing;
                setViewing(null);
                setForm({ id: u._id, name: u.name, email: u.email, phone: u.phone || "", role: u.role, password: "", isActive: u.isActive });
              }}
            >
              Modifier
            </button>
          )
        }
      >
        {viewing && (
          <>
            <Section title="Compte">
              <Field label="Rôle">{roleName(viewing.role)}</Field>
              <Field label="Email">
                <span className="inline-flex items-center gap-1">
                  <Mail className="w-3.5 h-3.5" /> {viewing.email}
                </span>
              </Field>
              <Field label="Téléphone">{viewing.phone || "—"}</Field>
            </Section>
            <Section title="Activité">
              <Field label="Créé le">{viewing.createdAt ? new Date(viewing.createdAt).toLocaleDateString("fr-FR") : "—"}</Field>
              <Field label="Dernière connexion">
                <span className="inline-flex items-center gap-1">
                  <Clock className="w-3.5 h-3.5" />
                  {viewing.lastLoginAt ? new Date(viewing.lastLoginAt).toLocaleString("fr-FR") : "jamais"}
                </span>
              </Field>
            </Section>
            <Link href="/admin/roles" className="inline-flex items-center gap-1.5 text-blue-600 font-semibold hover:underline">
              <ShieldCheck className="w-4 h-4" /> Voir les permissions du rôle « {roleName(viewing.role)} »
            </Link>
          </>
        )}
      </QuickView>

      {/* Create / Edit */}
      {form && (
        <div className="fixed inset-0 z-[75] flex items-end sm:items-center justify-center bg-black/60 backdrop-blur-sm p-0 sm:p-4" role="dialog" aria-modal="true">
          <form
            onSubmit={submit}
            className="w-full sm:max-w-md max-h-[92vh] flex flex-col rounded-t-2xl sm:rounded-2xl bg-white dark:bg-[#0f141f] border border-slate-200 dark:border-slate-700 shadow-2xl text-xs"
          >
            <div className="flex items-center justify-between p-5 border-b border-slate-100 dark:border-slate-800">
              <h2 className="text-sm font-bold text-slate-900 dark:text-white">
                {form.info ? "Voir & modifier" : form.id ? "Modifier l'utilisateur" : "Nouvel utilisateur"}
              </h2>
              <button type="button" onClick={() => setForm(null)} aria-label="Fermer" className="p-1 rounded-lg text-slate-400 hover:bg-slate-100 dark:hover:bg-slate-800">
                <X className="w-4 h-4" />
              </button>
            </div>
            <div className="p-5 space-y-3 overflow-y-auto">
              {form.info && (
                <Section title="Informations du compte">
                  <Field label="Rôle actuel">{roleName(form.info.role)}</Field>
                  <Field label="Créé le">{form.info.createdAt ? new Date(form.info.createdAt).toLocaleDateString("fr-FR") : "—"}</Field>
                  <Field label="Dernière connexion">
                    {form.info.lastLoginAt ? new Date(form.info.lastLoginAt).toLocaleString("fr-FR") : "jamais"}
                  </Field>
                </Section>
              )}
              {(
                [
                  ["name", "Nom complet", "text"],
                  ["email", "Email", "email"],
                  ["phone", "Téléphone", "tel"],
                ] as const
              ).map(([k, label, type]) => (
                <label key={k} className="block space-y-1">
                  <span className="font-semibold text-slate-600 dark:text-slate-300">{label}</span>
                  <input
                    type={type}
                    required={k !== "phone"}
                    value={form[k]}
                    onChange={(e) => setForm({ ...form, [k]: e.target.value })}
                    className={inputCls}
                  />
                </label>
              ))}
              <label className="block space-y-1">
                <span className="font-semibold text-slate-600 dark:text-slate-300">Rôle</span>
                <select value={form.role} onChange={(e) => setForm({ ...form, role: e.target.value })} className={inputCls}>
                  {roles
                    .filter((r) => r.key !== "superadmin" || me?.user?.role === "superadmin")
                    .map((r) => (
                      <option key={r.key} value={r.key}>
                        {r.name}
                      </option>
                    ))}
                </select>
              </label>
              <label className="block space-y-1">
                <span className="font-semibold text-slate-600 dark:text-slate-300">
                  {form.id ? "Nouveau mot de passe (laisser vide pour ne pas changer)" : "Mot de passe (8 caractères min.)"}
                </span>
                <input
                  type="password"
                  minLength={8}
                  required={!form.id}
                  autoComplete="new-password"
                  value={form.password}
                  onChange={(e) => setForm({ ...form, password: e.target.value })}
                  className={inputCls}
                />
              </label>
              {form.id && (
                <label className="flex items-center gap-2 font-semibold text-slate-700 dark:text-slate-300">
                  <input type="checkbox" checked={form.isActive} onChange={(e) => setForm({ ...form, isActive: e.target.checked })} />
                  Compte actif
                </label>
              )}
            </div>
            <div className="p-4 border-t border-slate-100 dark:border-slate-800 flex justify-end gap-2">
              <button type="button" onClick={() => setForm(null)} className={`${btn.base} ${btn.secondary}`}>
                Annuler
              </button>
              <button type="submit" disabled={saving} className={`${btn.base} ${btn.primary}`}>
                {saving && <Loader2 className="w-4 h-4 animate-spin" />} Enregistrer
              </button>
            </div>
          </form>
        </div>
      )}
    </div>
  );
}

function ActiveBadge({ on }: { on: boolean }) {
  return (
    <span
      className={`inline-flex px-2 py-0.5 rounded-full text-[10px] font-bold ${
        on ? "bg-emerald-100 text-emerald-800 dark:bg-emerald-500/15 dark:text-emerald-300" : "bg-slate-200 text-slate-600 dark:bg-slate-700 dark:text-slate-300"
      }`}
    >
      {on ? "Actif" : "Désactivé"}
    </span>
  );
}
