import type { Metadata } from "next";
import { notFound } from "next/navigation";
import mongoose from "mongoose";
import { setRequestLocale } from "next-intl/server";
import { VehicleDetailClient } from "./VehicleDetailClient";
import { JsonLd } from "@/components/seo/JsonLd";
import connectDB from "@/lib/db";
import { Vehicle } from "@/models";
import "@/models/VehicleCategory";
import { sanitizeVehicleForClient } from "@/lib/sanitize";
import { buildMetadata } from "@/lib/seo";
import { breadcrumb } from "@/lib/structuredData";
import { SITE_URL, localeUrl } from "@/lib/site";

interface PageProps {
  params: Promise<{ locale: string; id: string }>;
}

type L = "fr" | "en" | "ar";
const asLocale = (l: string): L => (["fr", "en", "ar"].includes(l) ? (l as L) : "fr");

/** Loads a publicly visible vehicle (archived / withdrawn vehicles return null → 404). */
async function getVehicle(id: string) {
  if (!mongoose.Types.ObjectId.isValid(id)) return null;
  try {
    await connectDB();
    const v = await Vehicle.findOne({ _id: id, isActive: true, status: { $nin: ["archived", "unavailable"] } })
      .populate("categoryId", "name slug")
      .lean();
    return v ? (JSON.parse(JSON.stringify(sanitizeVehicleForClient(v))) as Record<string, any>) : null;
  } catch (err) {
    console.error("Vehicle page load failed:", err);
    return null;
  }
}

const TRANSMISSION: Record<string, Record<L, string>> = {
  automatic: { fr: "automatique", en: "automatic", ar: "أوتوماتيك" },
  manual: { fr: "manuelle", en: "manual", ar: "يدوي" },
};

export async function generateMetadata({ params }: PageProps): Promise<Metadata> {
  const { locale, id } = await params;
  const l = asLocale(locale);
  const v = await getVehicle(id);
  if (!v) return { title: "404", robots: { index: false, follow: true } };

  const name = `${v.brand} ${v.model}`;
  const daily = Math.round((v.pricing?.daily || 0) / 100);
  const trans = TRANSMISSION[v.transmission]?.[l] || v.transmission;
  const copy: Record<L, { title: string; description: string }> = {
    fr: {
      title: `Location ${name} en Tunisie – dès ${daily} TND/jour`,
      description: `Louez une ${name} (boîte ${trans}, ${v.seats} places) en Tunisie à partir de ${daily} TND par jour. Livraison aéroport Tunis, Monastir, Enfidha. Kilométrage illimité.`,
    },
    en: {
      title: `Rent a ${name} in Tunisia – from ${daily} TND/day`,
      description: `Rent a ${name} (${trans}, ${v.seats} seats) in Tunisia from ${daily} TND per day. Airport delivery in Tunis, Monastir and Enfidha. Unlimited mileage.`,
    },
    ar: {
      title: `كراء ${name} في تونس – ابتداءً من ${daily} د.ت/اليوم`,
      description: `استأجر ${name} (${trans}، ${v.seats} مقاعد) في تونس ابتداءً من ${daily} دينار يومياً. تسليم في مطارات تونس والمنستير والنفيضة.`,
    },
  };
  const primary = v.images?.find((i: { isPrimary?: boolean }) => i.isPrimary) || v.images?.[0];

  return buildMetadata({
    locale: l,
    path: `/vehicles/${id}`,
    title: copy[l].title,
    description: copy[l].description,
    image: primary?.url ? { url: primary.url, alt: name } : undefined,
  });
}

export default async function VehicleDetailPage({ params }: PageProps) {
  const { locale, id } = await params;
  setRequestLocale(locale);
  const l = asLocale(locale);
  const v = await getVehicle(id);
  if (!v) notFound();

  const name = `${v.brand} ${v.model}`;
  const url = localeUrl(l, `/vehicles/${id}`);
  const carJsonLd = {
    "@context": "https://schema.org",
    "@type": "Car",
    "@id": `${url}#vehicle`,
    name,
    url,
    brand: { "@type": "Brand", name: v.brand },
    model: v.model,
    vehicleModelDate: v.year ? String(v.year) : undefined,
    vehicleTransmission: v.transmission === "automatic" ? "Automatic" : "Manual",
    fuelType: v.fuelType,
    seatingCapacity: v.seats,
    numberOfDoors: v.doors,
    vehicleConfiguration: v.categoryId?.name?.[l] || v.categoryId?.name?.fr,
    image: (v.images || []).map((i: { url: string }) => i.url).slice(0, 6),
    offers: {
      "@type": "Offer",
      url,
      priceCurrency: "TND",
      price: ((v.pricing?.daily || 0) / 100).toFixed(2),
      priceSpecification: {
        "@type": "UnitPriceSpecification",
        price: ((v.pricing?.daily || 0) / 100).toFixed(2),
        priceCurrency: "TND",
        unitCode: "DAY",
        referenceQuantity: { "@type": "QuantitativeValue", value: 1, unitCode: "DAY" },
      },
      availability: "https://schema.org/InStock",
      businessFunction: "http://purl.org/goodrelations/v1#LeaseOut",
      seller: { "@id": `${SITE_URL}/#organization` },
    },
  };
  const crumbs = breadcrumb([
    { name: l === "ar" ? "الرئيسية" : l === "en" ? "Home" : "Accueil", url: localeUrl(l) },
    { name: l === "ar" ? "سياراتنا" : l === "en" ? "Our cars" : "Nos voitures", url: localeUrl(l, "/vehicles") },
    { name, url },
  ]);

  return (
    <>
      <JsonLd data={[carJsonLd, crumbs]} />
      <VehicleDetailClient vehicleId={id} locale={locale} initialVehicle={v as never} />
    </>
  );
}
