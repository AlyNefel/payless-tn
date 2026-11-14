import connectDB from "./db";
import AgencySetting from "@/models/AgencySetting";

/**
 * Agency settings that are safe to expose to anonymous visitors.
 *
 * SECURITY: AgencySetting also stores secrets (smtp_config, whatsapp_config, API tokens…).
 * Anything returned to the browser MUST go through this allowlist — never spread the raw collection.
 */
export const PUBLIC_SETTING_KEYS = [
  "agencyName", "agency_name",
  "legalName", "legal_name",
  "registration", "immatriculation",
  "address", "siege_social",
  "city", "ville",
  "postalCode", "postal_code",
  "country", "pays",
  "phone", "phone_primary",
  "whatsapp", "phone_secondary",
  "email", "contact_email",
  "supportEmail", "support_email",
  "website", "site_web",
  "defaultLanguage", "default_language",
  "facebook", "instagram", "linkedin", "twitter",
  "currency", "currencySymbol",
  "taxRate",
  "timbreFiscal", "timbre_fiscal",
  "contributionLF2026", "contribution_lf2026",
  "differentLocationFee", "different_location_fee",
  "outOfTownReturnFee", "out_of_town_return_fee",
  "minRentalAge", "minLuxuryAge",
  "cancellationHours", "cancellationFeeRate",
  "paymentMethods",
  "openingHours",
] as const;

export const DEFAULT_PUBLIC_SETTINGS: Record<string, unknown> = {
  agencyName: "Payless Car Rental Tunisie",
  legalName: "Houimli Rent a Car SARL",
  registration: "",
  address: "60, Avenue de l'UMA, Chotrana 1, La Soukra",
  city: "Ariana 2036, Tunisie",
  postalCode: "2036",
  country: "Tunisie",
  phone: "+216 24 220 277",
  whatsapp: "+216 24 220 277",
  email: "contact@paylesscarrental.tn",
  supportEmail: "contact@paylesscarrental.tn",
  website: "https://payless.tn",
  defaultLanguage: "fr",
  // Empty = hidden in the UI (no more placeholder links to facebook.com etc.)
  facebook: "",
  instagram: "",
  linkedin: "",
  twitter: "",
  currency: "TND",
  currencySymbol: "DT",
  taxRate: 0,
  timbreFiscal: 1,
  contributionLF2026: 2,
  differentLocationFee: 0,
  outOfTownReturnFee: 100,
  minRentalAge: 21,
  minLuxuryAge: 25,
  cancellationHours: 48,
  cancellationFeeRate: 20,
};

const ALLOWED = new Set<string>(PUBLIC_SETTING_KEYS);

/** Strip a payment method config down to what customers need to see. */
function sanitizePaymentMethods(value: unknown): unknown {
  if (!value || typeof value !== "object") return undefined;
  const out: Record<string, unknown> = {};
  for (const [id, raw] of Object.entries(value as Record<string, unknown>)) {
    if (!raw || typeof raw !== "object") continue;
    const m = raw as Record<string, unknown>;
    out[id] = {
      enabled: m.enabled !== false,
      label: m.label,
      description: m.description,
      bankName: m.bankName,
      rib: m.rib,
      iban: m.iban,
      bic: m.bic,
      accountHolder: m.accountHolder,
      instructions: m.instructions,
    };
  }
  return out;
}

export async function getPublicSettings(): Promise<Record<string, unknown>> {
  const result: Record<string, unknown> = { ...DEFAULT_PUBLIC_SETTINGS };
  try {
    await connectDB();
    const docs = await AgencySetting.find({ key: { $in: PUBLIC_SETTING_KEYS as unknown as string[] } }).lean();
    for (const d of docs) {
      if (!ALLOWED.has(d.key)) continue;
      if (d.value === undefined || d.value === null || d.value === "") continue;
      result[d.key] = d.key === "paymentMethods" ? sanitizePaymentMethods(d.value) : d.value;
    }
  } catch (err) {
    console.warn("getPublicSettings: falling back to defaults:", err);
  }
  return result;
}
