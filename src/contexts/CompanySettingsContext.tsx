"use client";

import React, { createContext, useContext, useState, useEffect, useCallback } from "react";

export interface CompanySettings {
  agencyName: string;
  legalName: string;
  registration: string;
  phone: string;
  whatsapp: string;
  email: string;
  supportEmail: string;
  address: string;
  city: string;
  postalCode: string;
  country: string;
  website: string;
  defaultLanguage: string;
  facebook?: string;
  instagram?: string;
  linkedin?: string;
  twitter?: string;
  outOfTownReturnFee: number;
  differentLocationFee: number;
  timbreFiscal: number;
  contributionLF2026: number;
  paymentMethods?: {
    cash?: { enabled: boolean; label: string; description: string };
    bank_transfer?: {
      enabled: boolean;
      label: string;
      bankName: string;
      rib: string;
      iban: string;
      bic: string;
      accountHolder: string;
      instructions: string;
    };
    credit_card?: { enabled: boolean; label: string; description: string };
  };
}

export const DEFAULT_COMPANY_SETTINGS: CompanySettings = {
  agencyName: "Payless Car Rental Tunisie",
  legalName: "Houimli Rent a Car SARL",
  registration: "",
  phone: "+216 24 220 277",
  whatsapp: "+216 24 220 277",
  email: "contact@paylesscarrental.tn",
  supportEmail: "contact@paylesscarrental.tn",
  address: "60, Avenue de l'UMA, Chotrana 1, La Soukra",
  city: "Ariana 2036, Tunisie",
  postalCode: "2036",
  country: "Tunisie",
  website: "https://payless.tn",
  defaultLanguage: "fr",
  facebook: "",
  instagram: "",
  linkedin: "",
  twitter: "",
  outOfTownReturnFee: 100,
  differentLocationFee: 50,
  timbreFiscal: 1,
  contributionLF2026: 2,
  paymentMethods: {
    cash: {
      enabled: true,
      label: "Paiement en espèces (Cash à la livraison)",
      description: "Réglez directement en dinars tunisiens ou devises convertibles lors de la prise en charge du véhicule.",
    },
    bank_transfer: {
      enabled: true,
      label: "Virement bancaire professionnel",
      bankName: "BIAT Tunisie (Banque Internationale Arabe de Tunisie)",
      rib: "08 001 0001234567890 12",
      iban: "TN59 0800 1000 1234 5678 9012",
      bic: "BIATTNTT",
      accountHolder: "HOUIMLI RENT A CAR SARL (Payless Car Rental)",
      instructions: "Veuillez mentionner votre référence de réservation en objet du virement.",
    },
    credit_card: {
      enabled: true,
      label: "Carte Bancaire (TPE à la livraison / En ligne)",
      description: "Paiement sécurisé par carte bancaire nationale ou internationale (Visa, Mastercard, CIB).",
    },
  },
};

