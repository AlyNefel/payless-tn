"use client";

import { useState } from "react";
import { ClipboardCheck, Pencil } from "lucide-react";
import { btn } from "@/components/admin/ui";
import { InspectionSheet, type InspectionValue } from "@/components/admin/InspectionSheet";
import { cardCls } from "@/components/admin/accounting/shared";

const FUEL = ["Vide", "1/8", "1/4", "3/8", "1/2", "5/8", "3/4", "7/8", "Plein"];
const CLEAN: Record<string, string> = { clean: "Propre", acceptable: "Correcte", dirty: "Sale" };

function Stage({ label, value, onEdit }: { label: string; value?: InspectionValue | null; onEdit?: () => void }) {
  const done = Boolean(value?.at);
  return (
    <div className="p-3 rounded-xl border border-slate-200 dark:border-slate-800 space-y-2 min-w-0">
      <div className="flex items-center justify-between gap-2">
        <h3 className="text-xs font-bold text-slate-900 dark:text-white">
          {label} {done ? <span className="text-emerald-600">✓</span> : <span className="text-slate-400 font-semibold">— non fait</span>}
        </h3>
        {onEdit && (
          <button type="button" onClick={onEdit} className={`${btn.base} ${btn.secondary} h-8`}>
            <Pencil className="w-3.5 h-3.5" /> {done ? "Modifier" : "Faire"}
          </button>
        )}
      </div>
      {done && value && (
        <>
          <p className="text-[11px] text-slate-500">
            {new Date(value.at as string).toLocaleString("fr-FR", { dateStyle: "short", timeStyle: "short" })}
            {value.by ? ` · ${value.by}` : ""}
          </p>
          <div className="grid grid-cols-3 gap-2 text-xs">
            <div><span className="block text-[10px] uppercase text-slate-500 font-bold">Km</span>{typeof value.mileage === "number" ? value.mileage.toLocaleString("fr-FR") : "—"}</div>
            <div><span className="block text-[10px] uppercase text-slate-500 font-bold">Carburant</span>{typeof value.fuelLevel === "number" ? FUEL[value.fuelLevel] : "—"}</div>
            <div><span className="block text-[10px] uppercase text-slate-500 font-bold">Propreté</span>{CLEAN[value.cleanliness || ""] || "—"}</div>
          </div>
          <div className="text-xs">
            <span className="block text-[10px] uppercase text-slate-500 font-bold">Dommages ({value.damages?.length || 0})</span>
            {value.damages?.length ? (
              <ul className="space-y-1 mt-1">
                {value.damages.map((d, i) => (
                  <li key={i} className="flex items-center gap-2">
                    {d.photoUrl && (
                      <a href={d.photoUrl} target="_blank" rel="noopener noreferrer">
                        {/* eslint-disable-next-line @next/next/no-img-element */}
                        <img src={d.photoUrl} alt="" className="w-9 h-9 object-cover rounded-md border border-slate-200 dark:border-slate-700" />
                      </a>
                    )}
                    <span><b>{d.zone}</b> : {d.description}</span>
                  </li>
                ))}
              </ul>
            ) : (
              <span className="text-slate-500">Aucun dommage constaté</span>
            )}
          </div>
          {value.photos?.length ? (
            <div>
              <span className="block text-[10px] uppercase text-slate-500 font-bold mb-1">Photos ({value.photos.length})</span>
              <div className="flex flex-wrap gap-1.5">
                {value.photos.map((url, i) => (
                  <a key={url} href={url} target="_blank" rel="noopener noreferrer">
                    {/* eslint-disable-next-line @next/next/no-img-element */}
                    <img src={url} alt={`Photo ${i + 1}`} loading="lazy" className="w-16 h-16 object-cover rounded-lg border border-slate-200 dark:border-slate-700" />
                  </a>
                ))}
              </div>
            </div>
          ) : (
            <p className="text-[11px] text-slate-500">Aucune photo.</p>
          )}
          {value.notes && <p className="text-xs text-slate-600 dark:text-slate-300 whitespace-pre-line">{value.notes}</p>}
          {value.signatureUrl && (
            <div>
              <span className="block text-[10px] uppercase text-slate-500 font-bold mb-1">Signature{value.customerName ? ` — ${value.customerName}` : ""}</span>
              {/* eslint-disable-next-line @next/next/no-img-element */}
              <img src={value.signatureUrl} alt="Signature du client" className="h-14 bg-white rounded-lg border border-slate-200 dark:border-slate-700 p-1" />
            </div>
          )}
        </>
      )}
    </div>
  );
}

/** Both condition reports of a booking (departure / return) with their photos, editable in place. */
export function InspectionSummary({
  bookingId,
  title,
  pickup,
  back,
  pickupMileage,
  customerName,
  canEdit,
  onChanged,
}: {
  bookingId: string;
  title: string;
  pickup?: InspectionValue | null;
  back?: InspectionValue | null;
  pickupMileage?: number | null;
  customerName?: string;
  canEdit?: boolean;
  onChanged: () => void;
}) {
  const [editing, setEditing] = useState<"pickup" | "return" | null>(null);
  return (
    <section className={`${cardCls} p-4 space-y-3`}>
      <h2 className="flex items-center gap-2 text-sm font-bold text-slate-900 dark:text-white">
        <ClipboardCheck className="w-4 h-4 text-blue-600" /> États des lieux
      </h2>
      <div className="grid sm:grid-cols-2 gap-3">
        <Stage label="Départ" value={pickup} onEdit={canEdit ? () => setEditing("pickup") : undefined} />
        <Stage label="Retour" value={back} onEdit={canEdit ? () => setEditing("return") : undefined} />
      </div>
      {editing && (
        <InspectionSheet
          bookingId={bookingId}
          stage={editing}
          title={title}
          initial={(editing === "pickup" ? pickup : back) || null}
          minMileage={editing === "return" ? pickup?.mileage ?? pickupMileage ?? null : null}
          defaultCustomer={customerName}
          onClose={() => setEditing(null)}
          onSaved={() => {
            setEditing(null);
            onChanged();
          }}
        />
      )}
    </section>
  );
}
