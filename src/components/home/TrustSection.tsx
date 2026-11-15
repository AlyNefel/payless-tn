import Link from "next/link";
import { ArrowRight, Star, Wallet, MessageCircle, InfinityIcon, CalendarX2 } from "lucide-react";
import type { TrustStats } from "@/lib/trustStats";

type L = "fr" | "en" | "ar";

const COPY = {
  fr: {
    eyebrow: "Ils nous font confiance",
    title: "Une agence locale, des engagements clairs",
    cars: "véhicules disponibles",
    agencies: "agences & points de livraison",
    airports: "aéroports desservis",
    rentals: "locations réalisées",
    rating: "note Google",
    reviews: "avis",
    seeReviews: "Lire les avis Google",
    cta: "Commencer votre réservation",
    badges: {
      cancel: (h: number) => `Annulation gratuite jusqu'à ${h} h avant`,
      cash: "Paiement à la remise des clés",
      km: "Kilométrage illimité",
      wa: "Assistance WhatsApp",
    },
  },
  en: {
    eyebrow: "Trusted by our customers",
    title: "A local agency with clear commitments",
    cars: "vehicles available",
    agencies: "agencies & delivery points",
    airports: "airports served",
    rentals: "completed rentals",
    rating: "Google rating",
    reviews: "reviews",
    seeReviews: "Read Google reviews",
    cta: "Start your booking",
    badges: {
      cancel: (h: number) => `Free cancellation up to ${h} h before`,
      cash: "Pay at key handover",
      km: "Unlimited mileage",
      wa: "WhatsApp support",
    },
  },
  ar: {
    eyebrow: "عملاؤنا يثقون بنا",
    title: "وكالة محلية والتزامات واضحة",
    cars: "سيارة متاحة",
    agencies: "وكالة ونقطة تسليم",
    airports: "مطارات",
    rentals: "عملية كراء منجزة",
    rating: "تقييم Google",
    reviews: "تقييم",
    seeReviews: "قراءة تقييمات Google",
    cta: "ابدأ حجزك",
    badges: {
      cancel: (h: number) => `إلغاء مجاني حتى ${h} ساعة قبل الموعد`,
      cash: "الدفع عند التسليم",
      km: "كيلومترات غير محدودة",
      wa: "مساعدة عبر واتساب",
    },
  },
};

/**
 * Section C — trust: every figure comes from the database or from values the agency entered
 * in its settings. Nothing is shown when a figure is missing (no invented statistics).
 */
export function TrustSection({
  locale,
  stats,
  settings,
}: {
  locale: string;
  stats: TrustStats;
  settings: Record<string, unknown>;
}) {
  const l = (["fr", "en", "ar"].includes(locale) ? locale : "fr") as L;
  const t = COPY[l];
  const rating = Number(settings.googleRating);
  const reviewCount = Number(settings.googleReviewCount);
  const reviewsUrl = String(settings.googleReviewsUrl || "");
  const cancelHours = Number(settings.cancellationHours) || 0;
  const pm = (settings.paymentMethods || {}) as Record<string, { enabled?: boolean }>;
  const cashEnabled = !pm.cash || pm.cash.enabled !== false;

  const metrics = [
    stats.cars > 0 && { value: String(stats.cars), label: t.cars },
    stats.agencies > 0 && { value: String(stats.agencies), label: t.agencies },
    stats.airports > 0 && { value: String(stats.airports), label: t.airports },
    stats.completedRentals >= 50 && { value: stats.completedRentals.toLocaleString("fr-FR"), label: t.rentals },
    rating > 0 && rating <= 5 && {
      value: rating.toFixed(1).replace(".", ","),
      label: `${t.rating}${reviewCount > 0 ? ` · ${reviewCount} ${t.reviews}` : ""}`,
      star: true,
    },
  ].filter(Boolean) as { value: string; label: string; star?: boolean }[];

  const badges = [
    cancelHours > 0 && { icon: CalendarX2, label: t.badges.cancel(cancelHours) },
    cashEnabled && { icon: Wallet, label: t.badges.cash },
    { icon: InfinityIcon, label: t.badges.km },
    settings.whatsapp && { icon: MessageCircle, label: t.badges.wa },
  ].filter(Boolean) as { icon: typeof Star; label: string }[];

  return (
    <section aria-labelledby="trust" className="py-16 sm:py-24 bg-muted/40 dark:bg-neutral-950">
      <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 text-center">
        <p className="text-xs font-bold uppercase tracking-[0.2em] text-blue-600 dark:text-blue-400">{t.eyebrow}</p>
        <h2 id="trust" className="mt-2 text-3xl sm:text-4xl font-black tracking-tight text-foreground font-display">
          {t.title}
        </h2>

        {metrics.length > 0 && (
          <dl className={`mt-10 grid grid-cols-2 ${metrics.length >= 4 ? "lg:grid-cols-4" : "lg:grid-cols-3"} gap-4 max-w-5xl mx-auto`}>
            {metrics.map((m) => (
              <div key={m.label} className="p-6 rounded-3xl bg-card border border-border shadow-sm">
                <dt className="sr-only">{m.label}</dt>
                <dd>
                  <span className="flex items-center justify-center gap-1.5 text-4xl font-black text-foreground">
                    {m.value}
                    {m.star && <Star className="w-7 h-7 fill-amber-400 text-amber-400" aria-hidden />}
                  </span>
                  <span className="block mt-1 text-xs sm:text-sm text-muted-foreground">{m.label}</span>
                </dd>
              </div>
            ))}
          </dl>
        )}

        <ul className="mt-8 flex flex-wrap justify-center gap-2.5">
          {badges.map((b) => {
            const Icon = b.icon;
            return (
              <li key={b.label} className="inline-flex items-center gap-2 px-4 py-2 rounded-full bg-card border border-border text-xs sm:text-sm font-semibold text-foreground">
                <Icon className="w-4 h-4 text-emerald-600 dark:text-emerald-400" aria-hidden />
                {b.label}
              </li>
            );
          })}
        </ul>

        <div className="mt-10 flex flex-col sm:flex-row items-center justify-center gap-3">
          <Link
            href={`/${l}/booking`}
            className="inline-flex items-center gap-2 px-7 py-4 rounded-2xl bg-blue-600 hover:bg-blue-500 text-white text-sm font-extrabold shadow-lg shadow-blue-600/25 transition-colors"
          >
            {t.cta}
            <ArrowRight className="w-4 h-4 rtl-flip" aria-hidden />
          </Link>
          {reviewsUrl.startsWith("https://") && (
            <a href={reviewsUrl} target="_blank" rel="noopener noreferrer" className="text-sm font-semibold text-blue-600 dark:text-blue-400 hover:underline">
              {t.seeReviews}
            </a>
          )}
        </div>
      </div>
    </section>
  );
}