export function parseSettings(s: Record<string, unknown>): CompanySettings {
  const getStr = (val1?: unknown, val2?: unknown, fallback = ""): string => {
    if (typeof val1 === "string" && val1.trim()) return val1.trim();
    if (typeof val2 === "string" && val2.trim()) return val2.trim();
    return fallback;
  };

  const getNum = (val1?: unknown, val2?: unknown, fallback = 0): number => {
    if (val1 !== undefined && val1 !== null && !isNaN(Number(val1))) return Number(val1);
    if (val2 !== undefined && val2 !== null && !isNaN(Number(val2))) return Number(val2);
    return fallback;
  };

  const phone = getStr(s.phone, s.phone_primary, DEFAULT_COMPANY_SETTINGS.phone);
  const email = getStr(s.email, s.contact_email, DEFAULT_COMPANY_SETTINGS.email);

  return {
    agencyName: getStr(s.agencyName, s.agency_name, DEFAULT_COMPANY_SETTINGS.agencyName),
    legalName: getStr(s.legalName, s.legal_name, DEFAULT_COMPANY_SETTINGS.legalName),
    registration: getStr(s.registration, s.immatriculation, DEFAULT_COMPANY_SETTINGS.registration),
    phone,
    whatsapp: getStr(s.whatsapp, s.phone_secondary, phone || DEFAULT_COMPANY_SETTINGS.whatsapp),
    email,
    supportEmail: getStr(s.supportEmail, s.support_email, email || DEFAULT_COMPANY_SETTINGS.supportEmail),
    address: getStr(s.address, s.siege_social, DEFAULT_COMPANY_SETTINGS.address),
    city: getStr(s.city, s.ville, DEFAULT_COMPANY_SETTINGS.city),
    postalCode: getStr(s.postalCode, s.postal_code, DEFAULT_COMPANY_SETTINGS.postalCode),
    country: getStr(s.country, s.pays, DEFAULT_COMPANY_SETTINGS.country),
    website: getStr(s.website, s.site_web, DEFAULT_COMPANY_SETTINGS.website),
    defaultLanguage: getStr(s.defaultLanguage, s.default_language, DEFAULT_COMPANY_SETTINGS.defaultLanguage),
    facebook: getStr(s.facebook, undefined, DEFAULT_COMPANY_SETTINGS.facebook),
    instagram: getStr(s.instagram, undefined, DEFAULT_COMPANY_SETTINGS.instagram),
    linkedin: getStr(s.linkedin, undefined, DEFAULT_COMPANY_SETTINGS.linkedin),
    twitter: getStr(s.twitter, undefined, DEFAULT_COMPANY_SETTINGS.twitter),
    outOfTownReturnFee: getNum(s.outOfTownReturnFee, s.out_of_town_return_fee, DEFAULT_COMPANY_SETTINGS.outOfTownReturnFee),
    differentLocationFee: getNum(s.differentLocationFee, s.different_location_fee, DEFAULT_COMPANY_SETTINGS.differentLocationFee),
    timbreFiscal: getNum(s.timbreFiscal, s.timbre_fiscal, DEFAULT_COMPANY_SETTINGS.timbreFiscal),
    contributionLF2026: getNum(s.contributionLF2026, s.contribution_lf2026, DEFAULT_COMPANY_SETTINGS.contributionLF2026),
    paymentMethods: (s.paymentMethods as CompanySettings["paymentMethods"]) || DEFAULT_COMPANY_SETTINGS.paymentMethods,
  };
}

const CompanySettingsContext = createContext<{
  settings: CompanySettings;
  refreshSettings: () => Promise<void>;
}>({
  settings: DEFAULT_COMPANY_SETTINGS,
  refreshSettings: async () => {},
});

export function CompanySettingsProvider({
  children,
  initialSettings,
}: {
  children: React.ReactNode;
  /** Raw public settings rendered on the server, so SSR HTML already has the real contact details. */
  initialSettings?: Record<string, unknown>;
}) {
  const [settings, setSettings] = useState<CompanySettings>(() =>
    initialSettings ? parseSettings(initialSettings) : DEFAULT_COMPANY_SETTINGS
  );
  const lastFetchRef = React.useRef(0);

  const fetchSettings = useCallback(async () => {
    try {
      lastFetchRef.current = Date.now();
      const res = await fetch("/api/settings", { cache: "no-store" });
      const json = await res.json();
      if (json.success && json.settings) {
        const parsed = parseSettings(json.settings);
        setSettings(parsed);
        try {
          localStorage.setItem("company_settings_cache", JSON.stringify(parsed));
        } catch {}
      }
    } catch {
      // Keep state gracefully
    }
  }, []);

  useEffect(() => {
    // Server-rendered settings may come from a cached (ISR) page: refresh once in the background.
    fetchSettings();

    // 3. Listen to immediate custom updates from admin saves
    const handleUpdate = (e: Event) => {
      const customEvent = e as CustomEvent;
      if (customEvent.detail) {
        setSettings(parseSettings(customEvent.detail));
      }
      fetchSettings();
    };

    // 4. Cross-tab storage updates
    const handleStorage = (e: StorageEvent) => {
      if (e.key === "company-settings-updated" || e.key === "company_settings_cache") {
        fetchSettings();
      }
    };

    // 5. Window focus sync (user switches back from admin tab to site)
    const handleFocus = () => {
      // Throttled: at most one refresh per minute when the tab regains focus.
      if (Date.now() - lastFetchRef.current > 60_000) fetchSettings();
    };

    window.addEventListener("company-settings-updated", handleUpdate);
    window.addEventListener("storage", handleStorage);
    window.addEventListener("focus", handleFocus);

    return () => {
      window.removeEventListener("company-settings-updated", handleUpdate);
      window.removeEventListener("storage", handleStorage);
      window.removeEventListener("focus", handleFocus);
    };
  }, [fetchSettings, initialSettings]);

  return (
    <CompanySettingsContext.Provider value={{ settings, refreshSettings: fetchSettings }}>
      {children}
    </CompanySettingsContext.Provider>
  );
}

export function useCompanySettings() {
  return useContext(CompanySettingsContext);
}
