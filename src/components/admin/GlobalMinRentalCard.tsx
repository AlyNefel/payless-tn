"use client";

import { useEffect, useState } from "react";
import { CalendarRange, Loader2, Save, CheckCircle2 } from "lucide-react";

/** Fleet-wide minimum rental period. Vehicles keep their own minimum when it is higher. */
export function GlobalMinRentalCard() {
  const [value, setValue] = useState<string>("");
  const [saved, setSaved] = useState<number | null>(null);
  const [saving, setSaving] = useState(false);
  const [msg, setMsg] = useState<{ ok: boolean; text: string } | null>(null);

  useEffect(() => {
    fetch("/api/admin/rental-rules")
      .then((r) => r.json())
      .then((d) => {
        if (d.success) {
          setValue(String(d.minRentalDaysGlobal));
          setSaved(d.minRentalDaysGlobal);
        }
      })
      .catch(() => {});
  }, []);

  const save = async () => {
    setSaving(true);
    setMsg(null);
    try {
      const res = await fetch("/api/admin/rental-rules", {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ minRentalDaysGlobal: Number(value) }),
      });
      const d = await res.json().catch(() => ({}));
      if (!res.ok || !d.success) throw new Error(d.error || "Échec");
      setSaved(d.minRentalDaysGlobal);
      setMsg({ ok: true, text: "Enregistré — appliqué immédiatement au site" });
    } catch (e) {
      setMsg({ ok: false, text: e instanceof Error ? e.message : "Erreur" });
    } finally {
      setSaving(false);
    }
  };

  return (
    <div className="p-5 rounded-2xl bg-white dark:bg-[#0f141f] border border-slate-200 dark:border-slate-800 flex flex-col md:flex-row md:items-center gap-4">
      <div className="flex items-start gap-3 flex-1">
        <span className="p-2.5 rounded-xl bg-blue-50 dark:bg-blue-500/10 text-blue-600">
          <CalendarRange className="w-5 h-5" />
        </span>
        <div>
          <h2 className="text-sm font-bold text-slate-900 dark:text-white">Durée minimale de location (tous les véhicules)</h2>
          <p className="text-xs text-slate-500 mt-0.5">
            S&apos;applique à toute la flotte. Si un véhicule a son propre minimum plus élevé, c&apos;est le sien qui s&apos;applique.
            {saved !== null && ` Actuellement : ${saved} jour${saved > 1 ? "s" : ""}.`}
          </p>
          {msg && <p className={`text-xs font-semibold mt-1 ${msg.ok ? "text-emerald-600" : "text-red-600"}`}>{msg.ok && <CheckCircle2 className="inline w-3.5 h-3.5 mr-1" />}{msg.text}</p>}
        </div>
      </div>
      <div className="flex items-center gap-2">
        <input
          type="number"
          min={1}
          max={365}
          value={value}
          onChange={(e) => setValue(e.target.value)}
          className="w-24 h-10 px-3 rounded-xl border border-slate-200 dark:border-slate-700 bg-slate-50 dark:bg-slate-900 text-sm font-bold text-slate-900 dark:text-white"
        />
        <span className="text-xs text-slate-500">jour(s)</span>
        <button
          type="button"
          onClick={save}
          disabled={saving || !value || Number(value) === saved}
          className="inline-flex items-center gap-1.5 px-4 h-10 rounded-xl bg-blue-600 hover:bg-blue-500 text-white text-xs font-bold disabled:opacity-50"
        >
          {saving ? <Loader2 className="w-4 h-4 animate-spin" /> : <Save className="w-4 h-4" />} Enregistrer
        </button>
      </div>
    </div>
  );
}
