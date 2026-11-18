"use client";

import { use, useEffect, useState } from "react";
import Link from "next/link";
import { ArrowLeft, Loader2, Lock, Printer, Save } from "lucide-react";
import { btn, usePermissions } from "@/components/admin/ui";
import { ErrorNote, api, cardCls, inputCls, labelCls, tdCls, thCls } from "@/components/admin/accounting/shared";
import { openPdf } from "@/components/admin/openPdf";

interface Billing {
  name?: string;
  address?: string;
  idNumber?: string;
  taxId?: string;
  notes?: string;
}
interface InvoicePreview {
  number: string;
  issuedAt: string;
  bookingReference: string;
  lines: { label: string; qty: string; unit: number; total: number }[];
  taxableTTC: number;
  vatRate: number;
  ht: number;
  vat: number;
  stampDuty: number;
  contribution: number;
  total: number;
  paid: number;
  payments: { date: string; method: string; amount: number; receipt: string }[];
}
interface InvoiceResponse {
  invoiceable: boolean;
  status: string;
  billing: Billing;
  invoice: InvoicePreview;
}

/** Same rounding as the PDF (amounts are stored in minor units). */
const money = (minor: number | undefined) =>
  `${(Math.round(Number(minor || 0)) / 100).toLocaleString("fr-FR", { minimumFractionDigits: 3, maximumFractionDigits: 3 })} DT`;

const FIELDS: [keyof Billing, string, string?][] = [
  ["name", "Nom / raison sociale"],
  ["idNumber", "CIN / passeport"],
  ["taxId", "Matricule fiscal (client entreprise)", "1234567/A/M/000"],
  ["address", "Adresse"],
];

