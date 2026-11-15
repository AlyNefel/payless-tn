"use client";

import { useEffect, useState } from "react";
import { ShieldCheck, UserPlus, Loader2, CheckCircle2, AlertTriangle, KeyRound, Save, RotateCcw } from "lucide-react";
import { ROLE_LABELS, type AccessLevel, type RolePermissions, type StaffRole } from "@/lib/permissionsShared";

interface AdminUser {
  _id: string;
  name: string;
  email: string;
  role: string;
  isActive: boolean;
  lastLoginAt?: string;
}

interface Section {
  key: string;
  label: string;
}

const inputCls =
  "w-full h-10 px-3 rounded-xl border border-slate-200 dark:border-slate-700 bg-slate-50 dark:bg-slate-900 text-xs font-semibold text-slate-900 dark:text-white outline-none focus:ring-2 focus:ring-blue-500";
const btn = "inline-flex items-center justify-center gap-1.5 px-3.5 py-2 rounded-xl text-xs font-bold transition-all disabled:opacity-50";
const STAFF_ROLES: StaffRole[] = ["admin", "manager", "staff"];
const LEVELS: { v: AccessLevel; label: string; cls: string }[] = [
  { v: "none", label: "Aucun", cls: "bg-slate-200 text-slate-600 dark:bg-slate-800 dark:text-slate-400" },
  { v: "view", label: "Lecture", cls: "bg-amber-100 text-amber-800 dark:bg-amber-500/20 dark:text-amber-300" },
  { v: "edit", label: "Modifier", cls: "bg-emerald-100 text-emerald-800 dark:bg-emerald-500/20 dark:text-emerald-300" },
];

