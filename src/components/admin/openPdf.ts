"use client";

/**
 * Loads a generated PDF and shows it in `tab` (opened beforehand inside the click handler so the
 * browser does not block it), where it can be printed. Server refusals surface as errors instead
 * of a JSON page in the new tab.
 */
export async function openPdf(tab: Window | null, url: string): Promise<void> {
  const res = await fetch(url, { cache: "no-store" });
  if (!res.ok || !(res.headers.get("content-type") || "").includes("pdf")) {
    const d = await res.json().catch(() => ({}));
    throw new Error(d.error || `Document indisponible (erreur ${res.status})`);
  }
  const blobUrl = URL.createObjectURL(await res.blob());
  if (tab && !tab.closed) tab.location.href = blobUrl;
  else window.open(blobUrl, "_blank");
  // Leave time for the tab to load the document before releasing it.
  setTimeout(() => URL.revokeObjectURL(blobUrl), 60_000);
}
