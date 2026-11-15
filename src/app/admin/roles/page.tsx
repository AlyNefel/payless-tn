"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import { ShieldCheck, Plus, Loader2, CheckCircle2, AlertTriangle, X, Lock, Search, Users } from "lucide-react";
import {
  ActionMenu,
  QuickView,
  Section,
  ViewToggle,
  btn,
  standardActions,
  useViewMode,
  usePermissions,
} from "@/components/admin/ui";
import { ACTION_LABELS, ALL_PERMISSIONS, type Action, type ResourceDef } from "@/lib/permissionsShared";

interface RoleRow {
  key: string;
  name: string;
  description?: string;
  permissions: string[];
  isSystem: boolean;
  color?: string;
  userCount: number;
}

const ACTIONS: Action[] = ["view", "create", "edit", "delete", "cancel", "export", "upload"];
const inputCls =
  "w-full h-10 px-3 rounded-xl border border-slate-200 dark:border-slate-700 bg-slate-50 dark:bg-slate-900 text-xs font-semibold text-slate-900 dark:text-white outline-none focus:ring-2 focus:ring-blue-500";

interface Editor {
  mode: "create" | "edit" | "view-edit";
  key?: string;
  name: string;
  description: string;
  permissions: Set<string>;
  locked: boolean;
  userCount?: number;
}

