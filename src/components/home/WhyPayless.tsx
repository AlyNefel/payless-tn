import Image from "next/image";
import Link from "next/link";
import { ArrowRight, BadgePercent, Plane, ReceiptText, CarFront, Headset } from "lucide-react";

type L = "fr" | "en" | "ar";

const IMG = (id: string) => `https://images.unsplash.com/photo-${id}?auto=format&fit=crop&w=1200&q=70`;

const COPY = {
  fr: {
    eyebrow: "Pourquoi Payless ?",
    title: "Louez malin, roulez serein",
    subtitle: "Tout ce qu'il faut pour un séjour sans stress en Tunisie, du terminal jusqu'au retour des clés.",
    cta: "Réserver maintenant",
    items: [
      ["Les meilleurs prix en Tunisie", "Des tarifs directs d'agence, sans intermédiaire, avec le prix total affiché avant de réserver."],
      ["Livraison à l'aéroport", "Votre voiture vous attend à l'arrivée : Tunis-Carthage, Monastir, Enfidha et plus."],
      ["Aucun frais caché", "Timbre, taxes et frais de livraison détaillés au récapitulatif. Ce que vous voyez est ce que vous payez."],
      ["Une flotte moderne", "Des modèles récents, entretenus et contrôlés régulièrement par notre garage."],
      ["Assistance 24/7", "Une équipe joignable à toute heure par téléphone et WhatsApp pendant votre location."],
    ],
  },
  en: {
    eyebrow: "Why Payless?",
    title: "Rent smart, drive relaxed",
    subtitle: "Everything you need for a stress-free trip in Tunisia, from the terminal to the key return.",
    cta: "Book now",
    items: [
      ["Best prices in Tunisia", "Direct agency rates, no middleman, with the full price shown before you book."],
      ["Airport delivery", "Your car waits for you on arrival: Tunis-Carthage, Monastir, Enfidha and more."],
      ["No hidden fees", "Stamp duty, taxes and delivery fees itemised in the summary. What you see is what you pay."],
      ["Modern fleet", "Recent models, serviced and inspected regularly by our own garage."],
      ["24/7 support", "A team you can reach any time by phone and WhatsApp during your rental."],
    ],
  },
  ar: {
    eyebrow: "لماذا Payless؟",
    title: "استأجر بذكاء وقُد براحة",
    subtitle: "كل ما تحتاجه لرحلة مريحة في تونس، من المطار حتى إرجاع المفاتيح.",
    cta: "احجز الآن",
    items: [
      ["أفضل الأسعار في تونس", "أسعار مباشرة من الوكالة بدون وسيط، مع عرض السعر الكامل قبل الحجز."],
      ["التسليم في المطار", "سيارتك في انتظارك عند الوصول: تونس قرطاج، المنستير، النفيضة وغيرها."],
      ["بدون رسوم خفية", "الطابع الجبائي والضرائب ورسوم التوصيل مفصلة في الملخص."],
      ["أسطول حديث", "موديلات حديثة تتم صيانتها وفحصها بانتظام في ورشتنا."],
      ["مساعدة 24/7", "فريق متاح في أي وقت عبر الهاتف وواتساب طوال مدة الإيجار."],
    ],
  },
} as const;

const VISUALS = [
  { icon: BadgePercent, img: IMG("1533473359331-0135ef1b58bf"), accent: "from-amber-500 to-orange-500" },
  { icon: Plane, img: IMG("1436491865332-7a61a109cc05"), accent: "from-sky-500 to-blue-600" },
  { icon: ReceiptText, img: IMG("1556742049-0cfed4f6a45d"), accent: "from-emerald-500 to-teal-600" },
  { icon: CarFront, img: IMG("1549317661-bd32c8ce0db2"), accent: "from-indigo-500 to-violet-600" },
  { icon: Headset, img: IMG("1449965408869-eaa3f722e40d"), accent: "from-rose-500 to-pink-600" },
];

/** Section A — replaces the duplicated vehicle grid with the five reasons to book direct. */
export function WhyPayless({ locale }: { locale: string }) {
  const l = (["fr", "en", "ar"].includes(locale) ? locale : "fr") as L;
  const t = COPY[l];

  return (
    <section aria-labelledby="why-payless" className="py-16 sm:py-24 bg-background">
      <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8">
        <div className="flex flex-col lg:flex-row lg:items-end justify-between gap-6 mb-10">
          <div className="max-w-2xl">
            <p className="text-xs font-bold uppercase tracking-[0.2em] text-blue-600 dark:text-blue-400">{t.eyebrow}</p>
            <h2 id="why-payless" className="mt-2 text-3xl sm:text-4xl lg:text-5xl font-black tracking-tight text-foreground font-display">
              {t.title}
            </h2>
            <p className="mt-3 text-base text-muted-foreground">{t.subtitle}</p>
          </div>
          <Link
            href={`/${l}/booking`}
            className="inline-flex items-center justify-center gap-2 self-start lg:self-auto px-6 py-3.5 rounded-2xl bg-blue-600 hover:bg-blue-500 text-white text-sm font-bold shadow-lg shadow-blue-600/25 transition-colors"
          >
            {t.cta}
            <ArrowRight className="w-4 h-4 rtl-flip" aria-hidden />
          </Link>
        </div>

        <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-6 gap-4 sm:gap-5">
          {t.items.map(([title, text], i) => {
            const v = VISUALS[i];
            const Icon = v.icon;
            // Bento layout: two large cards on top, three below (desktop).
            const span = i < 2 ? "lg:col-span-3" : "lg:col-span-2";
            return (
              <article
                key={title}
                className={`group relative overflow-hidden rounded-3xl min-h-[260px] sm:min-h-[300px] ${span} ${i === 4 ? "sm:col-span-2 lg:col-span-2" : ""}`}
              >
                <Image
                  src={v.img}
                  alt=""
                  fill
                  sizes={i < 2 ? "(min-width:1024px) 50vw, (min-width:640px) 50vw, 100vw" : "(min-width:1024px) 33vw, (min-width:640px) 50vw, 100vw"}
                  className="object-cover transition-transform duration-700 group-hover:scale-105"
                />
                <div className="absolute inset-0 bg-gradient-to-t from-black/85 via-black/45 to-black/10" />
                <div className="relative h-full flex flex-col justify-end p-6 text-white">
                  <span className={`inline-flex w-11 h-11 items-center justify-center rounded-2xl bg-gradient-to-br ${v.accent} shadow-lg mb-4`}>
                    <Icon className="w-5 h-5" aria-hidden />
                  </span>
                  <h3 className="text-xl font-extrabold">{title}</h3>
                  <p className="mt-1.5 text-sm text-white/85 leading-relaxed max-w-md">{text}</p>
                </div>
              </article>
            );
          })}
        </div>
      </div>
    </section>
  );
}
