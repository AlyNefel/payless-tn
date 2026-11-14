"use client";

import React, { useState } from "react";
import { motion, AnimatePresence } from "framer-motion";
import { useTranslations, useLocale } from "next-intl";
import { useCompanySettings } from "@/contexts/CompanySettingsContext";
import {
  HelpCircle,
  ChevronDown,
  FileText,
  CreditCard,
  MapPin,
  Globe2,
  Calendar,
  CheckCircle2,
} from "lucide-react";
import { FAQS, type FAQIconName } from "./faqData";

const FAQ_ICONS: Record<FAQIconName, React.ComponentType<{ className?: string }>> = { Calendar, CreditCard, FileText, Globe2, MapPin };

export function FAQSection() {
  const t = useTranslations("home");
  const locale = useLocale();
  const { settings } = useCompanySettings();
  const [openId, setOpenId] = useState<string | null>("faq-docs");

  const agencyName = settings.agencyName || "Payless Car Rental Tunisie";
  const whatsappNum = settings.whatsapp || settings.phone || "80808080";

  const toggleItem = (id: string) => {
    setOpenId(openId === id ? null : id);
  };

  return (
    <section id="faq" className="py-20 bg-background relative overflow-hidden">
      <div className="max-w-4xl mx-auto px-4 sm:px-6 lg:px-8">
        {/* Section Heading */}
        <div className="text-center mb-14">
          <div className="inline-flex items-center gap-2 px-3.5 py-1 rounded-full bg-amber-400/10 border border-amber-400/20 text-amber-500 text-xs font-semibold uppercase tracking-wider mb-3">
            <HelpCircle className="w-3.5 h-3.5" />
            <span>
              {locale === "ar"
                ? "شفاف وواضح"
                : locale === "fr"
                ? "Clair & Transparent"
                : "Clear & Transparent"}
            </span>
          </div>

          <h2 className="text-3xl sm:text-4xl font-extrabold text-foreground font-display tracking-tight">
            {t("faq") || "Questions fréquentes"}
          </h2>

          <p className="mt-3 text-sm sm:text-base text-muted-foreground">
            {t("faqSubtitle") ||
              (locale === "fr"
                ? "Tout ce que vous devez savoir pour louer une voiture en Tunisie avec Payless."
                : locale === "ar"
                ? "كل ما تحتاج معرفته لاستئجار سيارة في تونس مع باي ليس."
                : "Everything you need to know about renting a car in Tunisia with PAYLESS.")}
          </p>
        </div>

        {/* Accordion List */}
        <div className="space-y-3.5">
          {FAQS.map((faq) => {
            const isOpen = openId === faq.id;
            const Icon = FAQ_ICONS[faq.icon];
            const questionText = faq.question[locale] || faq.question.fr;
            let answerText = faq.answer[locale] || faq.answer.fr;
            answerText = answerText
              .replace(/Payless Tunisie/g, agencyName)
              .replace(/Payless Tunisia/g, agencyName)
              .replace(/\+216 25 120 130/g, whatsappNum);
            const points = faq.keyPoints?.[locale] || faq.keyPoints?.fr;

            return (
              <div
                key={faq.id}
                className={`rounded-2xl border transition-all duration-200 overflow-hidden ${
                  isOpen
                    ? "bg-card border-amber-400/50 shadow-md"
                    : "bg-card/60 border-border/70 hover:border-border hover:bg-card"
                }`}
              >
                {/* Accordion Trigger */}
                <button
                  type="button"
                  onClick={() => toggleItem(faq.id)}
                  aria-expanded={isOpen}
                  aria-controls={`${faq.id}-panel`}
                  id={`${faq.id}-button`}
                  className="w-full px-5 py-4 sm:p-5 flex items-center justify-between text-left rtl:text-right gap-4 transition-colors"
                >
                  <div className="flex items-center gap-3.5">
                    <div
                      className={`w-9 h-9 rounded-xl flex items-center justify-center shrink-0 transition-colors ${
                        isOpen
                          ? "bg-amber-400/20 text-amber-500"
                          : "bg-muted text-muted-foreground"
                      }`}
                    >
                      <Icon className="w-4 h-4" />
                    </div>
                    <span className="font-bold text-sm sm:text-base text-foreground">
                      {questionText}
                    </span>
                  </div>
                  <ChevronDown
                    className={`w-4 h-4 text-muted-foreground shrink-0 transition-transform duration-300 ${
                      isOpen ? "rotate-180 text-amber-500" : ""
                    }`}
                  />
                </button>

                {/* Accordion Content */}
                <AnimatePresence initial={false}>
                  {isOpen && (
                    <motion.div
                      id={`${faq.id}-panel`}
                      role="region"
                      aria-labelledby={`${faq.id}-button`}
                      initial={{ height: 0, opacity: 0 }}
                      animate={{ height: "auto", opacity: 1 }}
                      exit={{ height: 0, opacity: 0 }}
                      transition={{ duration: 0.25, ease: "easeInOut" }}
                    >
                      <div className="px-5 pb-5 pt-1 border-t border-border/40 space-y-3">
                        <p className="text-xs sm:text-sm text-muted-foreground leading-relaxed">
                          {answerText}
                        </p>

                        {points && points.length > 0 && (
                          <div className="grid grid-cols-1 sm:grid-cols-3 gap-2 pt-2">
                            {points.map((pt, i) => (
                              <div
                                key={i}
                                className="flex items-center gap-1.5 text-xs text-foreground bg-muted/40 px-2.5 py-1.5 rounded-lg border border-border/30"
                              >
                                <CheckCircle2 className="w-3.5 h-3.5 text-emerald-500 shrink-0" />
                                <span className="truncate">{pt}</span>
                              </div>
                            ))}
                          </div>
                        )}
                      </div>
                    </motion.div>
                  )}
                </AnimatePresence>
              </div>
            );
          })}
        </div>
      </div>
    </section>
  );
}
