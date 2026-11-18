"use client";

import { inputCls, labelCls } from "./shared";

/** Identity of a driver as printed on the rental contract. */
export interface Identity {
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

export function IdentityFields({ value, onChange }: { value: Identity; onChange: (v: Identity) => void }) {
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
