export type VehicleLocale = "fr" | "en" | "ar";

type TranslationSet = Record<VehicleLocale, string>;

const transmissionLabels: Record<string, TranslationSet> = {
  automatic: { fr: "Automatique", en: "Automatic", ar: "أوتوماتيك" },
  manual: { fr: "Manuelle", en: "Manual", ar: "يدوي" },
};

const fuelLabels: Record<string, TranslationSet> = {
  gasoline: { fr: "Essence", en: "Gasoline", ar: "بنزين" },
  diesel: { fr: "Diesel", en: "Diesel", ar: "ديزل" },
  electric: { fr: "Électrique", en: "Electric", ar: "كهربائي" },
  hybrid: { fr: "Hybride", en: "Hybrid", ar: "هجين" },
};

const featureLabels: Record<string, TranslationSet> = {
  air_conditioning: { fr: "Climatisation", en: "Air conditioning", ar: "تكييف الهواء" },
  airbags: { fr: "Airbags", en: "Airbags", ar: "وسائد هوائية" },
  power_steering: { fr: "Direction assistée", en: "Power steering", ar: "توجيه معزز" },
  audio_bluetooth: {
    fr: "Système audio HD / Bluetooth",
    en: "HD audio system / Bluetooth",
    ar: "نظام صوت عالي الدقة / بلوتوث",
  },
  bluetooth: { fr: "Bluetooth", en: "Bluetooth", ar: "بلوتوث" },
  central_locking: { fr: "Verrouillage centralisé", en: "Central locking", ar: "قفل مركزي" },
  electric_windows: { fr: "Vitres électriques", en: "Power windows", ar: "نوافذ كهربائية" },
  abs: { fr: "ABS", en: "ABS", ar: "ABS" },
  gps: { fr: "GPS", en: "GPS", ar: "GPS" },
  usb: { fr: "USB", en: "USB", ar: "USB" },
};

function normalize(value: string): string {
  return value
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .toLowerCase()
    .trim();
}

function getLocale(locale: string): VehicleLocale {
  return locale === "en" || locale === "ar" ? locale : "fr";
}

export function getVehicleTransmissionLabel(value: string, locale: string): string {
  const normalized = normalize(value);
  const key =
    /^(automatic|automatique|auto|bva)$/.test(normalized)
      ? "automatic"
      : /^(manual|manuelle|manu|bvm)$/.test(normalized)
        ? "manual"
        : null;
  return key ? transmissionLabels[key][getLocale(locale)] : value;
}

export function getVehicleFuelLabel(value: string, locale: string): string {
  const normalized = normalize(value);
  const key =
    /^(gasoline|petrol|essence)$/.test(normalized)
      ? "gasoline"
      : /^(diesel|gazole)$/.test(normalized)
        ? "diesel"
        : /^(electric|electrique)$/.test(normalized)
          ? "electric"
          : /^(hybrid|hybride)$/.test(normalized)
            ? "hybrid"
            : null;
  return key ? fuelLabels[key][getLocale(locale)] : value;
}

export function getVehicleFeatureLabel(value: string, locale: string): string {
  const normalized = normalize(value).replace(/\([^)]*\)/g, " ").replace(/\s+/g, " ");
  let key: string | null = null;

  if (/clim|air.?condition|a\/c/.test(normalized)) key = "air_conditioning";
  else if (/air.?bags?/.test(normalized)) key = "airbags";
  else if (/direction assist|power steering/.test(normalized)) key = "power_steering";
  else if (/audio hd/.test(normalized)) key = "audio_bluetooth";
  else if (/bluetooth/.test(normalized)) key = "bluetooth";
  else if (/central locking|verrouillage central/.test(normalized)) key = "central_locking";
  else if (/electric windows|vitres electri/.test(normalized)) key = "electric_windows";
  else if (/^abs$/.test(normalized)) key = "abs";
  else if (/^gps$/.test(normalized)) key = "gps";
  else if (/^usb$/.test(normalized)) key = "usb";

  return key ? featureLabels[key][getLocale(locale)] : value;
}
