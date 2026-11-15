import React from "react";
import type { Metadata } from "next";
import { setRequestLocale } from "next-intl/server";
import { JsonLd } from "@/components/seo/JsonLd";
import { FAQS, personalizeFaqText } from "@/components/home/faqData";
import { getPublicSettings } from "@/lib/publicSettings";
import { pageMetadata } from "@/lib/seo";
import { Hero } from "@/components/home/Hero";
import { BookingSearchBox } from "@/components/home/BookingSearchBox";
import { WhyPayless } from "@/components/home/WhyPayless";
import { PremiumExperience } from "@/components/home/PremiumExperience";
import { TrustSection } from "@/components/home/TrustSection";
import { getTrustStats } from "@/lib/trustStats";
import { RentalSteps } from "@/components/home/RentalSteps";
import { PromotionsBanner } from "@/components/home/PromotionsBanner";
import { Testimonials } from "@/components/home/Testimonials";
import { FAQSection } from "@/components/home/FAQSection";

export async function generateMetadata({ params }: { params: Promise<{ locale: string }> }): Promise<Metadata> {
  const { locale } = await params;
  const meta = pageMetadata("home", locale, "");
  return { ...meta, title: { absolute: `${String(meta.title)} | Payless` } };
}

export default async function HomePage({
  params,
}: {
  params: Promise<{ locale: string }>;
}) {
  const { locale } = await params;
  setRequestLocale(locale);

  // FAQPage structured data mirrors the visible FAQ answers (same text substitutions).
  const [settings, trustStats] = await Promise.all([getPublicSettings(), getTrustStats()]);
  const agencyName = String(settings.agencyName || "Payless Car Rental Tunisie");
  const whatsapp = String(settings.whatsapp || settings.phone || "");
  const l = (["fr", "en", "ar"].includes(locale) ? locale : "fr") as "fr" | "en" | "ar";
  const faqJsonLd = {
    "@context": "https://schema.org",
    "@type": "FAQPage",
    inLanguage: l,
    mainEntity: FAQS.map((f) => ({
      "@type": "Question",
      name: f.question[l] || f.question.fr,
      acceptedAnswer: {
        "@type": "Answer",
        text: personalizeFaqText(f.answer[l] || f.answer.fr, agencyName, whatsapp),
      },
    })),
  };

  return (
    <div className="flex flex-col min-h-screen">
      <JsonLd data={faqJsonLd} />
      {/* 1. Cinematic Hero Section */}
      <Hero />

      {/* 2. Glassmorphic Booking Search Box docked on Hero */}
      <BookingSearchBox />

      {/* 3. Why Payless — replaces the vehicle grid already available under "Nos Voitures" */}
      <WhyPayless locale={locale} />

      {/* 4. 3-step rental process */}
      <RentalSteps />

      {/* 5. Premium experience hero band → "Voir nos véhicules" */}
      <PremiumExperience locale={locale} />

      {/* 6. Seasonal promotion */}
      <PromotionsBanner />

      {/* 7. Guest testimonials */}
      <Testimonials />

      {/* 8. Trust: real figures, commitments, final booking CTA */}
      <TrustSection locale={locale} stats={trustStats} settings={settings} />

      {/* 9. FAQ */}
      <FAQSection />
    </div>
  );
}