/** Invoice: edit the recipient and the printed mention, check the amounts, then print. */
export default function InvoicePage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = use(params);
  const { can } = usePermissions();
  const canEdit = can("bookings.edit");
  const [data, setData] = useState<InvoiceResponse | null>(null);
  const [billing, setBilling] = useState<Billing>({});
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [dirty, setDirty] = useState(false);
  const [error, setError] = useState("");
  const [saved, setSaved] = useState("");

  const load = () =>
    api<InvoiceResponse>(`/api/admin/bookings/${id}/invoice?data=1`).then((d) => {
      setData(d);
      setBilling(d.billing || {});
    });

  useEffect(() => {
    load()
      .catch((e) => setError(e instanceof Error ? e.message : "Chargement impossible"))
      .finally(() => setLoading(false));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [id]);

  useEffect(() => {
    if (!dirty) return;
    const h = (e: BeforeUnloadEvent) => e.preventDefault();
    window.addEventListener("beforeunload", h);
    return () => window.removeEventListener("beforeunload", h);
  }, [dirty]);

  const set = (k: keyof Billing, v: string) => {
    setBilling((b) => ({ ...b, [k]: v }));
    setDirty(true);
    setSaved("");
  };

  const save = async (thenPrint: boolean) => {
    setError("");
    const tab = thenPrint ? window.open("about:blank", "_blank") : null;
    setSaving(true);
    try {
      if (canEdit && dirty) {
        await api(`/api/admin/bookings/${id}/invoice`, { method: "PUT", body: JSON.stringify(billing) });
        setDirty(false);
        setSaved("Facture enregistrée.");
      }
      if (thenPrint) {
        await openPdf(tab, `/api/admin/bookings/${id}/invoice`);
        await load(); // shows the number assigned on first issue
      }
    } catch (e) {
      tab?.close();
      setError(e instanceof Error ? e.message : "Enregistrement impossible");
    } finally {
      setSaving(false);
    }
  };

  if (loading) {
    return (
      <div className="p-10 flex justify-center">
        <Loader2 className="w-6 h-6 animate-spin text-slate-400" />
      </div>
    );
  }
  if (!data) {
    return (
      <div className="space-y-3 max-w-4xl">
        <Link href={`/admin/bookings/${id}`} className="text-xs font-semibold text-blue-600 hover:underline">← Retour à la réservation</Link>
        <ErrorNote text={error || "Facture indisponible"} />
      </div>
    );
  }

  const inv = data.invoice;
  const remaining = Math.max(0, inv.total - inv.paid);

  return (
    <div className="space-y-4 max-w-4xl">
      <div className="flex items-start gap-3">
        <Link href={`/admin/bookings/${id}`} aria-label="Retour à la réservation" className="p-2 rounded-xl border border-slate-200 dark:border-slate-700 text-slate-600 dark:text-slate-300">
          <ArrowLeft className="w-5 h-5" />
        </Link>
        <div className="min-w-0">
          <h1 className="text-xl font-black text-slate-900 dark:text-white">
            Facture {inv.number ? <span className="font-mono">{inv.number}</span> : <span className="text-sm font-semibold text-slate-500">(numérotée à la première impression)</span>}
          </h1>
          <p className="text-xs text-slate-500">
            Réservation <span className="font-mono">{inv.bookingReference}</span>
            {inv.number ? ` · émise le ${new Date(inv.issuedAt).toLocaleDateString("fr-FR")}` : ""}
          </p>
        </div>
      </div>

      <ErrorNote text={error} />
      {!data.invoiceable && <ErrorNote text="Une facture ne peut être émise que pour une réservation confirmée (pas en attente ni annulée)." />}
      {inv.number && canEdit && (
        <p className="p-2.5 rounded-xl bg-amber-50 dark:bg-amber-950/30 border border-amber-200 dark:border-amber-900/50 text-amber-800 dark:text-amber-300 text-xs font-semibold">
          Cette facture est déjà émise. Une modification est tracée dans le journal d&apos;audit ; réimprimez-la et remettez la nouvelle version au client.
        </p>
      )}

      <fieldset disabled={!canEdit} className={`${cardCls} p-4 space-y-3 text-xs`}>
        <h2 className="text-sm font-bold text-slate-900 dark:text-white">Client facturé</h2>
        <div className="grid sm:grid-cols-2 gap-2.5">
          {FIELDS.map(([k, l, ph]) => (
            <label key={k} className={k === "address" || k === "name" ? "sm:col-span-2" : ""}>
              <span className={labelCls}>{l}</span>
              <input className={inputCls} value={billing[k] || ""} placeholder={ph} maxLength={k === "address" ? 300 : 160} onChange={(e) => set(k, e.target.value)} />
            </label>
          ))}
          <label className="sm:col-span-2">
            <span className={labelCls}>Mention imprimée sur la facture</span>
            <textarea className={`${inputCls} h-20 py-2`} maxLength={800} value={billing.notes || ""} placeholder="Ex. bon de commande n°…, conditions de paiement…" onChange={(e) => set("notes", e.target.value)} />
          </label>
        </div>
      </fieldset>

      <section className={`${cardCls} overflow-hidden`}>
        <div className="flex items-center justify-between gap-2 p-4 pb-2">
          <h2 className="text-sm font-bold text-slate-900 dark:text-white">Détail</h2>
          <span className="inline-flex items-center gap-1 text-[11px] text-slate-500"><Lock className="w-3.5 h-3.5" /> Montants verrouillés</span>
        </div>
        <div className="overflow-x-auto">
          <table className="w-full">
            <thead className="bg-slate-50 dark:bg-slate-900/60">
              <tr><th className={thCls}>Désignation</th><th className={thCls}>Qté</th><th className={`${thCls} text-right`}>P.U. TTC</th><th className={`${thCls} text-right`}>Total TTC</th></tr>
            </thead>
            <tbody className="divide-y divide-slate-100 dark:divide-slate-800">
              {inv.lines.map((l, i) => (
                <tr key={i}>
                  <td className={tdCls}>{l.label}</td>
                  <td className={tdCls}>{l.qty}</td>
                  <td className={`${tdCls} text-right tabular-nums`}>{money(l.unit)}</td>
                  <td className={`${tdCls} text-right tabular-nums font-semibold`}>{money(l.total)}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
        <dl className="p-4 grid grid-cols-[1fr_auto] gap-x-6 gap-y-1 text-xs sm:max-w-sm sm:ml-auto">
          <dt className="text-slate-500">Total HT</dt><dd className="text-right tabular-nums">{money(inv.ht)}</dd>
          <dt className="text-slate-500">TVA {inv.vatRate} %</dt><dd className="text-right tabular-nums">{money(inv.vat)}</dd>
          {inv.contribution > 0 && (<><dt className="text-slate-500">Contribution fiscale</dt><dd className="text-right tabular-nums">{money(inv.contribution)}</dd></>)}
          {inv.stampDuty > 0 && (<><dt className="text-slate-500">Timbre fiscal</dt><dd className="text-right tabular-nums">{money(inv.stampDuty)}</dd></>)}
          <dt className="font-bold text-slate-900 dark:text-white">TOTAL TTC</dt><dd className="text-right tabular-nums font-black text-slate-900 dark:text-white">{money(inv.total)}</dd>
          <dt className="text-slate-500">Déjà réglé</dt><dd className="text-right tabular-nums">{money(inv.paid)}</dd>
          <dt className={remaining > 0 ? "font-bold text-red-600" : "font-bold text-emerald-600"}>{remaining > 0 ? "Reste à payer" : "Acquittée"}</dt>
          <dd className={`text-right tabular-nums font-bold ${remaining > 0 ? "text-red-600" : "text-emerald-600"}`}>{remaining > 0 ? money(remaining) : "✓"}</dd>
        </dl>
        <p className="px-4 pb-4 text-[11px] text-slate-500">
          Pour changer un montant : « Prolonger / réduire » ou options sur{" "}
          <Link href={`/admin/bookings/${id}`} className="text-blue-600 font-semibold hover:underline">la réservation</Link>, encaissements via « Encaisser ».
        </p>
      </section>

      <div className="sticky bottom-0 z-30 -mx-1 rounded-2xl border border-slate-200 dark:border-slate-800 bg-white/95 dark:bg-[#0b0f17]/95 backdrop-blur p-3 shadow-lg">
        <div className="flex flex-wrap items-center justify-end gap-2">
          {saved && <span className="mr-auto text-xs font-semibold text-emerald-600">{saved}</span>}
          {dirty && !saved && <span className="mr-auto text-xs font-semibold text-amber-600">Modifications non enregistrées</span>}
          {canEdit && (
            <button type="button" onClick={() => save(false)} disabled={saving || !dirty} className={`${btn.base} ${btn.secondary}`}>
              <Save className="w-4 h-4" /> Enregistrer
            </button>
          )}
          <button type="button" onClick={() => save(true)} disabled={saving || !data.invoiceable} className={`${btn.base} ${btn.primary}`}>
            {saving ? <Loader2 className="w-4 h-4 animate-spin" /> : <Printer className="w-4 h-4" />} {canEdit && dirty ? "Enregistrer & imprimer" : "Imprimer"}
          </button>
        </div>
      </div>
    </div>
  );
}
