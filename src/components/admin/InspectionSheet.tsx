"use client";

import { useEffect, useRef, useState } from "react";
import { Camera, Eraser, Loader2, Plus, Trash2 } from "lucide-react";
import { btn } from "@/components/admin/ui";
import { ErrorNote, Modal, api, inputCls, labelCls, shrinkImage, uploadDocument } from "@/components/admin/accounting/shared";

const ZONES = ["Avant", "Arrière", "Côté gauche", "Côté droit", "Toit", "Pare-brise", "Jantes / pneus", "Intérieur", "Coffre"];
const CHECKLIST: [string, string][] = [
  ["documents", "Carte grise, assurance, vignette"],
  ["spare", "Roue de secours"],
  ["jack", "Cric & clé de roue"],
  ["triangle", "Triangle & gilet"],
  ["radio", "Autoradio / écran"],
  ["mats", "Tapis"],
];
const FUEL = ["Vide", "1/8", "1/4", "3/8", "1/2", "5/8", "3/4", "7/8", "Plein"];

interface Damage {
  zone: string;
  description: string;
  photoUrl?: string;
}
export interface InspectionValue {
  mileage?: number;
  fuelLevel?: number;
  cleanliness?: string;
  damages?: Damage[];
  photos?: string[];
  checklist?: Record<string, boolean>;
  customerName?: string;
  notes?: string;
  signatureUrl?: string;
  at?: string;
  by?: string;
}

