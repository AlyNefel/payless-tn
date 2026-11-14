/**
 * FAQ content shared by the FAQ section (client) and the FAQPage JSON-LD (server).
 * Keep plain data only — no React components — so server components can import it.
 */
export type FAQIconName = "Calendar" | "CreditCard" | "FileText" | "Globe2" | "MapPin";

export interface FAQItem {
  id: string;
  icon: FAQIconName;
  question: Record<string, string>;
  answer: Record<string, string>;
  keyPoints?: Record<string, string[]>;
}

export const FAQS: FAQItem[] = [
  {
    id: "faq-docs",
    icon: "FileText",
    question: {
      fr: "Quels documents sont nécessaires pour louer une voiture ?",
      en: "What documents do I need to rent a vehicle?",
      ar: "ما هي الوثائق المطلوبة لاستئجار سيارة؟",
    },
    answer: {
      fr: "Pour louer chez Payless Tunisie (Houimli Rent a Car), vous devez présenter : un passeport valide (ou CIN pour les résidents tunisiens), un permis de conduire original valable depuis plus de 1 an (2 ans pour certains modèles), et un moyen de paiement ou carte pour la caution. Vous pouvez envoyer vos documents à l'avance sur WhatsApp (+216 25 120 130) pour un retrait express.",
      en: "To rent with Payless Tunisia (Houimli Rent a Car), you need: a valid original Passport (or Tunisian National ID for residents), a valid original Driving License held for at least 1 year, and a card or cash for deposit. You can submit scans via WhatsApp (+216 25 120 130) for express pickup.",
      ar: "لاستئجار سيارة مع باي ليس تونس: جواز سفر ساري المفعول (أو بطاقة التعريف الوطنية للتونسيين)، رخصة قيادة أصلية سارية لأكثر من سنة، وتأمين الضمان. يمكنك إرسال وثائقك مسبقاً عبر الواتساب لتسريع الاستلام.",
    },
    keyPoints: {
      fr: ["Passeport ou CIN en cours de validité", "Permis de conduire valide (min. 1 an)", "Pré-enregistrement express via WhatsApp"],
      en: ["Original Passport or National ID", "Valid Driving License (held min. 1 year)", "Express pre-clearance via WhatsApp"],
      ar: ["جواز سفر أو بطاقة هوية سارية", "رخصة قيادة سارية (أكثر من سنة)", "تسجيل مسبق سريع عبر الواتساب"],
    },
  },
  {
    id: "faq-deposit",
    icon: "CreditCard",
    question: {
      fr: "Comment fonctionne la caution et quand est-elle restituée ?",
      en: "How does the security deposit work and when is it refunded?",
      ar: "كيف يعمل الضمان المالي ومتى يتم استرجاعه؟",
    },
    answer: {
      fr: "La caution varie de 600 TND (citadines économiques) à 4 000 TND (SUV premium). Elle est bloquée comme pré-autorisation sur votre carte bancaire ou versée en espèces selon accord, et restituée immédiatement lors de la restitution du véhicule après vérification d'usage.",
      en: "Security deposits range from 600 TND (economy cars) to 4,000 TND (premium SUVs). Placed as a pre-authorization hold on your card or accepted via approved methods, it is immediately released upon vehicle inspection at return.",
      ar: "يتراوح مبلغ التأمين بين 600 د.ت (السيارات الاقتصادية) و4000 د.ت (سيارات الدفع الرباعي الفاخرة). يتم تحريره فور فحص السيارة عند إرجاعها.",
    },
    keyPoints: {
      fr: ["Montants transparents : 600 TND à 4 000 TND", "Restitution immédiate au retour", "Option rachat de franchise disponible"],
      en: ["Transparent deposits: 600 TND to 4,000 TND", "Instant release upon return", "Zero-excess waiver options available"],
      ar: ["مبالغ واضحة: من 600 إلى 4000 د.ت", "إرجاع فوري عند تسليم السيارة", "خيارات إعفاء من التأمين متوفرة"],
    },
  },
  {
    id: "faq-return-city",
    icon: "MapPin",
    question: {
      fr: "Puis-je restituer la voiture dans une autre ville ou aéroport en Tunisie ?",
      en: "Can I return the car to a different airport or city in Tunisia?",
      ar: "هل يمكنني إرجاع السيارة في مطار أو مدينة أخرى في تونس؟",
    },
    answer: {
      fr: "Oui, tout à fait. Nous proposons la location aller simple entre nos 11 agences et aéroports en Tunisie : Aéroport de Tunis-Carthage, Aéroport de Monastir, Aéroport d'Enfidha, La Soukra, Grand Tunis, Hammamet, Sousse, Sfax, Bizerte, Nabeul et Jendouba.",
      en: "Yes, absolutely. We offer flexible one-way rentals across all our 11 hubs and international airports in Tunisia: Tunis-Carthage Airport, Monastir Airport, Enfidha Airport, La Soukra, Grand Tunis, Hammamet, Sousse, Sfax, Bizerte, Nabeul, and Jendouba.",
      ar: "نعم بكل تأكيد. نوفر خدمة الإرجاع في مدينة أو مطار مختلف بين جميع فروعنا الـ 11 في تونس: مطار تونس قرطاج، مطار المنستير، مطار النفيضة، سكرة، تونس الكبرى، الحمامات، سوسة، صفاقس، بنزرت، نابل وجندوبة.",
    },
    keyPoints: {
      fr: ["11 agences et aéroports couverts", "Service 24/7 aux aéroports internationaux", "Flexibilité maximale pour vos circuits"],
      en: ["11 agencies & international airports covered", "24/7 curbside service at airports", "Maximum flexibility for your road trips"],
      ar: ["تغطية 11 فرعاً ومطاراً دولياً", "خدمة 24/7 في المطارات", "مرونة تامة لرحلاتكم"],
    },
  },
  {
    id: "faq-license",
    icon: "Globe2",
    question: {
      fr: "Les permis de conduire internationaux et étrangers sont-ils acceptés ?",
      en: "Are foreign and international driving licenses accepted in Tunisia?",
      ar: "هل تقبل رخص القيادة الأجنبية والدولية في تونس؟",
    },
    answer: {
      fr: "Oui. La Tunisie reconnaît les permis de conduire nationaux émis en caractères latins ou arabes (France, Union Européenne, Royaume-Uni, Canada, États-Unis, pays du Golfe...). Pour les permis dans d'autres alphabets, un permis de conduire international (PCI) est requis.",
      en: "Yes. Tunisia recognizes all national driving licenses written in Latin or Arabic alphabets (EU, UK, US, Canada, GCC, etc.) for tourists. For licenses written in other scripts, an International Driving Permit (IDP) accompanied by your original license is required.",
      ar: "نعم. تعترف تونس برخص القيادة الصادرة بالحروف اللاتينية أو العربية (فرنسا، الاتحاد الأوروبي، كندا، أمريكا، دول الخليج...). للغات الأخرى يُطلب تصريح قيادة دولي مع الرخصة الأصلية.",
    },
    keyPoints: {
      fr: ["Permis français et européens valables directement", "Permis des pays du Golfe acceptés", "Assistance multilingue 24/7"],
      en: ["EU, French & GCC licenses valid directly", "No extra paperwork needed for tourists", "Multilingual 24/7 assistance"],
      ar: ["رخص الاتحاد الأوروبي ودول الخليج مقبولة مباشرة", "إجراءات مبسطة للسياح", "دعم بعدة لغات على مدار الساعة"],
    },
  },
  {
    id: "faq-min-age",
    icon: "Calendar",
    question: {
      fr: "Quel est l'âge minimum requis pour louer un véhicule ?",
      en: "What is the minimum driver age to rent a vehicle?",
      ar: "ما هو الحد الأدنى لعمر السائق لاستئجار سيارة؟",
    },
    answer: {
      fr: "L'âge minimum standard est de 23 ans avec au moins 1 an d'expérience de permis. Pour certaines catégories supérieures et SUV premium, l'âge minimum est de 25 ans avec 2 ans de permis. Les sièges bébé et le 2ème conducteur sont offerts gratuitement.",
      en: "The standard minimum driver age is 23 years old with at least 1 year of driving experience (25 years old for premium SUVs). Baby seats and a 2nd driver are provided free of charge.",
      ar: "الحد الأدنى للسن هو 23 سنة مع سنة واحدة على الأقل من تاريخ الحصول على رخصة القيادة (25 سنة لسيارات الدفع الرباعي الفاخرة). مقاعد الأطفال والسائق الثاني مجاناً.",
    },
    keyPoints: {
      fr: ["23 ans minimum (25 ans pour SUV premium)", "2ème conducteur inclus gratuitement", "Sièges bébé / enfant offerts"],
      en: ["23+ years old (25+ for premium SUVs)", "2nd driver included for free", "Complimentary baby / child seats"],
      ar: ["23 سنة على الأقل (25 سنة للدفع الرباعي)", "سائق إضافي مجاني", "مقاعد أطفال مجانية"],
    },
  },
];

/** Applies the agency name / WhatsApp number exactly as the FAQ section renders them. */
export function personalizeFaqText(text: string, agencyName: string, whatsapp: string): string {
  return text
    .replace(/Payless Tunisie/g, agencyName)
    .replace(/Payless Tunisia/g, agencyName)
    .replace(/\+216 25 120 130/g, whatsapp);
}