export default function RolesPage() {
  const { can, me } = usePermissions();
  const [view, setView] = useViewMode("roles", "grid");
  const [roles, setRoles] = useState<RoleRow[]>([]);
  const [resources, setResources] = useState<ResourceDef[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");
  const [viewing, setViewing] = useState<RoleRow | null>(null);
  const [editor, setEditor] = useState<Editor | null>(null);
  const [deleting, setDeleting] = useState<RoleRow | null>(null);
  const [reassignTo, setReassignTo] = useState("staff");
  const [saving, setSaving] = useState(false);
  const [toast, setToast] = useState<{ ok: boolean; text: string } | null>(null);

  const notify = (ok: boolean, text: string) => {
    setToast({ ok, text });
    setTimeout(() => setToast(null), 3500);
  };

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const res = await fetch("/api/admin/roles");
      if (res.status === 403) {
        setError("Votre rôle ne permet pas de voir les rôles.");
        return;
      }
      const d = await res.json();
      setRoles(d.roles || []);
      setResources(d.resources || []);
      setError("");
    } catch {
      setError("Chargement impossible.");
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    load();
  }, [load]);

  const send = async (url: string, method: string, body: unknown, okText: string) => {
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

  const openEditor = (r: RoleRow, mode: Editor["mode"]) =>
    setEditor({
      mode,
      key: r.key,
      name: r.name,
      description: r.description || "",
      permissions: new Set(r.permissions),
      locked: r.key === "superadmin" || !can("roles.edit"),
      userCount: r.userCount,
    });

  const duplicate = (r: RoleRow) =>
    send("/api/admin/roles", "POST", { name: `${r.name} (copie)`, description: r.description, copyFrom: r.key }, "Rôle dupliqué");

  const actionsFor = (r: RoleRow) =>
    standardActions({
      onView: () => setViewing(r),
      onEdit: r.key !== "superadmin" ? () => openEditor(r, "edit") : undefined,
      onViewEdit: r.key !== "superadmin" ? () => openEditor(r, "view-edit") : undefined,
      onDuplicate: () => duplicate(r),
      onDelete: !r.isSystem
        ? () => {
            setReassignTo(roles.find((x) => x.key !== r.key && x.key !== "superadmin")?.key || "staff");
            setDeleting(r);
          }
        : undefined,
      can: { edit: can("roles.edit"), delete: can("roles.delete"), create: can("roles.create") },
    });

  const saveEditor = async () => {
    if (!editor) return;
    const permissions = [...editor.permissions];
    const ok =
      editor.mode === "create"
        ? await send("/api/admin/roles", "POST", { name: editor.name, description: editor.description, permissions }, "Rôle créé")
        : await send("/api/admin/roles", "PATCH", { key: editor.key, name: editor.name, description: editor.description, permissions }, "Rôle enregistré");
    if (ok) setEditor(null);
  };

  const grouped = useMemo(() => {
    const m = new Map<string, ResourceDef[]>();
    resources.forEach((r) => m.set(r.group, [...(m.get(r.group) || []), r]));
    return [...m.entries()];
  }, [resources]);

  const total = ALL_PERMISSIONS.length;

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
            <ShieldCheck className="w-6 h-6 text-blue-600" /> Rôles & permissions
          </h1>
          <p className="text-xs text-slate-500 mt-1">
            Créez des rôles sur mesure et choisissez action par action ce que chaque rôle peut faire. Le serveur applique les mêmes règles.
          </p>
        </div>
        <div className="flex items-center gap-2">
          <ViewToggle value={view} onChange={setView} />
          {can("roles.create") && (
            <button
              type="button"
              onClick={() => setEditor({ mode: "create", name: "", description: "", permissions: new Set(["dashboard.view"]), locked: false })}
              className={`${btn.base} ${btn.primary}`}
            >
              <Plus className="w-4 h-4" /> Nouveau rôle
            </button>
          )}
        </div>
      </div>

      {error ? (
        <div className="p-6 rounded-2xl border border-slate-200 dark:border-slate-800 text-center text-sm text-slate-500">{error}</div>
      ) : loading && roles.length === 0 ? (
        <div className="py-20 flex justify-center">
          <Loader2 className="w-6 h-6 animate-spin text-slate-400" />
        </div>
      ) : view === "grid" ? (
        <div className="grid grid-cols-1 sm:grid-cols-2 xl:grid-cols-3 gap-4">
          {roles.map((r) => (
            <div key={r.key} className="p-4 rounded-2xl bg-white dark:bg-[#0f141f] border border-slate-200 dark:border-slate-800 flex flex-col gap-3">
              <div className="flex items-start justify-between gap-2">
                <button type="button" onClick={() => setViewing(r)} className="min-w-0 text-left">
                  <p className="text-sm font-bold text-slate-900 dark:text-white flex items-center gap-1.5">
                    {r.name} {r.isSystem && <Lock className="w-3.5 h-3.5 text-slate-400" aria-label="Rôle système" />}
                  </p>
                  <p className="text-xs text-slate-500 line-clamp-2">{r.description || "—"}</p>
                </button>
                <ActionMenu items={actionsFor(r)} label={`Actions pour ${r.name}`} size="sm" />
              </div>
              <div>
                <div className="flex justify-between text-[11px] text-slate-500 mb-1">
                  <span>
                    {r.permissions.length} / {total} permissions
                  </span>
                  <span className="inline-flex items-center gap-1">
                    <Users className="w-3.5 h-3.5" /> {r.userCount}
                  </span>
                </div>
                <div className="h-1.5 rounded-full bg-slate-100 dark:bg-slate-800 overflow-hidden">
                  <div className="h-full bg-blue-600" style={{ width: `${Math.round((r.permissions.length / total) * 100)}%` }} />
                </div>
              </div>
            </div>
          ))}
        </div>
      ) : (
        <div className="rounded-2xl bg-white dark:bg-[#0f141f] border border-slate-200 dark:border-slate-800 overflow-x-auto">
          <table className="w-full text-xs min-w-[600px]">
            <thead>
              <tr className="text-left text-[11px] uppercase tracking-wide text-slate-500 border-b border-slate-100 dark:border-slate-800">
                <th className="p-3">Rôle</th>
                <th className="p-3">Type</th>
                <th className="p-3">Permissions</th>
                <th className="p-3">Utilisateurs</th>
                <th className="p-3 w-12" aria-label="Actions" />
              </tr>
            </thead>
            <tbody className="divide-y divide-slate-100 dark:divide-slate-800">
              {roles.map((r) => (
                <tr key={r.key} className="hover:bg-slate-50 dark:hover:bg-slate-900/50">
                  <td className="p-3">
                    <button type="button" onClick={() => setViewing(r)} className="text-left">
                      <span className="block font-bold text-slate-900 dark:text-white">{r.name}</span>
                      <span className="block text-slate-500 max-w-xs truncate">{r.description || "—"}</span>
                    </button>
                  </td>
                  <td className="p-3">{r.isSystem ? "Système" : "Personnalisé"}</td>
                  <td className="p-3">
                    {r.permissions.length} / {total}
                  </td>
                  <td className="p-3">{r.userCount}</td>
                  <td className="p-3 text-right">
                    <ActionMenu items={actionsFor(r)} label={`Actions pour ${r.name}`} size="sm" />
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}

      {/* View */}
      <QuickView
        open={Boolean(viewing)}
        onClose={() => setViewing(null)}
        title={viewing?.name}
        subtitle={viewing ? `${viewing.permissions.length} permissions · ${viewing.userCount} utilisateur(s)` : ""}
        footer={
          viewing &&
          viewing.key !== "superadmin" &&
          can("roles.edit") && (
            <button
              type="button"
              className={`${btn.base} ${btn.primary}`}
              onClick={() => {
                const r = viewing;
                setViewing(null);
                openEditor(r, "view-edit");
              }}
            >
              Voir & modifier
            </button>
          )
        }
      >
        {viewing && (
          <>
            {viewing.description && <p className="text-slate-600 dark:text-slate-300">{viewing.description}</p>}
            {grouped.map(([group, list]) => (
              <Section key={group} title={group}>
                {list.map((res) => {
                  const granted = res.actions.filter((a) => viewing.permissions.includes(`${res.key}.${a}`));
                  return (
                    <div key={res.key} className="flex items-start justify-between gap-3 py-1">
                      <span className="text-slate-600 dark:text-slate-300">{res.label}</span>
                      <span className="flex flex-wrap justify-end gap-1">
                        {granted.length === 0 ? (
                          <span className="text-slate-400">Aucun accès</span>
                        ) : (
                          granted.map((a) => (
                            <span key={a} className="px-1.5 py-0.5 rounded bg-blue-100 text-blue-800 dark:bg-blue-500/15 dark:text-blue-300 text-[10px] font-bold">
                              {ACTION_LABELS[a]}
                            </span>
                          ))
                        )}
                      </span>
                    </div>
                  );
                })}
              </Section>
            ))}
          </>
        )}
      </QuickView>

      {editor && (
        <PermissionEditor
          editor={editor}
          setEditor={setEditor}
          resources={resources}
          saving={saving}
          onSave={saveEditor}
          myPermissions={new Set(me?.permissions || [])}
          isSuperadmin={me?.user?.role === "superadmin"}
        />
      )}

      {/* Delete with reassignment */}
      {deleting && (
        <div className="fixed inset-0 z-[75] flex items-end sm:items-center justify-center bg-black/60 backdrop-blur-sm p-0 sm:p-4" role="dialog" aria-modal="true">
          <div className="w-full sm:max-w-md rounded-t-2xl sm:rounded-2xl bg-white dark:bg-[#0f141f] border border-slate-200 dark:border-slate-700 p-5 space-y-4 text-xs">
            <h2 className="text-sm font-bold text-slate-900 dark:text-white">Supprimer le rôle « {deleting.name} » ?</h2>
            {deleting.userCount > 0 ? (
              <label className="block space-y-1">
                <span className="text-slate-600 dark:text-slate-300">
                  {deleting.userCount} utilisateur(s) ont ce rôle. Ils recevront :
                </span>
                <select value={reassignTo} onChange={(e) => setReassignTo(e.target.value)} className={inputCls}>
                  {roles
                    .filter((r) => r.key !== deleting.key && (r.key !== "superadmin" || me?.user?.role === "superadmin"))
                    .map((r) => (
                      <option key={r.key} value={r.key}>
                        {r.name}
                      </option>
                    ))}
                </select>
              </label>
            ) : (
              <p className="text-slate-500">Aucun utilisateur n&apos;a ce rôle.</p>
            )}
            <div className="flex justify-end gap-2">
              <button type="button" onClick={() => setDeleting(null)} className={`${btn.base} ${btn.secondary}`}>
                Annuler
              </button>
              <button
                type="button"
                disabled={saving}
                onClick={async () => {
                  const q = new URLSearchParams({ key: deleting.key, ...(deleting.userCount > 0 ? { reassignTo } : {}) });
                  if (await send(`/api/admin/roles?${q}`, "DELETE", null, "Rôle supprimé")) setDeleting(null);
                }}
                className={`${btn.base} ${btn.danger}`}
              >
                Supprimer
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}

function PermissionEditor({
  editor,
  setEditor,
  resources,
  saving,
  onSave,
  myPermissions,
  isSuperadmin,
}: {
  editor: Editor;
  setEditor: (e: Editor | null) => void;
  resources: ResourceDef[];
  saving: boolean;
  onSave: () => void;
  myPermissions: Set<string>;
  isSuperadmin: boolean;
}) {
  const [q, setQ] = useState("");
  const perms = editor.permissions;
  // A non-superadmin can only grant what they hold themselves (the server enforces it too).
  const grantable = (p: string) => isSuperadmin || myPermissions.has(p);
  const set = (next: Set<string>) => setEditor({ ...editor, permissions: next });
  const toggle = (p: string) => {
    if (editor.locked || !grantable(p)) return;
    const n = new Set(perms);
    if (n.has(p)) n.delete(p);
    else {
      n.add(p);
      // Any action implies being able to view the resource.
      const res = p.split(".")[0];
      if (resources.find((r) => r.key === res)?.actions.includes("view")) n.add(`${res}.view`);
    }
    set(n);
  };
  const rowAll = (r: ResourceDef, on: boolean) => {
    const n = new Set(perms);
    r.actions.forEach((a) => {
      const p = `${r.key}.${a}`;
      if (!grantable(p)) return;
      if (on) n.add(p);
      else n.delete(p);
    });
    set(n);
  };
  const colAll = (a: Action, on: boolean) => {
    const n = new Set(perms);
    resources.forEach((r) => {
      if (!r.actions.includes(a)) return;
      const p = `${r.key}.${a}`;
      if (!grantable(p)) return;
      if (on) n.add(p);
      else n.delete(p);
    });
    set(n);
  };
  const visible = resources.filter((r) => !q || r.label.toLowerCase().includes(q.toLowerCase()));

  return (
    <div className="fixed inset-0 z-[75] flex items-stretch sm:items-center justify-center bg-black/60 backdrop-blur-sm sm:p-4" role="dialog" aria-modal="true">
      <div className="w-full sm:max-w-5xl sm:max-h-[92vh] flex flex-col sm:rounded-2xl bg-white dark:bg-[#0f141f] border border-slate-200 dark:border-slate-700 shadow-2xl text-xs">
        <div className="flex items-center justify-between p-5 border-b border-slate-100 dark:border-slate-800">
          <div>
            <h2 className="text-sm font-bold text-slate-900 dark:text-white">
              {editor.mode === "create" ? "Nouveau rôle" : editor.mode === "view-edit" ? `Voir & modifier — ${editor.name}` : `Modifier — ${editor.name}`}
            </h2>
            <p className="text-[11px] text-slate-500">
              {perms.size} permission(s) sélectionnée(s)
              {editor.userCount !== undefined ? ` · ${editor.userCount} utilisateur(s) concerné(s)` : ""}
            </p>
          </div>
          <button type="button" onClick={() => setEditor(null)} aria-label="Fermer" className="p-1 rounded-lg text-slate-400 hover:bg-slate-100 dark:hover:bg-slate-800">
            <X className="w-4 h-4" />
          </button>
        </div>

        <div className="p-5 space-y-4 overflow-y-auto flex-1">
          <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
            <label className="block space-y-1">
              <span className="font-semibold text-slate-600 dark:text-slate-300">Nom du rôle</span>
              <input
                className={inputCls}
                value={editor.name}
                disabled={editor.locked}
                onChange={(e) => setEditor({ ...editor, name: e.target.value })}
                placeholder="ex. Agent aéroport"
              />
            </label>
            <label className="block space-y-1">
              <span className="font-semibold text-slate-600 dark:text-slate-300">Description</span>
              <input
                className={inputCls}
                value={editor.description}
                disabled={editor.locked}
                onChange={(e) => setEditor({ ...editor, description: e.target.value })}
              />
            </label>
          </div>

          <div className="relative">
            <Search className="w-4 h-4 absolute left-3 top-1/2 -translate-y-1/2 text-slate-400" />
            <input value={q} onChange={(e) => setQ(e.target.value)} placeholder="Filtrer les sections…" className={`${inputCls} pl-9`} />
          </div>

          {/* Desktop matrix */}
          <div className="hidden md:block rounded-xl border border-slate-200 dark:border-slate-800 overflow-x-auto">
            <table className="w-full">
              <thead className="sticky top-0 bg-slate-50 dark:bg-slate-900">
                <tr className="text-[11px] text-slate-500">
                  <th className="p-2.5 text-left">Section</th>
                  {ACTIONS.map((a) => {
                    const cells = resources.filter((r) => r.actions.includes(a)).map((r) => `${r.key}.${a}`);
                    const allOn = cells.length > 0 && cells.every((p) => perms.has(p));
                    return (
                      <th key={a} className="p-2.5 text-center">
                        <button
                          type="button"
                          disabled={editor.locked}
                          onClick={() => colAll(a, !allOn)}
                          className="font-bold hover:text-blue-600 disabled:hover:text-inherit"
                          title={`Tout cocher : ${ACTION_LABELS[a]}`}
                        >
                          {ACTION_LABELS[a]}
                        </button>
                      </th>
                    );
                  })}
                  <th className="p-2.5 text-center">Tout</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-slate-100 dark:divide-slate-800">
                {visible.map((r) => {
                  const allOn = r.actions.every((a) => perms.has(`${r.key}.${a}`));
                  return (
                    <tr key={r.key}>
                      <td className="p-2.5">
                        <span className="font-semibold text-slate-900 dark:text-white">{r.label}</span>
                        <span className="block text-[10px] text-slate-400">{r.group}</span>
                      </td>
                      {ACTIONS.map((a) => {
                        const p = `${r.key}.${a}`;
                        return (
                          <td key={a} className="p-2.5 text-center">
                            {r.actions.includes(a) ? (
                              <input
                                type="checkbox"
                                aria-label={`${r.label} : ${ACTION_LABELS[a]}`}
                                className="w-4 h-4 accent-blue-600"
                                checked={perms.has(p)}
                                disabled={editor.locked || !grantable(p)}
                                onChange={() => toggle(p)}
                              />
                            ) : (
                              <span className="text-slate-300 dark:text-slate-700">—</span>
                            )}
                          </td>
                        );
                      })}
                      <td className="p-2.5 text-center">
                        <input
                          type="checkbox"
                          aria-label={`${r.label} : tout`}
                          className="w-4 h-4 accent-slate-700"
                          checked={allOn}
                          disabled={editor.locked}
                          onChange={() => rowAll(r, !allOn)}
                        />
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>

          {/* Mobile: one card per section */}
          <div className="md:hidden space-y-2">
            {visible.map((r) => (
              <div key={r.key} className="p-3 rounded-xl border border-slate-200 dark:border-slate-800">
                <div className="flex items-center justify-between mb-2">
                  <span className="font-bold text-slate-900 dark:text-white">{r.label}</span>
                  <button
                    type="button"
                    disabled={editor.locked}
                    onClick={() => rowAll(r, !r.actions.every((a) => perms.has(`${r.key}.${a}`)))}
                    className="text-[11px] font-semibold text-blue-600"
                  >
                    Tout
                  </button>
                </div>
                <div className="flex flex-wrap gap-1.5">
                  {r.actions.map((a) => {
                    const p = `${r.key}.${a}`;
                    const on = perms.has(p);
                    return (
                      <button
                        key={a}
                        type="button"
                        aria-pressed={on}
                        disabled={editor.locked || !grantable(p)}
                        onClick={() => toggle(p)}
                        className={`px-2.5 py-1.5 rounded-lg text-[11px] font-bold border disabled:opacity-40 ${
                          on ? "bg-blue-600 text-white border-blue-600" : "border-slate-200 dark:border-slate-700 text-slate-600 dark:text-slate-300"
                        }`}
                      >
                        {ACTION_LABELS[a]}
                      </button>
                    );
                  })}
                </div>
              </div>
            ))}
          </div>
        </div>

        <div className="p-4 border-t border-slate-100 dark:border-slate-800 flex justify-end gap-2">
          <button type="button" onClick={() => setEditor(null)} className={`${btn.base} ${btn.secondary}`}>
            {editor.locked ? "Fermer" : "Annuler"}
          </button>
          {!editor.locked && (
            <button type="button" disabled={saving || editor.name.trim().length < 2} onClick={onSave} className={`${btn.base} ${btn.primary}`}>
              {saving && <Loader2 className="w-4 h-4 animate-spin" />} Enregistrer
            </button>
          )}
        </div>
      </div>
    </div>
  );
}
