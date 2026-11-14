import { routing } from "@/i18n/routing";

/** Canonical production origin. Override with NEXT_PUBLIC_SITE_URL (no trailing slash). */
export const SITE_URL = (process.env.NEXT_PUBLIC_SITE_URL || "https://payless.tn").replace(/\/$/, "");
export const SITE_NAME = "Payless Car Rental Tunisie";
export const LOCALES = routing.locales;
export type SiteLocale = (typeof routing.locales)[number];

export const OG_LOCALE: Record<SiteLocale, string> = { fr: "fr_TN", en: "en_US", ar: "ar_TN" };
export const HTML_LANG: Record<SiteLocale, string> = { fr: "fr-TN", en: "en", ar: "ar-TN" };

/** Absolute URL for a locale + path ("/vehicles"). */
export function localeUrl(locale: string, path = ""): string {
  const clean = path === "/" ? "" : path;
  return `${SITE_URL}/${locale}${clean}`;
}

/** hreflang alternates for a path, including x-default (French is the default market). */
export function languageAlternates(path = ""): Record<string, string> {
  const map: Record<string, string> = {};
  for (const l of LOCALES) map[HTML_LANG[l]] = localeUrl(l, path);
  map["x-default"] = localeUrl(routing.defaultLocale, path);
  return map;
}
