"use client";

import { useEffect, useState } from "react";
import { FileText, Loader2 } from "lucide-react";
import { btn } from "@/components/admin/ui";
import { ErrorNote, Modal, api, inputCls, labelCls } from "./shared";

interface Identity {
  fullName?: string;
  birthDate?: string;
  birthPlace?: string;
  nationality?: string;
  address?: string;
  phone?: string;
  idType?: "cin" | "passport";
  idNumber?: string;
  idIssuedAt?: string;
  licenceNumber?: string;
  licenceIssuedAt?: string;
  licenceIssuedIn?: string;
}

const FIELDS: [keyof Identity, string, string?][] = [
  ["fullName", "Nom & prénom"],
  ["birthDate", "Date de naissance", "JJ/MM/AAAA"],
  ["birthPlace", "Lieu de naissance"],
  ["nationality", "Nationalité"],
  ["address", "Adresse"],
  ["phone", "Téléphone"],
  ["idNumber", "N° CIN / passeport"],
  ["idIssuedAt", "Délivré(e) le", "JJ/MM/AAAA"],
  ["licenceNumber", "N° de permis"],
  ["licenceIssuedAt", "Permis délivré le", "JJ/MM/AAAA"],
  ["licenceIssuedIn", "Permis délivré à"],
];

function IdentityFields({ value, onChange }: { value: Identity; onChange: (v: Identity) => void }) {
  return (
    <div className="grid grid-cols-2 gap-2.5">
      <label className="col-span-2">
        <span className={labelCls}>Pièce d&apos;identité</span>
        <select className={inputCls} value={value.idType || "cin"} onChange={(e) => onChange({ ...value, idType: e.target.value as "cin" | "passport" })}>
          <option value="cin">Carte d&apos;identité nationale (CIN)</option>
          <option value="passport">Passeport</option>
        </select>
      </label>
      {FIELDS.map(([k, l, ph]) => (
        <label key={k} className={k === "fullName" || k === "address" ? "col-span-2" : ""}>
          <span className={labelCls}>{l}</span>
          <input className={inputCls} value={(value[k] as string) || ""} placeholder={ph} onChange={(e) => onChange({ ...value, [k]: e.target.value })} />
        </label>
      ))}
    </div>
  );
}

/** Identity of the driver(s) printed on the rental contract, then opens the contract PDF. */
export function ContractForm({ bookingId, title, onClose, onSaved }: { bookingId: string | null; title?: string; onClose: () => void; onSaved?: () => void }) {
  const [driver, setDriver] = useState<Identity>({});
  const [second, setSecond] = useState<Identity>({});
  const [withSecond, setWithSecond] = useState(false);
  const [number, setNumber] = useState("");
  const [loading, setLoading] = useState(false);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState("");

  useEffect(() => {
    if (!bookingId) return;
    setLoading(true);
    setError("");
    api<{ driver: Identity; secondDriver: Identity; number: string }>(`/api/admin/bookings/${bookingId}/contract?data=1`)
      .then((d) => {
        setDriver(d.driver || {});
        setSecond(d.secondDriver || {});
        setWithSecond(Boolean(d.secondDriver?.fullName));
        setNumber(d.number);
      })
      .catch((e) => setError(e.message))
      .finally(() => setLoading(false));
  }, [bookingId]);

  const save = async (thenOpen: boolean) => {
    if (!bookingId) return;
    setSaving(true);
    setError("");
    try {
      await api(`/api/admin/bookings/${bookingId}/contract`, { method: "PUT", body: JSON.stringify({ driver, secondDriver: withSecond ? second : undefined }) });
      onSaved?.();
      if (thenOpen) window.open(`/api/admin/bookings/${bookingId}/contract`, "_blank", "noopener");
      onClose();
    } catch (e) {
      setError(e instanceof Error ? e.message : "Enregistrement impossible");
    } finally {
      setSaving(false);
    }
  };

  return (
    <Modal
      open={Boolean(bookingId)}
      onClose={onClose}
      wide
      title={`Contrat de location${number ? ` ${number}` : ""}${title ? ` — ${title}` : ""}`}
      footer={
        <>
          <button type="button" onClick={onClose} className={`${btn.base} ${btn.secondary}`}>Annuler</button>
          <button type="button" onClick={() => save(false)} disabled={saving || loading} className={`${btn.base} ${btn.secondary}`}>Enregistrer</button>
          <button type="button" onClick={() => save(true)} disabled={saving || loading} className={`${btn.base} ${btn.primary}`}>
            {saving ? <Loader2 className="w-4 h-4 animate-spin" /> : <FileText className="w-4 h-4" />} Enregistrer & ouvrir le contrat
          </button>
        </>
      }
    >
      {loading ? (
        <Loader2 className="w-5 h-5 animate-spin text-slate-400" />
      ) : (
        <>
          <ErrorNote text={error} />
          <p className="text-slate-500">Les champs laissés vides sont imprimés en pointillés pour être complétés à la main.</p>
          <h3 className="text-xs font-bold text-slate-900 dark:text-white">Locataire (conducteur principal)</h3>
          <IdentityFields value={driver} onChange={setDriver} />
          <label className="inline-flex items-center gap-2 font-semibold text-slate-700 dark:text-slate-200">
            <input type="checkbox" checked={withSecond} onChange={(e) => setWithSecond(e.target.checked)} /> Conducteur additionnel
          </label>
          {withSecond && <IdentityFields value={second} onChange={setSecond} />}
        </>
      )}
    </Modal>
  );
}
