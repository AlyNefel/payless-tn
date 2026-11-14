import connectDB from "./db";
import Location from "@/models/Location";
import { SITE_NAME, SITE_URL, localeUrl, HTML_LANG, type SiteLocale } from "./site";

type Settings = Record<string, unknown>;
const str = (v: unknown) => (typeof v === "string" && v.trim() ? v.trim() : undefined);

const DAY_MAP: Record<string, string> = {
  monday: "Monday",
  tuesday: "Tuesday",
  wednesday: "Wednesday",
  thursday: "Thursday",
  friday: "Friday",
  saturday: "Saturday",
  sunday: "Sunday",
};

/**
 * Organization + AutoRental (LocalBusiness) graph built from real agency settings and the
 * Location collection. No ratings/reviews are emitted: the site has no verified review source.
 */
export async function buildBusinessGraph(locale: SiteLocale, settings: Settings) {
  const name = str(settings.agencyName) || SITE_NAME;
  const telephone = str(settings.phone);
  const email = str(settings.email);
  const sameAs = ["facebook", "instagram", "linkedin", "twitter"]
    .map((k) => str(settings[k]))
    .filter((u): u is string => Boolean(u && /^https?:\/\/[^/]+\/.+/.test(u)));

  let branches: Record<string, unknown>[] = [];
  try {
    await connectDB();
    const locations = await Location.find({ isActive: true }).lean();
    branches = locations.map((loc) => {
      const locName = (loc.name as Record<string, string> | undefined)?.[locale] || (loc.name as Record<string, string>)?.fr;
      const hours = Object.entries((loc.openingHours || {}) as Record<string, { open?: string; close?: string; isOpen?: boolean }>)
        .filter(([day, h]) => DAY_MAP[day] && h?.isOpen)
        .map(([day, h]) => ({
          "@type": "OpeningHoursSpecification",
          dayOfWeek: `https://schema.org/${DAY_MAP[day]}`,
          opens: h.open,
          closes: h.close === "23:59" ? "23:59:59" : h.close,
        }));
      return {
        "@type": "AutoRental",
        "@id": `${SITE_URL}/#location-${String(loc._id)}`,
        name: `${name} – ${String(locName || loc.city).replace(/^\d+\.\s*/, "")}`,
        parentOrganization: { "@id": `${SITE_URL}/#organization` },
        address: {
          "@type": "PostalAddress",
          streetAddress: loc.address,
          addressLocality: loc.city,
          addressCountry: "TN",
        },
        ...(loc.coordinates?.lat && loc.coordinates?.lng
          ? { geo: { "@type": "GeoCoordinates", latitude: loc.coordinates.lat, longitude: loc.coordinates.lng } }
          : {}),
        ...(loc.phone ? { telephone: loc.phone } : telephone ? { telephone } : {}),
        ...(hours.length ? { openingHoursSpecification: hours } : {}),
      };
    });
  } catch (err) {
    console.warn("Structured data: locations unavailable", err);
  }

  const headquarters = {
    "@type": "AutoRental",
    "@id": `${SITE_URL}/#organization`,
    name,
    legalName: str(settings.legalName),
    url: localeUrl(locale),
    logo: `${SITE_URL}/icon-512.png`,
    image: `${SITE_URL}/${locale}/opengraph-image`,
    ...(telephone ? { telephone } : {}),
    ...(email ? { email } : {}),
    address: {
      "@type": "PostalAddress",
      streetAddress: str(settings.address),
      addressLocality: "La Soukra",
      addressRegion: "Ariana",
      postalCode: str(settings.postalCode) || "2036",
      addressCountry: "TN",
    },
    areaServed: { "@type": "Country", name: "Tunisia" },
    currenciesAccepted: "TND",
    paymentAccepted: "Cash, Credit Card, Bank Transfer",
    ...(sameAs.length ? { sameAs } : {}),
    ...(branches.length ? { department: branches } : {}),
  };

  const website = {
    "@type": "WebSite",
    "@id": `${SITE_URL}/#website`,
    url: SITE_URL,
    name,
    inLanguage: HTML_LANG[locale],
    publisher: { "@id": `${SITE_URL}/#organization` },
  };

  return { "@context": "https://schema.org", "@graph": [headquarters, website] };
}

export function breadcrumb(items: { name: string; url: string }[]) {
  return {
    "@context": "https://schema.org",
    "@type": "BreadcrumbList",
    itemListElement: items.map((it, i) => ({ "@type": "ListItem", position: i + 1, name: it.name, item: it.url })),
  };
}
