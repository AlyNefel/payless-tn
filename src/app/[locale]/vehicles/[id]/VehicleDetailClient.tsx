"use client";

import { localDay } from "@/lib/localDay";
import React, { useState, useEffect } from "react";
import { motion } from "framer-motion";
import {
  Car, Users, Fuel, Settings, Shield, Star, MapPin,
  Calendar, ChevronLeft, ChevronRight, Zap, Check, ArrowRight,
  Phone, Gauge, Wind, Luggage, Key
} from "lucide-react";
import { useRouter } from "next/navigation";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { formatPrice } from "@/lib/utils";
import { cn } from "@/lib/utils";
import { CarSpinner } from "@/components/ui/CarSpinner";
import { useCompanySettings } from "@/contexts/CompanySettingsContext";
import { OptionIcon } from "@/components/ui/OptionIcon";
import { isPerDayPricing } from "@/lib/extras";
import { VehicleImage, VEHICLE_PLACEHOLDER } from "@/components/ui/VehicleImage";
import { calculateSeasonalRentalTotal, getVehicleEffectiveDailyRate, minDaysFor, type PriceSegment } from "@/lib/seasonalPricing";
import { useRentalRules } from "@/lib/useRentalRules";
import {
  getVehicleFeatureLabel,
  getVehicleFuelLabel,
  getVehicleTransmissionLabel,
} from "@/lib/vehicleTranslations";

interface AvailableOption {
  _id: string;
  name: { fr: string; en: string; ar: string };
  icon?: string;
  price: number;
  pricingType?: string;
}

interface Vehicle {
  _id: string;
  brand: string;
  model: string;
  year: number;
  category?: string;
  categoryId?: { _id: string; name: { fr: string; en: string; ar: string }; slug: string };
  transmission: string;
  fuelType: string;
  seats: number;
  doors: number;
  luggageCapacity?: number;
  luggage?: number;
  hasAirConditioning?: boolean;
  airConditioning?: boolean;
  features: string[];
  images: any[];
  pricing: {
    daily: number;
    weekly?: number;
    monthly?: number;
    deposit?: number;
    currency?: string;
  };
  deposit?: number;
  status: string;
  availableUnits?: number;
  totalUnits?: number;
  description?: { en: string; fr: string; ar: string };
  color?: string;
  mileagePolicy?: string;
  minDriverAge?: number;
}

interface Props {
  vehicleId: string;
  locale: string;
  /** Vehicle rendered on the server (SEO + no loading spinner). */
  initialVehicle?: Vehicle | null;
}

