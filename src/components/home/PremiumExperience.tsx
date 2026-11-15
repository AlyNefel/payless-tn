import Image from "next/image";
import Link from "next/link";
import { ArrowRight, Zap, Truck, BadgeCheck, Globe2 } from "lucide-react";

type L = "fr" | "en" | "ar";

const COPY = {
  fr: {
    eyebrow: "Une expérience premium",
    title: "De la réservation à la route en quelques minutes",
    text: "Réservez en ligne en moins de trois minutes, nous nous occupons du reste : véhicule préparé, remise des clés à l'heure, équipe à votre écoute.",
    cta: "Voir nos véhicules",
    points: [
      ["Réservation rapide", "Confirmation immédiate, sans paiement en ligne obligatoire."],
      ["Livraison express", "Remise du véhicule à l'aéroport, à l'hôtel ou en agence."],
      ["Service professionnel", "Véhicule propre, contrôlé et expliqué à la remise des clés."],
      ["Apprécié des voyageurs", "Clients tunisiens, diaspora et touristes du monde entier."],
    ],
  },
  en: {
    eyebrow: "A premium experience",
    title: "From booking to the open road in minutes",
    text: "Book online in under three minutes and we handle the rest: car prepared, keys handed over on time, a team that listens.",
    cta: "See our vehicles",
    points: [
      ["Quick booking", "Instant confirmation, no mandatory online payment."],
      ["Fast delivery", "Car handed over at the airport, your hotel or an agency."],
      ["Professional service", "Clean, inspected car, explained at handover."],
      ["Trusted by travelers", "Tunisian residents, diaspora and tourists from around the world."],
    ],
  },
  ar: {
    eyebrow: "تجربة مميزة",
    title: "من الحجز إلى الطريق في دقائق",
    text: "احجز عبر الإنترنت في أقل من ثلاث دقائق ونتكفل بالباقي: سيارة جاهزة وتسليم في الموعد وفريق في الخدمة.",
    cta: "شاهد سياراتنا",
    points: [
      ["حجز سريع", "تأكيد فوري دون دفع إلكتروني إجباري."],
      ["تسليم سريع", "تسليم السيارة في المطار أو الفندق أو الوكالة."],
      ["خدمة احترافية", "سيارة نظيفة ومفحوصة مع شرح عند التسليم."],
      ["موثوق من المسافرين", "مقيمون وجالية وسياح من كل أنحاء العالم."],
    ],
  },
} as const;

const ICONS = [Zap, Truck, BadgeCheck, Globe2];

/** Section B — luxury hero-style band with a single clear call to action. */
export function PremiumExperience({ locale }: { locale: string }) {
  const l = (["fr", "en", "ar"].includes(locale) ? locale : "fr") as L;
  const t = COPY[l];
  return (
    <section aria-labelledby="premium-experience" className="relative isolate overflow-hidden bg-slate-950 text-white">
      <Image
        src="https://images.unsplash.com/photo-1503376780353-7e6692767b70?auto=format&fit=crop&w=2000&q=70"
        alt=""
        fill
        sizes="100vw"
        className="object-cover -z-10 opacity-60"
      />
      <div className="absolute inset-0 -z-10 bg-gradient-to-r from-slate-950 via-slate-950/85 to-slate-950/30 rtl:bg-gradient-to-l" />
      <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 py-20 sm:py-28">
        <div className="max-w-2xl">
          <p className="text-xs font-bold uppercase tracking-[0.25em] text-amber-300">{t.eyebrow}</p>
          <h2 id="premium-experience" className="mt-3 text-3xl sm:text-5xl font-black tracking-tight font-display leading-tight">
            {t.title}
          </h2>
          <p className="mt-4 text-base sm:text-lg text-white/80">{t.text}</p>
        </div>

        <ul className="mt-10 grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-4">
          {t.points.map(([title, text], i) => {
            const Icon = ICONS[i];
            return (
              <li key={title} className="p-5 rounded-2xl bg-white/10 border border-white/15 backdrop-blur-md">
                <Icon className="w-6 h-6 text-amber-300" aria-hidden />
                <h3 className="mt-3 font-bold">{title}</h3>
                <p className="mt-1 text-sm text-white/75">{text}</p>
              </li>
            );
          })}
        </ul>

        <Link
          href={`/${l}/vehicles`}
          className="mt-10 inline-flex items-center gap-2 px-7 py-4 rounded-2xl bg-white text-slate-950 text-sm font-extrabold hover:bg-amber-300 transition-colors shadow-xl"
        >
          {t.cta}
          <ArrowRight className="w-4 h-4 rtl-flip" aria-hidden />
        </Link>
      </div>
    </section>
  );
}