export default function UsersAndRolesPage() {
  const [users, setUsers] = useState<AdminUser[]>([]);
  const [perms, setPerms] = useState<RolePermissions | null>(null);
  const [defaults, setDefaults] = useState<RolePermissions | null>(null);
  const [sections, setSections] = useState<Section[]>([]);
  const [loading, setLoading] = useState(true);
  const [forbidden, setForbidden] = useState(false);
  const [saving, setSaving] = useState(false);
  const [toast, setToast] = useState<{ ok: boolean; text: string } | null>(null);
  const [form, setForm] = useState({ name: "", email: "", password: "", role: "staff" });

  const notify = (ok: boolean, text: string) => {
    setToast({ ok, text });
    setTimeout(() => setToast(null), 3500);
  };

  const load = async () => {
    setLoading(true);
    try {
      const [u, r] = await Promise.all([fetch("/api/admin/users"), fetch("/api/admin/roles")]);
      if (u.status === 403 || r.status === 403) {
        setForbidden(true);
        return;
      }
      const ud = await u.json();
      const rd = await r.json();
      setUsers(ud.users || []);
      setPerms(rd.permissions);
      setDefaults(rd.defaults);
      setSections((rd.sections || []).filter((s: Section) => s.key !== "users"));
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    load();
  }, []);

  const call = async (url: string, method: string, body: unknown, okText: string) => {
    setSaving(true);
    try {
      const res = await fetch(url, { method, headers: { "Content-Type": "application/json" }, body: JSON.stringify(body) });
      const data = await res.json().catch(() => ({}));
      if (!res.ok || data.success === false) throw new Error(data.error || "Échec");
      notify(true, okText);
      return true;
    } catch (e) {
      notify(false, e instanceof Error ? e.message : "Erreur");
      return false;
    } finally {
      setSaving(false);
    }
  };

  if (forbidden) {
    return (
      <div className="max-w-xl mx-auto mt-16 p-8 rounded-2xl bg-white dark:bg-[#0f141f] border border-slate-200 dark:border-slate-800 text-center space-y-2">
        <ShieldCheck className="w-10 h-10 mx-auto text-slate-400" />
        <h1 className="text-lg font-bold">Accès réservé au super admin</h1>
        <p className="text-xs text-slate-500">Seul le super administrateur peut gérer les utilisateurs et les droits d&apos;accès.</p>
      </div>
    );
  }

  return (
    <div className="max-w-6xl mx-auto space-y-6 pb-16">
      {toast && (
        <div className={`fixed top-20 right-4 z-[60] px-4 py-3 rounded-2xl shadow-xl text-xs font-semibold flex items-center gap-2 text-white ${toast.ok ? "bg-emerald-600" : "bg-red-600"}`}>
          {toast.ok ? <CheckCircle2 className="w-4 h-4" /> : <AlertTriangle className="w-4 h-4" />}
          {toast.text}
        </div>
      )}

      <div>
        <h1 className="text-2xl font-black text-slate-900 dark:text-white flex items-center gap-2">
          <ShieldCheck className="w-6 h-6 text-blue-600" /> Utilisateurs & rôles
        </h1>
        <p className="text-xs text-slate-500 mt-1">
          Le super admin définit quelles sections chaque rôle peut voir ou modifier. Les rôles à accès limité ne voient que leurs sections.
        </p>
      </div>

      {loading ? (
        <div className="py-20 flex justify-center">
          <Loader2 className="w-6 h-6 animate-spin text-slate-400" />
        </div>
      ) : (
        <>
          {/* Permission matrix */}
          {perms && (
            <div className="rounded-2xl bg-white dark:bg-[#0f141f] border border-slate-200 dark:border-slate-800 overflow-hidden">
              <div className="p-4 flex flex-wrap items-center justify-between gap-2 border-b border-slate-100 dark:border-slate-800">
                <h2 className="text-sm font-bold">Droits d&apos;accès par rôle</h2>
                <div className="flex gap-2">
                  <button type="button" disabled={saving || !defaults} onClick={() => defaults && setPerms(defaults)} className={`${btn} border border-slate-200 dark:border-slate-700`}>
                    <RotateCcw className="w-4 h-4" /> Par défaut
                  </button>
                  <button
                    type="button"
                    disabled={saving}
                    onClick={async () => {
                      if (await call("/api/admin/roles", "PUT", { permissions: perms }, "Droits enregistrés")) load();
                    }}
                    className={`${btn} bg-blue-600 hover:bg-blue-500 text-white`}
                  >
                    <Save className="w-4 h-4" /> Enregistrer
                  </button>
                </div>
              </div>
              <div className="overflow-x-auto">
                <table className="w-full text-xs min-w-[560px]">
                  <thead>
                    <tr className="text-left text-slate-500">
                      <th className="p-3">Section</th>
                      <th className="p-3">Super admin</th>
                      {STAFF_ROLES.map((r) => (
                        <th key={r} className="p-3">{ROLE_LABELS[r]}</th>
                      ))}
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-slate-100 dark:divide-slate-800">
                    {sections.map((s) => (
                      <tr key={s.key}>
                        <td className="p-3 font-semibold">{s.label}</td>
                        <td className="p-3">
                          <span className="px-2 py-1 rounded-lg bg-emerald-100 text-emerald-800 dark:bg-emerald-500/20 dark:text-emerald-300 font-bold">Modifier</span>
                        </td>
                        {STAFF_ROLES.map((r) => {
                          const cur = perms[r][s.key as keyof RolePermissions[StaffRole]];
                          return (
                            <td key={r} className="p-3">
                              <div className="inline-flex rounded-lg overflow-hidden border border-slate-200 dark:border-slate-700">
                                {LEVELS.map((l) => (
                                  <button
                                    key={l.v}
                                    type="button"
                                    onClick={() => setPerms({ ...perms, [r]: { ...perms[r], [s.key]: l.v } })}
                                    className={`px-2 py-1 font-bold ${cur === l.v ? l.cls : "text-slate-400 hover:bg-slate-50 dark:hover:bg-slate-800"}`}
                                  >
                                    {l.label}
                                  </button>
                                ))}
                              </div>
                            </td>
                          );
                        })}
                      </tr>
                    ))}
                    <tr>
                      <td className="p-3 font-semibold">Utilisateurs & rôles</td>
                      <td className="p-3">
                        <span className="px-2 py-1 rounded-lg bg-emerald-100 text-emerald-800 dark:bg-emerald-500/20 dark:text-emerald-300 font-bold">Modifier</span>
                      </td>
                      <td className="p-3 text-slate-400" colSpan={3}>
                        Réservé au super admin
                      </td>
                    </tr>
                  </tbody>
                </table>
              </div>
            </div>
          )}

          {/* Users */}
          <div className="rounded-2xl bg-white dark:bg-[#0f141f] border border-slate-200 dark:border-slate-800">
            <div className="p-4 border-b border-slate-100 dark:border-slate-800">
              <h2 className="text-sm font-bold">Comptes du back-office</h2>
            </div>
            <div className="divide-y divide-slate-100 dark:divide-slate-800">
              {users.map((u) => (
                <div key={u._id} className="p-4 flex flex-col sm:flex-row sm:items-center gap-3 text-xs">
                  <div className="flex-1 min-w-0">
                    <p className="font-bold text-slate-900 dark:text-white">{u.name}</p>
                    <p className="text-slate-500 truncate">
                      {u.email}
                      {u.lastLoginAt ? ` · dernière connexion ${new Date(u.lastLoginAt).toLocaleString("fr-FR")}` : ""}
                    </p>
                  </div>
                  <select
                    value={u.role}
                    disabled={saving}
                    onChange={async (e) => {
                      if (await call("/api/admin/users", "PATCH", { id: u._id, role: e.target.value }, "Rôle mis à jour")) load();
                    }}
                    className={`${inputCls} sm:w-48`}
                  >
                    {Object.entries(ROLE_LABELS).map(([k, v]) => (
                      <option key={k} value={k}>
                        {v}
                      </option>
                    ))}
                  </select>
                  <button
                    type="button"
                    disabled={saving}
                    onClick={async () => {
                      if (await call("/api/admin/users", "PATCH", { id: u._id, isActive: !u.isActive }, u.isActive ? "Compte désactivé" : "Compte activé")) load();
                    }}
                    className={`${btn} ${u.isActive ? "bg-emerald-100 text-emerald-800 dark:bg-emerald-500/20 dark:text-emerald-300" : "bg-slate-200 text-slate-600 dark:bg-slate-800"}`}
                  >
                    {u.isActive ? "Actif" : "Désactivé"}
                  </button>
                  <button
                    type="button"
                    disabled={saving}
                    onClick={async () => {
                      const pwd = prompt(`Nouveau mot de passe pour ${u.email} (8 caractères min.)`);
                      if (pwd) await call("/api/admin/users", "PATCH", { id: u._id, password: pwd }, "Mot de passe modifié");
                    }}
                    className={`${btn} border border-slate-200 dark:border-slate-700`}
                    title="Réinitialiser le mot de passe"
                  >
                    <KeyRound className="w-4 h-4" />
                  </button>
                </div>
              ))}
            </div>

            <form
              className="p-4 border-t border-slate-100 dark:border-slate-800 grid grid-cols-1 sm:grid-cols-5 gap-2"
              onSubmit={async (e) => {
                e.preventDefault();
                if (await call("/api/admin/users", "POST", form, "Utilisateur créé")) {
                  setForm({ name: "", email: "", password: "", role: "staff" });
                  load();
                }
              }}
            >
              <input className={inputCls} placeholder="Nom" value={form.name} onChange={(e) => setForm({ ...form, name: e.target.value })} required />
              <input className={inputCls} type="email" placeholder="Email" value={form.email} onChange={(e) => setForm({ ...form, email: e.target.value })} required />
              <input className={inputCls} type="password" placeholder="Mot de passe (8+)" minLength={8} value={form.password} onChange={(e) => setForm({ ...form, password: e.target.value })} required />
              <select className={inputCls} value={form.role} onChange={(e) => setForm({ ...form, role: e.target.value })}>
                {Object.entries(ROLE_LABELS).map(([k, v]) => (
                  <option key={k} value={k}>
                    {v}
                  </option>
                ))}
              </select>
              <button type="submit" disabled={saving} className={`${btn} bg-blue-600 hover:bg-blue-500 text-white`}>
                <UserPlus className="w-4 h-4" /> Ajouter
              </button>
            </form>
          </div>
        </>
      )}
    </div>
  );
}
