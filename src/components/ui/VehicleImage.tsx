"use client";

import Image, { type ImageProps } from "next/image";
import { useState } from "react";
import { cloudinaryLoader, isCloudinaryUrl } from "@/lib/cloudinaryUrl";

export const VEHICLE_PLACEHOLDER = "/images/vehicle-placeholder.svg";

type Props = Omit<ImageProps, "src" | "loader"> & {
  src?: string | null;
  /** Required for responsive delivery, e.g. "(min-width:1024px) 33vw, 100vw". */
  sizes: string;
};

/**
 * Responsive vehicle photo.
 * - Cloudinary images: resized/format-negotiated by Cloudinary (f_auto, q_auto, w_*) via a custom loader.
 * - Legacy hosts (hmlrentcar.tn…): served as-is, as before (their hotlink policy blocks the optimizer).
 * - Broken/missing images fall back to a local placeholder instead of an empty box.
 */
export function VehicleImage({ src, alt, sizes, ...rest }: Props) {
  const [failed, setFailed] = useState(false);
  const url = !src || failed ? VEHICLE_PLACEHOLDER : src;
  const cloudinary = isCloudinaryUrl(url);
  const isLocal = url.startsWith("/");

  return (
    <Image
      {...rest}
      src={url}
      alt={alt}
      sizes={sizes}
      loader={cloudinary ? cloudinaryLoader : undefined}
      unoptimized={!cloudinary && !isLocal && !url.includes("images.unsplash.com")}
      onError={() => setFailed(true)}
    />
  );
}