/** Finger / mouse signature. Returns a PNG blob, or null when nothing was drawn. */
function SignaturePad({ onReady }: { onReady: (get: () => Promise<Blob | null>, clear: () => void) => void }) {
  const ref = useRef<HTMLCanvasElement>(null);
  const drawn = useRef(false);
  useEffect(() => {
    const canvas = ref.current;
    if (!canvas) return;
    const ctx = canvas.getContext("2d");
    if (!ctx) return;
    const ratio = window.devicePixelRatio || 1;
    const rect = canvas.getBoundingClientRect();
    canvas.width = rect.width * ratio;
    canvas.height = rect.height * ratio;
    ctx.scale(ratio, ratio);
    ctx.lineWidth = 2.2;
    ctx.lineCap = "round";
    ctx.lineJoin = "round";
    ctx.strokeStyle = "#0b1f4b";
    let down = false;
    const pos = (e: PointerEvent) => {
      const r = canvas.getBoundingClientRect();
      return { x: e.clientX - r.left, y: e.clientY - r.top };
    };
    const start = (e: PointerEvent) => {
      down = true;
      drawn.current = true;
      const p = pos(e);
      ctx.beginPath();
      ctx.moveTo(p.x, p.y);
      canvas.setPointerCapture(e.pointerId);
    };
    const move = (e: PointerEvent) => {
      if (!down) return;
      const p = pos(e);
      ctx.lineTo(p.x, p.y);
      ctx.stroke();
    };
    const end = () => {
      down = false;
    };
    canvas.addEventListener("pointerdown", start);
    canvas.addEventListener("pointermove", move);
    canvas.addEventListener("pointerup", end);
    canvas.addEventListener("pointercancel", end);
    onReady(
      () => new Promise<Blob | null>((resolve) => (drawn.current ? canvas.toBlob(resolve, "image/png") : resolve(null))),
      () => {
        ctx.clearRect(0, 0, canvas.width, canvas.height);
        drawn.current = false;
      }
    );
    return () => {
      canvas.removeEventListener("pointerdown", start);
      canvas.removeEventListener("pointermove", move);
      canvas.removeEventListener("pointerup", end);
      canvas.removeEventListener("pointercancel", end);
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);
  return <canvas ref={ref} aria-label="Zone de signature du client" className="w-full h-36 rounded-xl border-2 border-dashed border-slate-300 dark:border-slate-600 bg-white touch-none" />;
}

type SheetProps = {
  bookingId: string;
  stage: "pickup" | "return";
  title: string;
  /** Saved report. When omitted, the saved report is loaded from the booking so editing never starts blank. */
  initial?: InspectionValue | null;
  /** Departure mileage: the return value cannot be lower. */
  minMileage?: number | null;
  defaultCustomer?: string;
  onClose: () => void;
  onSaved: () => void;
};

/**
 * Vehicle condition report at departure or at return: mileage, fuel, equipment, damages with
 * photos, and the customer's signature. Printed on the rental contract.
 */
export function InspectionSheet(props: SheetProps) {
  const { bookingId, stage, initial } = props;
  const [loaded, setLoaded] = useState<InspectionValue | null | undefined>(initial);
  const [loadError, setLoadError] = useState("");
  useEffect(() => {
    if (initial !== undefined) return;
    let alive = true;
    api<{ booking: Record<string, unknown> }>(`/api/admin/bookings/${bookingId}`)
      .then((d) => alive && setLoaded((d.booking?.[stage === "pickup" ? "pickupInspection" : "returnInspection"] as InspectionValue) || null))
      .catch((e) => alive && setLoadError(e instanceof Error ? e.message : "Chargement impossible"));
    return () => {
      alive = false;
    };
  }, [bookingId, stage, initial]);
  if (loaded === undefined) {
    return (
      <Modal open onClose={props.onClose} title={stage === "pickup" ? "État des lieux de départ" : "État des lieux de retour"}>
        {loadError ? <ErrorNote text={loadError} /> : <Loader2 className="w-5 h-5 animate-spin text-slate-400" />}
      </Modal>
    );
  }
  return <InspectionForm {...props} initial={loaded} />;
}

function InspectionForm({
  bookingId,
  stage,
  title,
  initial,
  minMileage,
  defaultCustomer,
  onClose,
  onSaved,
}: SheetProps) {
  const [mileage, setMileage] = useState(initial?.mileage !== undefined ? String(initial.mileage) : "");
  const [fuel, setFuel] = useState<number | undefined>(initial?.fuelLevel);
  const [clean, setClean] = useState(initial?.cleanliness || "clean");
  const [checklist, setChecklist] = useState<Record<string, boolean>>(initial?.checklist || Object.fromEntries(CHECKLIST.map(([k]) => [k, true])));
  const [damages, setDamages] = useState<Damage[]>(initial?.damages || []);
  const [photos, setPhotos] = useState<string[]>(initial?.photos || []);
  const [customer, setCustomer] = useState(initial?.customerName || defaultCustomer || "");
  const [notes, setNotes] = useState(initial?.notes || "");
  /** Signature already on file: kept unless the customer signs again. */
  const [savedSignature, setSavedSignature] = useState(initial?.signatureUrl || "");
  const [busy, setBusy] = useState(false);
  const [uploading, setUploading] = useState(false);
  const [error, setError] = useState("");
  const sign = useRef<{ get: () => Promise<Blob | null>; clear: () => void } | null>(null);

  const addPhotos = async (files: FileList | null, damageIndex?: number) => {
    if (!files?.length) return;
    setUploading(true);
    setError("");
    try {
      for (const f of Array.from(files).slice(0, 10)) {
        const url = await uploadDocument(await shrinkImage(f), "inspection");
        if (damageIndex !== undefined) setDamages((d) => d.map((x, i) => (i === damageIndex ? { ...x, photoUrl: url } : x)));
        else setPhotos((p) => [...p, url].slice(0, 20));
      }
    } catch (e) {
      setError(e instanceof Error ? e.message : "Photo non envoyée");
    } finally {
      setUploading(false);
    }
  };

  const save = async () => {
    const km = mileage.trim() === "" ? undefined : Number(mileage);
    if (km !== undefined && (!Number.isFinite(km) || km < 0)) return setError("Kilométrage invalide.");
    if (stage === "return" && km !== undefined && typeof minMileage === "number" && km < minMileage) {
      return setError(`Le kilométrage de retour ne peut pas être inférieur au départ (${minMileage} km).`);
    }
    if (fuel === undefined) return setError("Indiquez le niveau de carburant.");
    if (damages.some((d) => !d.description.trim())) return setError("Décrivez chaque dommage (ou supprimez la ligne).");
    setBusy(true);
    setError("");
    try {
      let signatureUrl: string | undefined = savedSignature || undefined;
      const blob = await sign.current?.get();
      if (blob) signatureUrl = await uploadDocument(new File([blob], "signature.png", { type: "image/png" }), "signature");
      await api(`/api/admin/bookings/${bookingId}`, {
        method: "PATCH",
        body: JSON.stringify({ action: "inspection", stage, mileage: km, fuelLevel: fuel, cleanliness: clean, checklist, damages, photos, signatureUrl, customerName: customer || undefined, notes: notes || undefined }),
      });
      onSaved();
    } catch (e) {
      setError(e instanceof Error ? e.message : "Enregistrement impossible");
    } finally {
      setBusy(false);
    }
  };

  return (
    <Modal
      open
      wide
      onClose={onClose}
      title={`${stage === "pickup" ? "État des lieux de départ" : "État des lieux de retour"} — ${title}`}
      footer={
        <>
          <button type="button" onClick={onClose} className={`${btn.base} ${btn.secondary}`}>Annuler</button>
          <button type="button" onClick={save} disabled={busy || uploading} className={`${btn.base} ${btn.primary}`}>
            {busy && <Loader2 className="w-4 h-4 animate-spin" />} Enregistrer l&apos;état des lieux
          </button>
        </>
      }
    >
      <ErrorNote text={error} />
      <div className="grid sm:grid-cols-2 gap-3">
        <label>
          <span className={labelCls}>Kilométrage au compteur</span>
          <input inputMode="numeric" className={inputCls} value={mileage} placeholder={typeof minMileage === "number" ? `≥ ${minMileage}` : "km"} onChange={(e) => setMileage(e.target.value.replace(/[^\d]/g, ""))} />
        </label>
        <label>
          <span className={labelCls}>Propreté</span>
          <select className={inputCls} value={clean} onChange={(e) => setClean(e.target.value)}>
            <option value="clean">Propre</option>
            <option value="acceptable">Correcte</option>
            <option value="dirty">Sale</option>
          </select>
        </label>
      </div>
      <div>
        <span className={labelCls}>Niveau de carburant *</span>
        <div className="grid grid-cols-9 gap-1" role="radiogroup" aria-label="Niveau de carburant">
          {FUEL.map((l, i) => (
            <button key={l} type="button" role="radio" aria-checked={fuel === i} onClick={() => setFuel(i)} className={`h-11 rounded-lg text-[10px] font-bold ${fuel !== undefined && i <= fuel ? "bg-emerald-600 text-white" : "bg-slate-100 dark:bg-slate-800 text-slate-500"}`}>
              {l}
            </button>
          ))}
        </div>
      </div>
      <div>
        <span className={labelCls}>Équipements présents</span>
        <div className="grid grid-cols-2 gap-1.5">
          {CHECKLIST.map(([k, l]) => (
            <label key={k} className="flex items-center gap-2 p-2 rounded-lg border border-slate-200 dark:border-slate-700 font-semibold text-slate-700 dark:text-slate-200">
              <input type="checkbox" checked={checklist[k] !== false} onChange={(e) => setChecklist({ ...checklist, [k]: e.target.checked })} /> {l}
            </label>
          ))}
        </div>
      </div>
      <div>
        <div className="flex items-center justify-between">
          <span className={labelCls}>Dommages / rayures ({damages.length})</span>
          <button type="button" onClick={() => setDamages([...damages, { zone: ZONES[0], description: "" }])} className={`${btn.base} ${btn.secondary} h-8`}>
            <Plus className="w-3.5 h-3.5" /> Ajouter
          </button>
        </div>
        {damages.length === 0 && <p className="text-slate-500">Aucun dommage constaté.</p>}
        <div className="space-y-2">
          {damages.map((d, i) => (
            <div key={i} className="p-2 rounded-xl border border-slate-200 dark:border-slate-700 grid grid-cols-[1fr_auto] gap-2">
              <div className="grid sm:grid-cols-[150px_1fr] gap-2">
                <select aria-label="Zone" className={inputCls} value={d.zone} onChange={(e) => setDamages(damages.map((x, k) => (k === i ? { ...x, zone: e.target.value } : x)))}>
                  {ZONES.map((z) => <option key={z}>{z}</option>)}
                </select>
                <input aria-label="Description" className={inputCls} value={d.description} placeholder="Ex. rayure 10 cm, pare-chocs enfoncé" onChange={(e) => setDamages(damages.map((x, k) => (k === i ? { ...x, description: e.target.value } : x)))} />
              </div>
              <div className="flex items-start gap-1">
                {d.photoUrl && (
                  <a href={d.photoUrl} target="_blank" rel="noopener noreferrer" aria-label="Voir la photo du dommage">
                    {/* eslint-disable-next-line @next/next/no-img-element */}
                    <img src={d.photoUrl} alt="" className="w-10 h-10 object-cover rounded-lg border border-slate-200 dark:border-slate-700" />
                  </a>
                )}
                <label className={`${btn.base} ${d.photoUrl ? btn.success : btn.secondary} h-10 px-2.5 cursor-pointer`} aria-label="Photo du dommage">
                  <Camera className="w-4 h-4" />
                  <input type="file" accept="image/*" capture="environment" className="hidden" onChange={(e) => addPhotos(e.target.files, i)} />
                </label>
                <button type="button" aria-label="Supprimer ce dommage" onClick={() => setDamages(damages.filter((_, k) => k !== i))} className={`${btn.base} ${btn.secondary} h-10 px-2.5 text-red-600`}>
                  <Trash2 className="w-4 h-4" />
                </button>
              </div>
            </div>
          ))}
        </div>
      </div>
      <div>
        <span className={labelCls}>Photos du véhicule ({photos.length}/20)</span>
        <div className="flex flex-wrap gap-2">
          {photos.map((url, i) => (
            <div key={url} className="relative">
              <a href={url} target="_blank" rel="noopener noreferrer">
                {/* eslint-disable-next-line @next/next/no-img-element */}
                <img src={url} alt={`Photo ${i + 1}`} className="w-20 h-20 object-cover rounded-lg border border-slate-200 dark:border-slate-700" />
              </a>
              <button type="button" aria-label={`Retirer la photo ${i + 1}`} onClick={() => setPhotos(photos.filter((p) => p !== url))} className="absolute -top-1.5 -right-1.5 p-1 rounded-full bg-red-600 text-white">
                <Trash2 className="w-3 h-3" />
              </button>
            </div>
          ))}
          <label className="w-20 h-20 rounded-lg border-2 border-dashed border-slate-300 dark:border-slate-600 flex flex-col items-center justify-center gap-1 text-slate-500 cursor-pointer">
            {uploading ? <Loader2 className="w-5 h-5 animate-spin" /> : <Camera className="w-5 h-5" />}
            <span className="text-[10px] font-bold">Ajouter</span>
            <input type="file" accept="image/*" capture="environment" multiple className="hidden" onChange={(e) => addPhotos(e.target.files)} />
          </label>
        </div>
      </div>
      <label className="block">
        <span className={labelCls}>Remarques</span>
        <textarea className={`${inputCls} h-16 py-2`} value={notes} onChange={(e) => setNotes(e.target.value)} />
      </label>
      <div>
        <div className="flex items-center justify-between gap-2">
          <span className={labelCls}>Signature du client</span>
          {!savedSignature && (
            <button type="button" onClick={() => sign.current?.clear()} className={`${btn.base} ${btn.secondary} h-8`}>
              <Eraser className="w-3.5 h-3.5" /> Effacer
            </button>
          )}
        </div>
        <input className={`${inputCls} mb-2`} value={customer} placeholder="Nom du signataire" onChange={(e) => setCustomer(e.target.value)} />
        {savedSignature ? (
          <div className="flex items-center gap-3 p-2 rounded-xl border border-emerald-200 dark:border-emerald-900/50 bg-emerald-50/60 dark:bg-emerald-950/20">
            {/* eslint-disable-next-line @next/next/no-img-element */}
            <img src={savedSignature} alt="Signature enregistrée" className="h-16 max-w-[60%] object-contain bg-white rounded-lg" />
            <div className="flex-1 text-[11px] text-emerald-800 dark:text-emerald-300 font-semibold">Signature déjà enregistrée.</div>
            <button type="button" onClick={() => setSavedSignature("")} className={`${btn.base} ${btn.secondary} h-8`}>Refaire signer</button>
          </div>
        ) : (
          <>
            <SignaturePad onReady={(get, clear) => (sign.current = { get, clear })} />
            <p className="mt-1 text-[11px] text-slate-500">Le client signe avec le doigt. La signature est imprimée sur le contrat.</p>
          </>
        )}
      </div>
    </Modal>
  );
}
