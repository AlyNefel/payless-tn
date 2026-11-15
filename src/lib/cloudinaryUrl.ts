/**
 * Client-safe helpers to build optimized Cloudinary delivery URLs.
 * Non-Cloudinary URLs (legacy hmlrentcar.tn / Unsplash images) are returned untouched.
 */

const UPLOAD_SEGMENT = "/image/upload/";

export function isCloudinaryUrl(url?: string | null): boolean {
  return Boolean(url && url.includes("res.cloudinary.com") && url.includes(UPLOAD_SEGMENT));
}

export interface CloudinaryTransform {
  width?: number;
  height?: number;
  crop?: "fill" | "fit" | "limit" | "pad" | "thumb";
  gravity?: "auto" | "center";
  quality?: "auto" | "auto:good" | "auto:eco" | number;
}

/** Inserts f_auto,q_auto (+ optional sizing) right after /image/upload/. */
export function cloudinaryUrl(url: string, t: CloudinaryTransform = {}): string {
  if (!isCloudinaryUrl(url)) return fullResImageUrl(url);
  const parts = ["f_auto", `q_${t.quality ?? "auto"}`];
  if (t.width) parts.push(`w_${Math.round(t.width)}`);
  if (t.height) parts.push(`h_${Math.round(t.height)}`);
  if (t.width || t.height) {
    parts.push(`c_${t.crop ?? "limit"}`);
    if (t.gravity && (t.crop === "fill" || t.crop === "thumb")) parts.push(`g_${t.gravity}`);
  }
  parts.push("dpr_1.0");
  const [before, after] = url.split(UPLOAD_SEGMENT);
  // Drop transformation segments already present (e.g. from a previous call) to stay idempotent.
  const cleanAfter = after.replace(/^((?:[a-z]{1,3}_[^/,]+,?)+\/)+/i, "");
  return `${before}${UPLOAD_SEGMENT}${parts.join(",")}/${cleanAfter}`;
}

/** Responsive srcSet for <img>; returns undefined for non-Cloudinary images. */
export function cloudinarySrcSet(
  url: string,
  widths: number[] = [320, 480, 640, 800, 1024, 1280, 1600],
  t: Omit<CloudinaryTransform, "width"> = {}
): string | undefined {
  if (!isCloudinaryUrl(url)) return undefined;
  return widths.map((w) => `${cloudinaryUrl(url, { ...t, width: w })} ${w}w`).join(", ");
}

/** next/image loader for Cloudinary URLs (falls back to the original URL otherwise). */
export function cloudinaryLoader({ src, width, quality }: { src: string; width: number; quality?: number }): string {
  return cloudinaryUrl(src, { width, quality: quality ?? "auto", crop: "limit" });
}

/**
 * Legacy gallery images (hmlrentcar.tn) were imported as WordPress thumbnails
 * ("big_thumb_…" = 225×360, "thumb_…" even smaller). The full-resolution original
 * lives at the same path without the prefix (≈ 884×1320). Upscaling the thumbnail
 * into a full-width mobile card is what made vehicle photos look blurry.
 */
export function fullResImageUrl(url?: string | null): string {
  if (!url) return "";
  if (!url.includes("hmlrentcar.tn")) return url;
  return url.replace(/\/(big_thumb_|thumb_|small_thumb_)([^/]+)$/i, "/$2");
}
