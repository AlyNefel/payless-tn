import type { Metadata } from "next";
import { OG_LOCALE, SITE_NAME, SITE_URL, languageAlternates, localeUrl, type SiteLocale } from "./site";

export type PageKey = "home" | "vehicles" | "promotions" | "about" | "contact" | "terms" | "booking" | "bookingStatus";

/**
 * Page titles & descriptions (≈50–60 / 140–160 characters), written to match what each page shows.
 * Claims are kept factual (no "0 TND deposit" — every vehicle has a refundable deposit).
 */
export const SEO_COPY: Record<PageKey, Record<SiteLocale, { title: string; description: string }>> = {
  home: {
    fr: {
      title: "Location de voiture en Tunisie – Aéroports Tunis, Monastir, Enfidha",
      description:
        "Louez une voiture en Tunisie avec Payless : livraison aux aéroports de Tunis-Carthage, Monastir et Enfidha, kilométrage illimité, confirmation immédiate.",
    },
    en: {
      title: "Car Rental in Tunisia – Tunis, Monastir & Enfidha Airports",
      description:
        "Rent a car in Tunisia with Payless: delivery at Tunis-Carthage, Monastir and Enfidha airports, unlimited mileage and instant booking confirmation.",
    },
    ar: {
      title: "كراء السيارات في تونس – مطارات تونس قرطاج، المنستير والنفيضة",
      description:
        "استأجر سيارة في تونس مع بايليس: تسليم في مطارات تونس قرطاج والمنستير والنفيضة، كيلومترات غير محدودة وتأكيد فوري للحجز.",
    },
  },
  vehicles: {
    fr: {
      title: "Nos voitures de location en Tunisie – Citadines, SUV, Berlines",
      description:
        "Comparez notre flotte en Tunisie : citadines économiques, compactes, berlines et SUV, boîte manuelle ou automatique. Tarifs par jour en dinars (TND).",
    },
    en: {
      title: "Rental Cars in Tunisia – City Cars, SUVs & Sedans",
      description:
        "Browse our rental fleet in Tunisia: economy city cars, compacts, sedans and SUVs, manual or automatic. Daily rates in Tunisian dinars (TND).",
    },
    ar: {
      title: "سيارات للكراء في تونس – سيارات صغيرة، سيدان ودفع رباعي",
      description: "تصفح أسطول سياراتنا في تونس: سيارات اقتصادية، مدمجة، سيدان ودفع رباعي، يدوية أو أوتوماتيكية. أسعار يومية بالدينار التونسي.",
    },
  },
  promotions: {
    fr: {
      title: "Promotions et codes promo – Location de voiture Tunisie",
      description: "Offres en cours et codes promo Payless pour votre location de voiture en Tunisie. Conditions et dates de validité indiquées pour chaque offre.",
    },
    en: {
      title: "Car Rental Deals & Promo Codes – Tunisia",
      description: "Current Payless offers and promo codes for car rental in Tunisia, with conditions and validity dates for each deal.",
    },
    ar: {
      title: "عروض وأكواد تخفيض – كراء السيارات في تونس",
      description: "العروض الحالية وأكواد التخفيض من بايليس لكراء السيارات في تونس مع شروط وتواريخ صلاحية كل عرض.",
    },
  },
  about: {
    fr: {
      title: "À propos de Payless – Agence de location à La Soukra, Ariana",
      description: "Payless Car Rental Tunisie (Houimli Rent a Car) : agence de location de voitures basée à La Soukra, avec livraison dans les aéroports et villes de Tunisie.",
    },
    en: {
      title: "About Payless – Car Rental Agency in La Soukra, Ariana",
      description: "Payless Car Rental Tunisia (Houimli Rent a Car): car rental agency based in La Soukra, delivering to airports and cities across Tunisia.",
    },
    ar: {
      title: "من نحن – وكالة بايليس لكراء السيارات بسكرة، أريانة",
      description: "بايليس لكراء السيارات تونس (هويملي رنت أ كار): وكالة مقرها سكرة مع خدمة التسليم في المطارات والمدن التونسية.",
    },
  },
  contact: {
    fr: {
      title: "Contact – Réservation et assistance location de voiture",
      description: "Contactez Payless par téléphone, WhatsApp ou email pour une réservation, une livraison à l'aéroport ou une assistance pendant votre location en Tunisie.",
    },
    en: {
      title: "Contact – Car Rental Booking & Support in Tunisia",
      description: "Reach Payless by phone, WhatsApp or email for bookings, airport delivery or assistance during your car rental in Tunisia.",
    },
    ar: {
      title: "اتصل بنا – الحجز والمساعدة لكراء السيارات",
      description: "تواصل مع بايليس عبر الهاتف أو واتساب أو البريد الإلكتروني للحجز أو التسليم في المطار أو المساعدة أثناء الكراء في تونس.",
    },
  },
  terms: {
    fr: {
      title: "Conditions générales de location",
      description: "Conditions générales de location Payless Car Rental Tunisie : conducteur, permis, caution, assurance, carburant, annulation et restitution du véhicule.",
    },
    en: {
      title: "Rental Terms & Conditions",
      description: "Payless Car Rental Tunisia terms: driver and licence requirements, deposit, insurance, fuel policy, cancellation and vehicle return.",
    },
    ar: {
      title: "الشروط العامة للكراء",
      description: "الشروط العامة لكراء السيارات لدى بايليس تونس: السائق والرخصة، الضمان، التأمين، الوقود، الإلغاء وإرجاع السيارة.",
    },
  },
  booking: {
    fr: { title: "Réserver une voiture", description: "Réservez votre voiture de location en Tunisie en quelques étapes." },
    en: { title: "Book a Car", description: "Book your rental car in Tunisia in a few steps." },
    ar: { title: "احجز سيارة", description: "احجز سيارتك في تونس في بضع خطوات." },
  },
  bookingStatus: {
    fr: { title: "Suivi de réservation", description: "Consultez et gérez votre réservation Payless." },
    en: { title: "Track My Booking", description: "View and manage your Payless booking." },
    ar: { title: "تتبع الحجز", description: "اطلع على حجزك لدى بايليس وقم بإدارته." },
  },
};


