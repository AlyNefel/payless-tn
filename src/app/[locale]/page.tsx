import React from "react";
import type { Metadata } from "next";
import { setRequestLocale } from "next-intl/server";
import { JsonLd } from "@/components/seo/JsonLd";
import { FAQS, personalizeFaqText } from "@/components/home/faqData";
import { getPublicSettings } from "@/lib/publicSettings";
import { pageMetadata } from "@/lib/seo";
import { Hero } from "@/components/home/Hero";
import { BookingSearchBox } from "@/components/home/BookingSearchBox";
import { FeaturedFleet } from "@/components/home/FeaturedFleet";
import { WhyChooseUs } from "@/components/home/WhyChooseUs";
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
  const settings = await getPublicSettings();
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

      {/* 3. Showcase Fleet Grid with Interactive Category Tabs */}
      <FeaturedFleet />

      {/* 4. The PAYLESS Distinction / Why Choose Us Editorial Cards */}
      <WhyChooseUs />

      {/* 5. 3-Step Seamless Rental Progression */}
      <RentalSteps />

      {/* 6. VIP Seasonal Promotional Banner with One-Click Copy */}
      <PromotionsBanner />

      {/* 7. Verified Guest Testimonials with Ratings */}
      <Testimonials />

      {/* 8. Comprehensive Expandable FAQ Accordion */}
      <FAQSection />
    </div>
  );
}
