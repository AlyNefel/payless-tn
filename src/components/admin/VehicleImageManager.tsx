"use client";

import { useEffect, useRef, useState } from "react";
import {
  ArrowLeft, ArrowRight, CloudUpload, GripVertical, ImagePlus, Link2, Loader2, RefreshCw, Star, Trash2, AlertTriangle,
} from "lucide-react";
import { cloudinaryUrl, isCloudinaryUrl } from "@/lib/cloudinaryUrl";

export interface ManagedImage {
  /** Stable client key (React list key / drag & drop). */
  key: string;
  url: string;
  publicId: string;
  alt?: string;
  /** Object URL shown while the file is uploading (preview before saving). */
  localPreview?: string;
  uploading?: boolean;
  error?: string;
}

interface Props {
  images: ManagedImage[];
  onChange: (next: ManagedImage[] | ((prev: ManagedImage[]) => ManagedImage[])) => void;
  /** Called with every Cloudinary publicId uploaded in this session (for orphan cleanup on cancel/save). */
  onUploaded: (publicId: string) => void;
  vehicleLabel: string;
  maxImages?: number;
}

const ACCEPT = ["image/jpeg", "image/png", "image/webp", "image/avif"];
const MAX_BYTES = 8 * 1024 * 1024;
let keySeq = 0;
export const newImageKey = () => `img-${Date.now().toString(36)}-${(keySeq++).toString(36)}`;

async function uploadFile(file: File): Promise<{ url: string; publicId: string }> {
  const fd = new FormData();
  fd.append("file", file);
  fd.append("folder", "fleet");
  const res = await fetch("/api/upload", { method: "POST", body: fd });
  const json = await res.json().catch(() => ({}));
  if (!res.ok || !json.url) throw new Error(json.error || "Téléversement échoué");
  return { url: json.url, publicId: json.publicId || json.public_id };
}

async function importRemote(url: string): Promise<{ url: string; publicId: string }> {
  const res = await fetch("/api/upload", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ url, folder: "fleet" }),
  });
  const json = await res.json().catch(() => ({}));
  if (!res.ok || !json.url) throw new Error(json.error || "Import impossible");
  return { url: json.url, publicId: json.publicId };
}

function validate(file: File): string | null {
  if (!ACCEPT.includes(file.type)) return "Format non supporté (JPG, PNG, WebP, AVIF).";
  if (file.size > MAX_BYTES) return "Image trop volumineuse (8 Mo max).";
  return null;
}

/**
 * Admin gallery editor for a vehicle. Changes are local until the vehicle form is saved:
 * the server then persists the order (first image = primary) and deletes Cloudinary assets
 * that were removed from the gallery.
 */