interface BuildOptions {
  locale: string;
  path?: string;
  title: string;
  description: string;
  image?: { url: string; width?: number; height?: number; alt?: string };
  noindex?: boolean;
  type?: "website" | "article";
  /** Use the title as-is (skip the "| Payless…" template). */
  absoluteTitle?: boolean;
}

export function buildMetadata({ locale, path = "", title, description, image, noindex, type = "website", absoluteTitle }: BuildOptions): Metadata {
  const l = (["fr", "en", "ar"].includes(locale) ? locale : "fr") as SiteLocale;
  const url = localeUrl(l, path);
  const ogImage = image || { url: `${SITE_URL}/${l}/opengraph-image`, width: 1200, height: 630, alt: SITE_NAME };

  return {
    metadataBase: new URL(SITE_URL),
    title: absoluteTitle ? { absolute: title } : title,
    description,
    alternates: { canonical: url, languages: languageAlternates(path) },
    openGraph: {
      type,
      url,
      siteName: SITE_NAME,
      title,
      description,
      locale: OG_LOCALE[l],
      alternateLocale: Object.entries(OG_LOCALE).filter(([k]) => k !== l).map(([, v]) => v),
      images: [ogImage],
    },
    twitter: { card: "summary_large_image", title, description, images: [ogImage.url] },
    robots: noindex
      ? { index: false, follow: true, googleBot: { index: false, follow: true } }
      : { index: true, follow: true, googleBot: { index: true, follow: true, "max-image-preview": "large", "max-snippet": -1 } },
  };
}

export function pageMetadata(key: PageKey, locale: string, path: string, opts: { noindex?: boolean } = {}): Metadata {
  const l = (["fr", "en", "ar"].includes(locale) ? locale : "fr") as SiteLocale;
  const copy = SEO_COPY[key][l];
  return buildMetadata({ locale: l, path, title: copy.title, description: copy.description, noindex: opts.noindex });
}