export function VehicleDetailClient({ vehicleId, locale, initialVehicle }: Props) {
  const router = useRouter();
  const { settings } = useCompanySettings();
  const [vehicle, setVehicle] = useState<Vehicle | null>(initialVehicle ?? null);
  const [loading, setLoading] = useState(!initialVehicle);
  const [activeImage, setActiveImage] = useState(0);
  const [pickupDate, setPickupDate] = useState("");
  const [returnDate, setReturnDate] = useState("");
  const [rentalDays, setRentalDays] = useState(0);
  // Mixed price over two periods: one line per rate ("3 jours × 100 TND").
  const [segments, setSegments] = useState<PriceSegment[]>([]);
  const [totalPrice, setTotalPrice] = useState(0);
  const [options, setOptions] = useState<AvailableOption[]>([]);
  // Fleet-wide rules (pricing periods, minimum duration), live from the back office.
  const { rules: liveRules } = useRentalRules();
  const rulesKey = JSON.stringify(liveRules);
  const withRules = <T extends { minRentalDays?: number; pricing?: any }>(v: T): T => ({
    ...v,
    minRentalDays: Math.max(Number(v.minRentalDays || v.pricing?.minRentalDays || 1), liveRules.minRentalDaysGlobal),
    pricing: { ...(v.pricing || {}), globalSeasons: liveRules.seasons },
  });

  useEffect(() => {
    fetch("/api/extras")
      .then((r) => r.json())
      .then((j) => setOptions(Array.isArray(j.extras) ? j.extras : []))
      .catch(() => {});
  }, []);

  useEffect(() => {
    if (initialVehicle) return;
    async function fetchVehicle() {
      try {
        let res = await fetch(`/api/vehicles/${vehicleId}`);
        if (!res.ok) {
          res = await fetch(`/api/vehicles?vehicleId=${vehicleId}`);
        }
        if (!res.ok) throw new Error("Not found");
        const data = await res.json();
        const v = data.vehicle || data.data?.[0] || data.vehicles?.[0] || data.data;
        if (!v) throw new Error("Not found");
        setVehicle(v);
      } catch {
        setVehicle(null);
      } finally {
        setLoading(false);
      }
    }
    fetchVehicle();
  }, [vehicleId, initialVehicle]);

  useEffect(() => {
    if (pickupDate && returnDate && vehicle) {
      const pickup = new Date(pickupDate);
      const ret = new Date(returnDate);
      if (ret > pickup) {
        // Same pricing engine as the booking wizard and the booking API (seasonal daily rates).
        const { subtotal, days, segments: segs } = calculateSeasonalRentalTotal(withRules(vehicle as any), pickupDate, returnDate);
        setRentalDays(days);
        setSegments(segs);
        setTotalPrice(subtotal);
      }
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [pickupDate, returnDate, vehicle, rulesKey]);

  // Exact availability for the chosen dates (same engine as the booking API).
  const [periodStock, setPeriodStock] = useState<{ available: number; checked: string } | null>(null);
  // Re-checked when the customer comes back to the tab (another booking may have taken the last car).
  const [stockTick, setStockTick] = useState(0);
  useEffect(() => {
    const again = () => document.visibilityState === "visible" && setStockTick((t) => t + 1);
    window.addEventListener("focus", again);
    document.addEventListener("visibilitychange", again);
    const timer = window.setInterval(again, 60_000);
    return () => {
      window.removeEventListener("focus", again);
      document.removeEventListener("visibilitychange", again);
      window.clearInterval(timer);
    };
  }, []);
  useEffect(() => {
    const q = new URLSearchParams(window.location.search);
    if (q.get("pickupDate")) setPickupDate(q.get("pickupDate") || "");
    if (q.get("returnDate")) setReturnDate(q.get("returnDate") || "");
  }, []);
  useEffect(() => {
    if (!pickupDate || !returnDate || returnDate <= pickupDate) {
      setPeriodStock(null);
      return;
    }
    let alive = true;
    const key = `${pickupDate}|${returnDate}`;
    fetch(`/api/vehicles/${vehicleId}?pickupDate=${pickupDate}&returnDate=${returnDate}`, { cache: "no-store" })
      .then((r) => r.json())
      .then((d) => {
        if (alive) setPeriodStock({ available: Number(d.vehicle?.availableUnits ?? 0), checked: key });
      })
      .catch(() => alive && setPeriodStock(null));
    return () => {
      alive = false;
    };
  }, [pickupDate, returnDate, vehicleId, stockTick]);
  const soldOutForPeriod = periodStock !== null && periodStock.available <= 0;

  const requiredMinDays = vehicle ? minDaysFor(withRules(vehicle as any), pickupDate || undefined) : 1;
  const belowMinimum = Boolean(pickupDate && returnDate && rentalDays > 0 && rentalDays < requiredMinDays);
  const handleBook = () => {
    if (soldOutForPeriod || belowMinimum) return;
    const params = new URLSearchParams({ vehicleId });
    if (pickupDate) params.set("pickupDate", pickupDate);
    if (returnDate) params.set("returnDate", returnDate);
    router.push(`/${locale}/booking?${params.toString()}`);
  };

  if (loading) {
    return (
      <div className="min-h-screen bg-[#0A0A0B] flex items-center justify-center">
        <CarSpinner size="xl" label="Chargement des caractéristiques du véhicule..." />
      </div>
    );
  }

  const rawImages = vehicle?.images || [];
  const images: string[] = rawImages.length
    ? rawImages.map((img: any) => (typeof img === "string" ? img : img.url || VEHICLE_PLACEHOLDER))
    : [VEHICLE_PLACEHOLDER];
  const isRTL = locale === "ar";

  // Amounts are stored in minor units (1 TND = 100).
  // Rate in force on the chosen pickup day (today when no date is chosen yet).
  const rawDaily = vehicle ? getVehicleEffectiveDailyRate(withRules(vehicle as any), pickupDate || undefined) || vehicle.pricing?.daily || 0 : 0;
  const dailyTND = Math.round(rawDaily / 100);
  const dailyEUR = Math.round(dailyTND / 3.35);
  const rawDeposit = vehicle?.pricing?.deposit || vehicle?.deposit || 0;
  const depositTND = Math.round(rawDeposit / 100);
  const availableCount = periodStock ? periodStock.available : vehicle?.availableUnits ?? 0;
  const categoryName = vehicle?.categoryId?.name?.[locale as "fr" | "en" | "ar"] || vehicle?.categoryId?.name?.fr || vehicle?.category || "Véhicule";

  const specLabels: Record<string, { fr: string; en: string; ar: string }> = {
    transmission: { fr: "Transmission", en: "Transmission", ar: "ناقل الحركة" },
    fuel: { fr: "Carburant", en: "Fuel Type", ar: "نوع الوقود" },
    seats: { fr: "Places", en: "Seats", ar: "المقاعد" },
    luggage: { fr: "Bagages", en: "Luggage", ar: "الأمتعة" },
    ac: { fr: "Climatisation", en: "Air Conditioning", ar: "مكيف الهواء" },
    year: { fr: "Année", en: "Year", ar: "السنة" },
    doors: { fr: "Portes", en: "Doors", ar: "الأبواب" },
  };

  const getLabel = (key: string) => specLabels[key]?.[locale as "fr" | "en" | "ar"] ?? specLabels[key]?.en ?? key;

  return (
    <div className={cn("min-h-screen bg-[#0A0A0B] text-white", isRTL && "rtl")}>
      {/* Back button */}
      <div className="pt-20 sm:pt-24 pb-4 px-4 sm:px-6 max-w-7xl mx-auto">
        <button
          onClick={() => router.back()}
          className="flex items-center gap-2 text-white/60 hover:text-white transition-colors"
        >
          <ChevronLeft className="h-4 w-4" />
          <span className="text-sm">
            {locale === "fr" ? "Retour au catalogue" : locale === "ar" ? "العودة إلى الأسطول" : "Back to fleet"}
          </span>
        </button>
      </div>

      <div className="max-w-7xl mx-auto px-4 sm:px-6 pb-16 sm:pb-20">
        {!vehicle ? (
          <div className="text-center py-20">
            <Car className="h-16 w-16 text-white/20 mx-auto mb-4" />
            <h2 className="text-2xl font-bold text-white mb-2">
              {locale === "fr" ? "Véhicule introuvable" : locale === "ar" ? "السيارة غير موجودة" : "Vehicle Not Found"}
            </h2>
            <p className="text-white/60 mb-6">
              {locale === "fr" ? "Ce véhicule n'est plus disponible actuellement." : locale === "ar" ? "هذه السيارة قد لا تكون متاحة حالياً." : "This vehicle may no longer be available."}
            </p>
            <Button onClick={() => router.push(`/${locale}/vehicles`)}>
              {locale === "fr" ? "Voir toute la flotte" : locale === "ar" ? "تصفح الأسطول" : "Browse Fleet"}
            </Button>
          </div>
        ) : (
          <div className="grid grid-cols-1 lg:grid-cols-3 gap-8 lg:gap-10">
            {/* Left: Images + Info */}
            <div className="lg:col-span-2 space-y-8">
              {/* Header */}
              <motion.div
                initial={{ opacity: 0, y: 20 }}
                animate={{ opacity: 1, y: 0 }}
                transition={{ duration: 0.5 }}
              >
                <div className="flex items-start justify-between flex-wrap gap-4">
                  <div>
                    <div className="flex items-center gap-2 mb-2">
                      <Badge variant="secondary">{categoryName}</Badge>
                      {soldOutForPeriod ? (
                        <Badge variant="default" className="bg-red-500/20 text-red-400 border border-red-500/30">
                          {locale === "ar" ? "نفدت في هذه التواريخ" : locale === "en" ? "Sold out for these dates" : "Épuisée à ces dates"}
                        </Badge>
                      ) : availableCount > 0 ? (
                        <Badge variant="default" className="bg-emerald-500/20 text-emerald-400 border border-emerald-500/30">
                          ✓ {availableCount}{" "}
                          {periodStock
                            ? locale === "ar" ? "متوفرة لتواريخك" : locale === "en" ? "available for your dates" : "disponible(s) pour vos dates"
                            : locale === "ar" ? "سيارات في الخدمة" : locale === "en" ? "cars in service" : "véhicule(s) en service"}
                        </Badge>
                      ) : null}
                    </div>
                    <h1 className="text-2xl sm:text-3xl md:text-4xl lg:text-5xl font-bold font-display text-white tracking-tight">
                      {vehicle.brand} <span className="text-amber-400">{vehicle.model}</span>
                    </h1>
                  </div>
                  <div className="text-right">
                    <p className="text-white/40 text-sm mb-1">
                      {locale === "fr" ? "À partir de" : locale === "ar" ? "يبدأ من" : "Starting from"}
                    </p>
                    <p className="text-3xl font-black text-amber-400">
                      {dailyTND} <span className="text-sm font-bold">TND</span>
                    </p>
                    <p className="text-white/40 text-xs">
                      ≈ {dailyEUR} € {locale === "fr" ? "/ jour" : locale === "ar" ? "/ يوم" : "/ day"}
                    </p>
                  </div>
                </div>
              </motion.div>

              {/* Image Gallery */}
              <motion.div
                initial={{ opacity: 0, y: 20 }}
                animate={{ opacity: 1, y: 0 }}
                transition={{ duration: 0.5, delay: 0.1 }}
                className="relative"
              >
                <div className="relative aspect-[4/3] sm:aspect-[16/10] rounded-2xl overflow-hidden bg-white border border-white/10">
                  <VehicleImage
                    src={images[activeImage]}
                    alt={`${vehicle.brand} ${vehicle.model} — photo ${activeImage + 1}`}
                    fill
                    sizes="(min-width: 1024px) 66vw, 100vw"
                    className="object-contain p-2 sm:p-4"
                    priority={activeImage === 0}
                  />
                  {/* Navigation */}
                  {images.length > 1 && (
                    <>
                      <button
                        onClick={() => setActiveImage((i) => (i - 1 + images.length) % images.length)}
                        aria-label={locale === "en" ? "Previous photo" : locale === "ar" ? "الصورة السابقة" : "Photo précédente"}
                        className="absolute left-4 top-1/2 -translate-y-1/2 w-10 h-10 bg-black/60 backdrop-blur rounded-full flex items-center justify-center text-white hover:bg-black/80 transition-colors"
                      >
                        <ChevronLeft className="h-5 w-5" />
                      </button>
                      <button
                        onClick={() => setActiveImage((i) => (i + 1) % images.length)}
                        aria-label={locale === "en" ? "Next photo" : locale === "ar" ? "الصورة التالية" : "Photo suivante"}
                        className="absolute right-4 top-1/2 -translate-y-1/2 w-10 h-10 bg-black/60 backdrop-blur rounded-full flex items-center justify-center text-white hover:bg-black/80 transition-colors"
                      >
                        <ChevronRight className="h-5 w-5" />
                      </button>
                    </>
                  )}
                  <div className="absolute bottom-4 right-4 bg-black/60 backdrop-blur rounded-lg px-3 py-1 text-sm text-white">
                    {activeImage + 1} / {images.length}
                  </div>
                </div>
                {/* Thumbnails */}
                {images.length > 1 && (
                  <div className="flex gap-3 mt-3 overflow-x-auto pb-2">
                    {images.map((img, i) => (
                      <button
                        key={i}
                        onClick={() => setActiveImage(i)}
                        className={cn(
                          "relative flex-shrink-0 w-24 h-16 rounded-lg overflow-hidden border-2 transition-all",
                          i === activeImage ? "border-[#1D4ED8]" : "border-white/10 opacity-60 hover:opacity-100"
                        )}
                      >
                        <VehicleImage src={img} alt="" fill sizes="96px" className="object-cover" />
                      </button>
                    ))}
                  </div>
                )}
              </motion.div>

              {/* Specs Grid */}
              <motion.div
                initial={{ opacity: 0, y: 20 }}
                animate={{ opacity: 1, y: 0 }}
                transition={{ duration: 0.5, delay: 0.2 }}
              >
                <h2 className="text-xl font-semibold text-white mb-4">
                  {locale === "fr" ? "Caractéristiques" : locale === "ar" ? "المواصفات" : "Specifications"}
                </h2>
                <div className="grid grid-cols-2 sm:grid-cols-4 gap-4">
                  {[
                    { icon: Settings, label: getLabel("transmission"), value: getVehicleTransmissionLabel(vehicle.transmission, locale) },
                    { icon: Fuel, label: getLabel("fuel"), value: getVehicleFuelLabel(vehicle.fuelType, locale) },
                    { icon: Users, label: getLabel("seats"), value: `${vehicle.seats} ${locale === "fr" ? "places" : locale === "ar" ? "مقاعد" : "seats"}` },
                    { icon: Luggage, label: getLabel("luggage"), value: `${vehicle.luggageCapacity ?? vehicle.luggage ?? 2} ${locale === "fr" ? "valises" : locale === "ar" ? "حقائب" : "bags"}` },
                    { icon: Wind, label: getLabel("ac"), value: (vehicle.hasAirConditioning ?? vehicle.airConditioning ?? true) ? (locale === "fr" ? "Oui" : locale === "ar" ? "نعم" : "Yes") : (locale === "fr" ? "Non" : locale === "ar" ? "لا" : "No") },
                    { icon: Car, label: getLabel("doors"), value: `${vehicle.doors}` },
                    { icon: Gauge, label: locale === "fr" ? "Catégorie" : locale === "ar" ? "الفئة" : "Category", value: vehicle.category },
                  ].map((spec, i) => (
                    <div
                      key={i}
                      className="bg-white/5 border border-white/10 rounded-xl p-4 hover:border-[#1D4ED8]/40 transition-colors"
                    >
                      <spec.icon className="h-5 w-5 text-[#1D4ED8] mb-2" />
                      <p className="text-white/40 text-xs">{spec.label}</p>
                      <p className="text-white font-semibold text-sm mt-0.5">{spec.value}</p>
                    </div>
                  ))}
                </div>
              </motion.div>

              {/* Features */}
              {vehicle.features.length > 0 && (
                <motion.div
                  initial={{ opacity: 0, y: 20 }}
                  animate={{ opacity: 1, y: 0 }}
                  transition={{ duration: 0.5, delay: 0.3 }}
                >
                  <h2 className="text-xl font-semibold text-white mb-4">
                    {locale === "fr" ? "Équipements inclus" : locale === "ar" ? "المميزات المضمنة" : "Included Features"}
                  </h2>
                  <div className="flex flex-wrap gap-2">
                    {vehicle.features.map((feature, i) => (
                      <div
                        key={i}
                        className="flex items-center gap-1.5 bg-[#1D4ED8]/10 border border-[#1D4ED8]/20 rounded-lg px-3 py-1.5"
                      >
                        <Check className="h-3.5 w-3.5 text-[#1D4ED8]" />
                        <span className="text-sm text-white/80">{getVehicleFeatureLabel(feature, locale)}</span>
                      </div>
                    ))}
                  </div>
                </motion.div>
              )}

              {/* Bookable options (same icons as the booking wizard) */}
              {options.length > 0 && (
                <section aria-labelledby="vehicle-options-title">
                  <h2 id="vehicle-options-title" className="text-xl font-semibold text-white mb-4">
                    {locale === "fr" ? "Options disponibles" : locale === "ar" ? "الخيارات المتاحة" : "Available options"}
                  </h2>
                  <ul className="grid grid-cols-1 sm:grid-cols-2 gap-2">
                    {options.map((opt) => (
                      <li
                        key={opt._id}
                        className="flex items-center gap-3 bg-white/5 border border-white/10 rounded-xl px-3 py-2"
                      >
                        <OptionIcon icon={opt.icon} size="sm" />
                        <span className="flex-1 min-w-0 text-sm text-white/80 break-words">
                          {opt.name[locale as "fr" | "en" | "ar"] || opt.name.fr}
                        </span>
                        <span className="text-xs font-mono text-[#D4AF37] shrink-0">
                          {opt.price === 0
                            ? locale === "en" ? "Free" : locale === "ar" ? "مجاناً" : "Offert"
                            : `${Math.round(opt.price / 100)} TND${isPerDayPricing(opt.pricingType) ? (locale === "en" ? "/day" : locale === "ar" ? "/يوم" : "/j") : ""}`}
                        </span>
                      </li>
                    ))}
                  </ul>
                </section>
              )}

              {/* Description */}
              {vehicle.description && (
                <motion.div
                  initial={{ opacity: 0, y: 20 }}
                  animate={{ opacity: 1, y: 0 }}
                  transition={{ duration: 0.5, delay: 0.35 }}
                >
                  <h2 className="text-xl font-semibold text-white mb-3">
                    {locale === "fr" ? "Description" : locale === "ar" ? "الوصف" : "Description"}
                  </h2>
                  <p className="text-white/60 leading-relaxed">
                    {vehicle.description[locale as "fr" | "en" | "ar"] || vehicle.description.fr}
                  </p>
                </motion.div>
              )}

              {/* Included Services */}
              <motion.div
                initial={{ opacity: 0, y: 20 }}
                animate={{ opacity: 1, y: 0 }}
                transition={{ duration: 0.5, delay: 0.4 }}
              >
                <h2 className="text-xl font-semibold text-white mb-4">
                  {locale === "fr" ? "Services inclus" : locale === "ar" ? "الخدمات المشمولة" : "Included Services"}
                </h2>
                <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
                  {[
                    { icon: Shield, text: locale === "fr" ? "Assurance de base incluse" : locale === "ar" ? "التأمين الأساسي مشمول" : "Basic insurance included" },
                    { icon: Zap, text: locale === "fr" ? "Assistance 24h/24, 7j/7" : locale === "ar" ? "مساعدة على الطريق 24/7" : "24/7 roadside assistance" },
                    { icon: MapPin, text: locale === "fr" ? "Livraison à l'aéroport" : locale === "ar" ? "توصيل للمطار" : "Airport delivery available" },
                    { icon: Key, text: locale === "fr" ? "Kilométrage illimité" : locale === "ar" ? "كيلومترات غير محدودة" : "Unlimited mileage" },
                    { icon: Phone, text: locale === "fr" ? "Support client dédié" : locale === "ar" ? "دعم عملاء مخصص" : "Dedicated customer support" },
                    { icon: Car, text: locale === "fr" ? "Nettoyage complet inclus" : locale === "ar" ? "تنظيف كامل مشمول" : "Full cleaning included" },
                  ].map((item, i) => (
                    <div key={i} className="flex items-center gap-3 bg-white/5 border border-white/10 rounded-lg p-3">
                      <item.icon className="h-4 w-4 text-[#D4AF37] flex-shrink-0" />
                      <span className="text-sm text-white/80">{item.text}</span>
                    </div>
                  ))}
                </div>
              </motion.div>

              {/* Pricing Tiers */}
              <motion.div
                initial={{ opacity: 0, y: 20 }}
                animate={{ opacity: 1, y: 0 }}
                transition={{ duration: 0.5, delay: 0.45 }}
              >
                <h2 className="text-xl font-semibold text-white mb-4">
                  {locale === "fr" ? "Tarifs" : locale === "ar" ? "الأسعار" : "Pricing"}
                </h2>
                <div className="grid grid-cols-1 sm:grid-cols-3 gap-4">
                  {[
                    { label: locale === "fr" ? "Par jour" : locale === "ar" ? "يومي" : "Daily", price: vehicle.pricing.daily, sub: locale === "fr" ? "Tarif hors saison spéciale" : locale === "ar" ? "خارج المواسم الخاصة" : "Outside special seasons" },
                  ].map((tier, i) => (
                    <div
                      key={i}
                      className={cn(
                        "rounded-xl border p-4 text-center",
                        i === 0
                          ? "border-[#1D4ED8]/40 bg-[#1D4ED8]/10"
                          : "border-white/10 bg-white/5"
                      )}
                    >
                      <p className="text-white/50 text-xs mb-1">{tier.label}</p>
                      <p className="text-xl font-bold text-white">{formatPrice(tier.price)}</p>
                      <p className="text-white/30 text-xs mt-1">{tier.sub}</p>
                    </div>
                  ))}
                </div>
                {((vehicle.pricing.deposit ?? vehicle.deposit ?? 0) > 0) && (
                  <p className="text-white/40 text-sm mt-3 flex items-center gap-1.5">
                    <Shield className="h-3.5 w-3.5" />
                    {locale === "fr" ? "Caution requise:" : locale === "ar" ? "التأمين المطلوب:" : "Required deposit:"}
                    {" "}<span className="text-white/70 font-medium">{formatPrice(vehicle.pricing.deposit ?? vehicle.deposit ?? 0)}</span>
                  </p>
                )}
              </motion.div>

              {/* Rental Conditions */}
              <motion.div
                initial={{ opacity: 0, y: 20 }}
                animate={{ opacity: 1, y: 0 }}
                transition={{ duration: 0.5, delay: 0.5 }}
                className="bg-[#1D4ED8]/5 border border-[#1D4ED8]/20 rounded-xl p-6"
              >
                <h2 className="text-lg font-semibold text-white mb-4">
                  {locale === "fr" ? "Conditions de location" : locale === "ar" ? "شروط الإيجار" : "Rental Conditions"}
                </h2>
                <ul className="space-y-2 text-sm text-white/60">
                  {[
                    locale === "fr" ? "Âge minimum: 21 ans (23 ans pour certains véhicules)" : locale === "ar" ? "الحد الأدنى للسن: 21 سنة (23 لبعض السيارات)" : "Minimum age: 21 years (23 for some vehicles)",
                    locale === "fr" ? "Permis de conduire valide requis (2 ans minimum)" : locale === "ar" ? "رخصة قيادة سارية مطلوبة (سنتان على الأقل)" : "Valid driver's license required (min. 2 years)",
                    locale === "fr" ? "Carte de crédit ou caution en espèces exigée" : locale === "ar" ? "بطاقة ائتمان أو تأمين نقدي مطلوب" : "Credit card or cash deposit required",
                    locale === "fr" ? "Carburant: voiture doit être rendue avec le même niveau" : locale === "ar" ? "الوقود: يجب إعادة السيارة بنفس مستوى الوقود" : "Fuel policy: full-to-full",
                    locale === "fr" ? "Dégâts: responsabilité du locataire sauf assurance complémentaire" : locale === "ar" ? "الأضرار: مسؤولية المستأجر ما لم يكن هناك تأمين إضافي" : "Damage: renter's responsibility unless extra insurance purchased",
                  ].map((c, i) => (
                    <li key={i} className="flex items-start gap-2">
                      <div className="w-1.5 h-1.5 bg-[#1D4ED8] rounded-full mt-2 flex-shrink-0" />
                      {c}
                    </li>
                  ))}
                </ul>
              </motion.div>
            </div>

            {/* Right: Sticky Booking Widget */}
            <div className="lg:col-span-1">
              <motion.div
                initial={{ opacity: 0, x: 20 }}
                animate={{ opacity: 1, x: 0 }}
                transition={{ duration: 0.5, delay: 0.2 }}
                className="sticky top-24"
              >
                <div className="bg-white/5 border border-white/10 rounded-2xl p-6 backdrop-blur-sm">
                  <h3 className="text-lg font-semibold text-white mb-1">
                    {locale === "fr" ? "Réserver ce véhicule" : locale === "ar" ? "احجز هذه السيارة" : "Book This Vehicle"}
                  </h3>
                  <p className="text-white/40 text-sm mb-5">
                    {locale === "fr" ? "Sélectionnez vos dates" : locale === "ar" ? "اختر تواريخك" : "Select your dates"}
                  </p>

                  <div className="space-y-4">
                    <div>
                      <label className="block text-xs text-white/50 mb-1.5 uppercase tracking-wide">
                        {locale === "fr" ? "Date de prise en charge" : locale === "ar" ? "تاريخ الاستلام" : "Pickup Date"}
                      </label>
                      <input
                        type="date"
                        value={pickupDate}
                        min={localDay()}
                        onChange={(e) => setPickupDate(e.target.value)}
                        className="w-full h-10 rounded-lg border border-white/10 bg-white/5 px-3 text-sm text-white focus:outline-none focus:ring-2 focus:ring-[#1D4ED8] [color-scheme:dark]"
                      />
                    </div>
                    <div>
                      <label className="block text-xs text-white/50 mb-1.5 uppercase tracking-wide">
                        {locale === "fr" ? "Date de retour" : locale === "ar" ? "تاريخ الإعادة" : "Return Date"}
                      </label>
                      <input
                        type="date"
                        value={returnDate}
                        min={pickupDate || localDay()}
                        onChange={(e) => setReturnDate(e.target.value)}
                        className="w-full h-10 rounded-lg border border-white/10 bg-white/5 px-3 text-sm text-white focus:outline-none focus:ring-2 focus:ring-[#1D4ED8] [color-scheme:dark]"
                      />
                    </div>

                    {rentalDays > 0 && (
                      <div className="bg-[#1D4ED8]/10 border border-[#1D4ED8]/20 rounded-xl p-4 space-y-2">
                        <div className="flex justify-between text-sm">
                          <span className="text-white/60">
                            {rentalDays} {locale === "fr" ? "jours" : locale === "ar" ? "أيام" : "days"}
                          </span>
                          <span className="text-white font-medium">{`${Math.round(totalPrice / 100).toLocaleString("fr-FR")} TND`}</span>
                        </div>
                        {segments.length > 1 &&
                          segments.map((s, k) => (
                            <div key={k} className="flex justify-between text-xs text-white/50 ps-3">
                              <span>
                                {s.days} {locale === "fr" ? "j" : locale === "ar" ? "ي" : "d"} × {formatPrice(s.dailyRate)}
                                {s.name ? ` · ${s.name}` : ""}
                              </span>
                              <span>{formatPrice(s.amount)}</span>
                            </div>
                          ))}
                        {((vehicle.pricing.deposit ?? vehicle.deposit ?? 0) > 0) && (
                          <div className="flex justify-between text-sm">
                            <span className="text-white/60">
                              {locale === "fr" ? "Caution" : locale === "ar" ? "التأمين" : "Deposit"}
                            </span>
                            <span className="text-white/60">{formatPrice(vehicle.pricing.deposit ?? vehicle.deposit ?? 0)}</span>
                          </div>
                        )}
                        <div className="border-t border-white/10 pt-2 flex justify-between">
                          <span className="font-semibold text-white">Total</span>
                          <span className="font-bold text-[#D4AF37] text-lg">{`${Math.round(totalPrice / 100).toLocaleString("fr-FR")} TND`}</span>
                        </div>
                      </div>
                    )}

                    {(belowMinimum || requiredMinDays > 1) && (
                      <p role="status" className={`text-xs font-semibold ${belowMinimum ? "text-red-300" : "text-amber-300"}`}>
                        {locale === "fr"
                          ? `Durée minimale de location : ${requiredMinDays} jours`
                          : locale === "ar"
                          ? `الحد الأدنى للإيجار: ${requiredMinDays} أيام`
                          : `Minimum rental: ${requiredMinDays} days`}
                      </p>
                    )}

                    <Button
                      onClick={handleBook}
                      disabled={soldOutForPeriod || availableCount <= 0 || belowMinimum}
                      className="w-full h-12 text-base font-semibold bg-[#1D4ED8] hover:bg-[#1e40af] text-white rounded-xl"
                    >
                      {!soldOutForPeriod && availableCount > 0
                        ? locale === "fr" ? "Réserver maintenant" : locale === "ar" ? "احجز الآن" : "Book Now"
                        : locale === "fr" ? "Non disponible" : locale === "ar" ? "غير متاح" : "Unavailable"}
                      <ArrowRight className="ml-2 h-4 w-4" />
                    </Button>

                    <p className="text-center text-xs text-white/30">
                      {locale === "fr"
                        ? "Confirmation immédiate · Annulation flexible"
                        : locale === "ar"
                        ? "تأكيد فوري · إلغاء مرن"
                        : "Instant confirmation · Flexible cancellation"}
                    </p>
                  </div>

                  {/* Quick Call CTA */}
                  <div className="mt-6 pt-6 border-t border-white/10">
                    <p className="text-xs text-white/40 text-center mb-3">
                      {locale === "fr" ? "Besoin d'aide?" : locale === "ar" ? "تحتاج مساعدة؟" : "Need help?"}
                    </p>
                    <a
                      href={`tel:${settings.phone.replace(/\s+/g, "")}`}
                      className="flex items-center justify-center gap-2 w-full h-10 border border-white/10 rounded-xl text-white/70 hover:text-white hover:border-white/20 transition-colors text-sm"
                    >
                      <Phone className="h-4 w-4" />
                      {settings.phone}
                    </a>
                    <a
                      href={`https://wa.me/${settings.whatsapp.replace(/[^0-9]/g, "")}`}
                      target="_blank"
                      rel="noopener noreferrer"
                      className="flex items-center justify-center gap-2 w-full h-10 border border-[#25D366]/30 rounded-xl text-[#25D366]/80 hover:text-[#25D366] hover:border-[#25D366]/60 transition-colors text-sm mt-2"
                    >
                      WhatsApp
                    </a>
                  </div>
                </div>

                {/* Trust badges */}
                <div className="mt-4 grid grid-cols-3 gap-2 text-center">
                  {[
                    { icon: Shield, label: locale === "fr" ? "Assuré" : locale === "ar" ? "مؤمن" : "Insured" },
                    { icon: Star, label: locale === "fr" ? "Garanti" : locale === "ar" ? "مضمون" : "Guaranteed" },
                    { icon: Zap, label: locale === "fr" ? "Rapide" : locale === "ar" ? "سريع" : "Fast" },
                  ].map((b, i) => (
                    <div key={i} className="bg-white/5 rounded-xl p-3 border border-white/5">
                      <b.icon className="h-5 w-5 text-[#D4AF37] mx-auto mb-1" />
                      <p className="text-white/50 text-xs">{b.label}</p>
                    </div>
                  ))}
                </div>
              </motion.div>
            </div>
          </div>
        )}
      </div>
    </div>
  );
}