export function VehicleImageManager({ images, onChange, onUploaded, vehicleLabel, maxImages = 12 }: Props) {
  const [dragKey, setDragKey] = useState<string | null>(null);
  const [urlInput, setUrlInput] = useState("");
  const [busyKey, setBusyKey] = useState<string | null>(null);
  const fileInput = useRef<HTMLInputElement>(null);

  // Release object URLs when the component unmounts.
  const previewsRef = useRef<string[]>([]);
  useEffect(() => () => previewsRef.current.forEach((u) => URL.revokeObjectURL(u)), []);

  const patch = (key: string, data: Partial<ManagedImage>) =>
    onChange((prev) => prev.map((img) => (img.key === key ? { ...img, ...data } : img)));

  const startUpload = async (key: string, file: File) => {
    const err = validate(file);
    if (err) {
      patch(key, { error: err, uploading: false });
      return;
    }
    try {
      const uploaded = await uploadFile(file);
      onUploaded(uploaded.publicId);
      patch(key, { url: uploaded.url, publicId: uploaded.publicId, uploading: false, error: undefined });
    } catch (e) {
      patch(key, { uploading: false, error: e instanceof Error ? e.message : "Échec" });
    }
  };

  const addFiles = (files: FileList | null) => {
    if (!files?.length) return;
    const room = Math.max(0, maxImages - images.length);
    const selected = Array.from(files).slice(0, room);
    const items: ManagedImage[] = selected.map((file) => {
      const preview = URL.createObjectURL(file);
      previewsRef.current.push(preview);
      return { key: newImageKey(), url: "", publicId: "", alt: vehicleLabel, localPreview: preview, uploading: true };
    });
    onChange((prev) => [...prev, ...items]);
    selected.forEach((file, i) => startUpload(items[i].key, file));
  };

  const replace = (key: string, file: File) => {
    const preview = URL.createObjectURL(file);
    previewsRef.current.push(preview);
    // The previous asset is deleted server-side on save (it is no longer referenced).
    patch(key, { localPreview: preview, uploading: true, error: undefined });
    startUpload(key, file);
  };

  const move = (key: string, delta: number) =>
    onChange((prev) => {
      const i = prev.findIndex((x) => x.key === key);
      const j = i + delta;
      if (i < 0 || j < 0 || j >= prev.length) return prev;
      const next = [...prev];
      [next[i], next[j]] = [next[j], next[i]];
      return next;
    });

  const makePrimary = (key: string) =>
    onChange((prev) => {
      const item = prev.find((x) => x.key === key);
      return item ? [item, ...prev.filter((x) => x.key !== key)] : prev;
    });

  const remove = (key: string) => onChange((prev) => prev.filter((x) => x.key !== key));

  const onDrop = (targetKey: string) => {
    if (!dragKey || dragKey === targetKey) return;
    onChange((prev) => {
      const from = prev.findIndex((x) => x.key === dragKey);
      const to = prev.findIndex((x) => x.key === targetKey);
      if (from < 0 || to < 0) return prev;
      const next = [...prev];
      const [moved] = next.splice(from, 1);
      next.splice(to, 0, moved);
      return next;
    });
    setDragKey(null);
  };

  const addByUrl = () => {
    try {
      const u = new URL(urlInput.trim());
      if (u.protocol !== "https:") throw new Error();
      onChange((prev) => [...prev, { key: newImageKey(), url: u.toString(), publicId: "", alt: vehicleLabel }]);
      setUrlInput("");
    } catch {
      alert("URL invalide (https:// requis).");
    }
  };

  const importToCloudinary = async (img: ManagedImage) => {
    setBusyKey(img.key);
    try {
      const imported = await importRemote(img.url);
      onUploaded(imported.publicId);
      patch(img.key, { url: imported.url, publicId: imported.publicId });
    } catch (e) {
      alert(e instanceof Error ? e.message : "Import impossible");
    } finally {
      setBusyKey(null);
    }
  };

  const anyUploading = images.some((i) => i.uploading);

  return (
    <div className="space-y-3">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <p className="text-[11px] font-bold uppercase tracking-wider text-slate-500 dark:text-slate-400">
          Galerie ({images.length}/{maxImages}) — la 1ʳᵉ image est l&apos;image principale
        </p>
        <button
          type="button"
          onClick={() => fileInput.current?.click()}
          disabled={images.length >= maxImages}
          className="inline-flex items-center gap-1.5 px-3 py-2 rounded-lg bg-blue-600 hover:bg-blue-500 text-white text-xs font-semibold disabled:opacity-50"
        >
          <ImagePlus className="w-3.5 h-3.5" /> Ajouter des photos
        </button>
        <input
          ref={fileInput}
          type="file"
          accept={ACCEPT.join(",")}
          multiple
          className="sr-only"
          onChange={(e) => {
            addFiles(e.target.files);
            e.target.value = "";
          }}
        />
      </div>

      {images.length === 0 ? (
        <button
          type="button"
          onClick={() => fileInput.current?.click()}
          onDragOver={(e) => e.preventDefault()}
          onDrop={(e) => {
            e.preventDefault();
            addFiles(e.dataTransfer.files);
          }}
          className="w-full flex flex-col items-center justify-center gap-2 py-10 rounded-xl border-2 border-dashed border-slate-300 dark:border-slate-600 text-slate-500 hover:border-blue-500 hover:text-blue-500 transition-colors"
        >
          <CloudUpload className="w-7 h-7" />
          <span className="text-xs font-semibold">Glissez des photos ici ou cliquez pour choisir</span>
          <span className="text-[10px]">JPG, PNG, WebP, AVIF — 8 Mo max par image</span>
        </button>
      ) : (
        <ul
          className="grid grid-cols-2 sm:grid-cols-3 gap-3"
          onDragOver={(e) => e.preventDefault()}
          onDrop={(e) => {
            // Files dropped from the desktop onto the grid.
            if (e.dataTransfer.files?.length) {
              e.preventDefault();
              addFiles(e.dataTransfer.files);
            }
          }}
        >
          {images.map((img, index) => {
            const src = img.localPreview || (isCloudinaryUrl(img.url) ? cloudinaryUrl(img.url, { width: 400, height: 260, crop: "fill", gravity: "auto" }) : img.url);
            const external = !img.publicId && !img.uploading && Boolean(img.url);
            return (
              <li
                key={img.key}
                draggable={!img.uploading}
                onDragStart={() => setDragKey(img.key)}
                onDragEnd={() => setDragKey(null)}
                onDragOver={(e) => e.preventDefault()}
                onDrop={(e) => {
                  e.stopPropagation();
                  onDrop(img.key);
                }}
                className={`group relative rounded-xl overflow-hidden border bg-slate-100 dark:bg-slate-900 ${
                  index === 0 ? "border-blue-500 ring-2 ring-blue-500/30" : "border-slate-200 dark:border-slate-700"
                } ${dragKey === img.key ? "opacity-40" : ""}`}
              >
                <div className="aspect-[4/3] relative">
                  {src ? (
                    // eslint-disable-next-line @next/next/no-img-element -- admin preview (blob: URLs not supported by next/image)
                    <img src={src} alt={img.alt || vehicleLabel} className="w-full h-full object-cover" />
                  ) : null}
                  {img.uploading && (
                    <div className="absolute inset-0 bg-black/50 flex items-center justify-center text-white text-[11px] gap-1.5">
                      <Loader2 className="w-4 h-4 animate-spin" /> Envoi…
                    </div>
                  )}
                  {img.error && (
                    <div className="absolute inset-0 bg-red-900/70 flex flex-col items-center justify-center text-white text-[11px] p-2 text-center gap-1">
                      <AlertTriangle className="w-4 h-4" /> {img.error}
                    </div>
                  )}
                  <span className="absolute top-1.5 left-1.5 px-1.5 py-0.5 rounded bg-black/60 text-white text-[10px] font-bold flex items-center gap-1">
                    <GripVertical className="w-3 h-3" aria-hidden /> {index + 1}
                  </span>
                  {index === 0 && (
                    <span className="absolute top-1.5 right-1.5 px-1.5 py-0.5 rounded bg-blue-600 text-white text-[10px] font-bold">
                      Principale
                    </span>
                  )}
                  {external && (
                    <span className="absolute bottom-1.5 left-1.5 px-1.5 py-0.5 rounded bg-amber-500 text-slate-950 text-[10px] font-bold">
                      Externe
                    </span>
                  )}
                </div>

                <div className="flex flex-wrap items-center justify-center gap-1 p-1.5 bg-white dark:bg-[#0f141f]">
                  <button type="button" onClick={() => move(img.key, -1)} disabled={index === 0} aria-label={`Déplacer la photo ${index + 1} vers la gauche`} className="p-1.5 rounded-md hover:bg-slate-100 dark:hover:bg-slate-800 disabled:opacity-30">
                    <ArrowLeft className="w-3.5 h-3.5" />
                  </button>
                  <button type="button" onClick={() => move(img.key, 1)} disabled={index === images.length - 1} aria-label={`Déplacer la photo ${index + 1} vers la droite`} className="p-1.5 rounded-md hover:bg-slate-100 dark:hover:bg-slate-800 disabled:opacity-30">
                    <ArrowRight className="w-3.5 h-3.5" />
                  </button>
                  {index !== 0 && (
                    <button type="button" onClick={() => makePrimary(img.key)} aria-label={`Définir la photo ${index + 1} comme principale`} title="Définir comme principale" className="p-1.5 rounded-md hover:bg-blue-50 dark:hover:bg-blue-900/30 text-blue-600">
                      <Star className="w-3.5 h-3.5" />
                    </button>
                  )}
                  <label className="p-1.5 rounded-md hover:bg-slate-100 dark:hover:bg-slate-800 cursor-pointer" title="Remplacer">
                    <RefreshCw className="w-3.5 h-3.5" aria-hidden />
                    <span className="sr-only">Remplacer la photo {index + 1}</span>
                    <input
                      type="file"
                      accept={ACCEPT.join(",")}
                      className="sr-only"
                      onChange={(e) => {
                        const f = e.target.files?.[0];
                        if (f) replace(img.key, f);
                        e.target.value = "";
                      }}
                    />
                  </label>
                  {external && (
                    <button type="button" onClick={() => importToCloudinary(img)} disabled={busyKey === img.key} title="Importer dans Cloudinary" aria-label={`Importer la photo ${index + 1} dans Cloudinary`} className="p-1.5 rounded-md hover:bg-amber-50 dark:hover:bg-amber-900/30 text-amber-600">
                      {busyKey === img.key ? <Loader2 className="w-3.5 h-3.5 animate-spin" /> : <CloudUpload className="w-3.5 h-3.5" />}
                    </button>
                  )}
                  <button type="button" onClick={() => remove(img.key)} aria-label={`Supprimer la photo ${index + 1}`} className="p-1.5 rounded-md hover:bg-red-50 dark:hover:bg-red-900/30 text-red-500">
                    <Trash2 className="w-3.5 h-3.5" />
                  </button>
                </div>
              </li>
            );
          })}
        </ul>
      )}

      <div className="flex gap-2">
        <div className="relative flex-1">
          <Link2 className="w-3.5 h-3.5 text-slate-400 absolute left-2.5 top-1/2 -translate-y-1/2" aria-hidden />
          <input
            type="url"
            value={urlInput}
            onChange={(e) => setUrlInput(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === "Enter") {
                e.preventDefault();
                addByUrl();
              }
            }}
            placeholder="…ou ajouter une image par URL (https://)"
            aria-label="Ajouter une image par URL"
            className="w-full rounded-lg bg-white dark:bg-slate-800 border border-slate-300 dark:border-slate-600 pl-8 pr-3 py-2 text-[11px] font-mono text-slate-800 dark:text-white focus:outline-none focus:border-blue-500"
          />
        </div>
        <button type="button" onClick={addByUrl} disabled={!urlInput.trim()} className="px-3 py-2 rounded-lg bg-slate-100 dark:bg-slate-800 border border-slate-300 dark:border-slate-600 text-xs font-semibold disabled:opacity-50">
          Ajouter
        </button>
      </div>

      {anyUploading && <p className="text-[11px] text-blue-500">Téléversement en cours — l&apos;enregistrement sera possible à la fin.</p>}
      <p className="text-[10px] text-slate-400">
        Les modifications (ordre, suppression, remplacement) sont appliquées à l&apos;enregistrement du véhicule.
        Les photos retirées sont alors supprimées de Cloudinary.
      </p>
    </div>
  );
}
