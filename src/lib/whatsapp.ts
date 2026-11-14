import connectDB from "@/lib/db";
import AgencySetting from "@/models/AgencySetting";

export interface WhatsAppConfig {
  provider: "ultramsg" | "greenapi" | "meta" | "custom_webhook" | "direct_link";
  autoSendEnabled: boolean;
  apiUrl?: string;
  instanceId?: string;
  token?: string;
  senderPhone?: string;
  messageTemplate?: string;
}

export const DEFAULT_WHATSAPP_CONFIG: WhatsAppConfig = {
  provider: "ultramsg",
  autoSendEnabled: true,
  apiUrl: "https://api.ultramsg.com/instance99999/messages/chat",
  instanceId: "instance99999",
  token: "",
  senderPhone: "+216 25 120 130",
  messageTemplate:
    "Bonjour {client},\n\n✅ Votre réservation chez Payless Car Rental Tunisie est CONFIRMÉE !\n\n📋 Référence : {ref}\n🚗 Véhicule : {vehicle}\n📅 Période : {dates}\n📍 Prise en charge : {pickup}\n💰 Total TTC à régler : {total} TND\n\n📄 Téléchargez votre Bon de Réservation & Facture (PDF) :\n{pdfUrl}\n\nAssistance VIP 24/7 : +216 25 120 130.\nMerci pour votre confiance !",
};

/**
 * Retrieve WhatsApp configuration from AgencySetting database with fallback to default
 */
export async function getWhatsAppConfig(): Promise<WhatsAppConfig> {
  try {
    await connectDB();
    const setting = await AgencySetting.findOne({
      key: { $in: ["whatsapp_config", "whatsAppSettings"] },
    }).lean();

    if (setting && setting.value && typeof setting.value === "object") {
      return {
        ...DEFAULT_WHATSAPP_CONFIG,
        ...(setting.value as Partial<WhatsAppConfig>),
      };
    }
  } catch (error) {
    console.warn("Failed to load whatsapp_config from DB:", error);
  }

  return DEFAULT_WHATSAPP_CONFIG;
}

/**
 * Format phone number to clean international E.164 without plus sign
 * E.g., "25 120 130" -> "21625120130"
 * "+33 6 12 34 56 78" -> "33612345678"
 */
export function sanitizeWhatsAppNumber(phone: string): string {
  if (!phone) return "";
  let cleaned = phone.replace(/[^0-9]/g, "");

  // If local Tunisian 8-digit number, prepend country code 216
  if (cleaned.length === 8) {
    cleaned = "216" + cleaned;
  }

  return cleaned;
}

/**
 * Dispatch an automated WhatsApp message to a customer
 */
export async function sendWhatsAppMessage({
  to,
  message,
  customConfig,
}: {
  to: string;
  message: string;
  customConfig?: Partial<WhatsAppConfig>;
}): Promise<{
  success: boolean;
  messageId?: string;
  mode?: "api" | "direct_link";
  url?: string;
  error?: string;
}> {
  const config = customConfig
    ? { ...(await getWhatsAppConfig()), ...customConfig }
    : await getWhatsAppConfig();

  const cleanPhone = sanitizeWhatsAppNumber(to);
  if (!cleanPhone) {
    return { success: false, error: "Numéro de téléphone destinataire invalide." };
  }

  const directLinkUrl = `https://wa.me/${cleanPhone}?text=${encodeURIComponent(message)}`;

  // If no API URL or Token is provided, fallback to direct web link
  if (!config.apiUrl || !config.token || config.provider === "direct_link") {
    return {
      success: true,
      mode: "direct_link",
      url: directLinkUrl,
      error: "Passerelle API non configurée. Lien direct WhatsApp généré avec succès.",
    };
  }

  try {
    const provider = config.provider || "ultramsg";
    const endpoint = config.apiUrl.trim();
    let bodyPayload: any = null;
    const headers: Record<string, string> = {
      "Content-Type": "application/json",
    };

    if (provider === "ultramsg" || endpoint.includes("ultramsg")) {
      // UltraMsg WhatsApp Gateway
      bodyPayload = {
        token: config.token.trim(),
        to: cleanPhone,
        body: message,
      };
    } else if (provider === "greenapi" || endpoint.includes("greenapi") || endpoint.includes("green-api")) {
      // GreenAPI Gateway
      bodyPayload = {
        chatId: `${cleanPhone}@c.us`,
        message: message,
      };
    } else if (provider === "meta" || endpoint.includes("graph.facebook.com")) {
      // Meta WhatsApp Cloud API
      headers["Authorization"] = `Bearer ${config.token.trim()}`;
      bodyPayload = {
        messaging_product: "whatsapp",
        recipient_type: "individual",
        to: cleanPhone,
        type: "text",
        text: { preview_url: true, body: message },
      };
    } else {
      // Generic Webhook / Custom Gateway
      headers["Authorization"] = `Bearer ${config.token.trim()}`;
      bodyPayload = {
        instanceId: config.instanceId,
        to: cleanPhone,
        message: message,
        senderPhone: config.senderPhone,
      };
    }

    const response = await fetch(endpoint, {
      method: "POST",
      headers,
      body: JSON.stringify(bodyPayload),
      cache: "no-store",
    });

    const responseData = await response.json().catch(() => null);

    if (response.ok) {
      const msgId =
        responseData?.id ||
        responseData?.messageId ||
        responseData?.messages?.[0]?.id ||
        `wa_${Date.now()}`;
      return {
        success: true,
        mode: "api",
        messageId: String(msgId),
        url: directLinkUrl,
      };
    } else {
      const errMsg =
        responseData?.message ||
        responseData?.error?.message ||
        responseData?.description ||
        `HTTP ${response.status}: ${response.statusText}`;
      return {
        success: false,
        mode: "api",
        url: directLinkUrl,
        error: `Erreur passerelle WhatsApp (${provider}): ${errMsg}`,
      };
    }
  } catch (err: any) {
    console.error("sendWhatsAppMessage exception:", err);
    return {
      success: false,
      mode: "api",
      url: directLinkUrl,
      error: `Échec de connexion réseau à la passerelle WhatsApp: ${err?.message || "Inconnue"}`,
    };
  }
}

/**
 * High-level helper to format and dispatch booking confirmation WhatsApp message
 */
export async function sendBookingWhatsAppNotification(booking: any): Promise<{
  success: boolean;
  messageId?: string;
  error?: string;
}> {
  const config = await getWhatsAppConfig();
  if (!config.autoSendEnabled) {
    return { success: false, error: "Envoi automatique WhatsApp désactivé dans les paramètres." };
  }

  const customerPhone = booking.customerPhone || booking.customerId?.phone;
  if (!customerPhone) {
    return { success: false, error: "Aucun numéro de téléphone client disponible." };
  }

  const customerName =
    booking.customerName ||
    (booking.customerId ? `${booking.customerId.firstName} ${booking.customerId.lastName}` : "Client");
  const ref = booking.bookingReference || booking.reference || "PAY-2026";
  const vehicle =
    booking.vehicleName ||
    (booking.vehicleId ? `${booking.vehicleId.brand} ${booking.vehicleId.model}` : "Véhicule");
  const fmtDate = (d: unknown) => {
    const date = d ? new Date(d as string) : null;
    return date && !isNaN(date.getTime())
      ? new Intl.DateTimeFormat("fr-FR", { day: "2-digit", month: "long", year: "numeric" }).format(date)
      : "";
  };
  const dates = `${fmtDate(booking.pickupDate)} au ${fmtDate(booking.returnDate)}`;
  const pickup =
    booking.pickupLocation ||
    (typeof booking.pickupLocationId?.name === "object"
      ? booking.pickupLocationId?.name?.fr
      : booking.pickupLocationId?.name) ||
    "Agence";
  // Amounts are always stored in minor units (1 TND = 100).
  const total = ((Number(booking.totalAmount ?? booking.pricingBreakdown?.totalAmount) || 0) / 100).toLocaleString("fr-FR", {
    maximumFractionDigits: 2,
  });

  const baseUrl = process.env.NEXT_PUBLIC_SITE_URL || process.env.NEXTAUTH_URL || "https://payless.tn";
  const customerEmail = booking.customerEmail || booking.customerId?.email || "";
  const pdfUrl = `${baseUrl}/api/bookings/pdf?ref=${encodeURIComponent(ref)}&email=${encodeURIComponent(customerEmail)}`;

  let message = config.messageTemplate || DEFAULT_WHATSAPP_CONFIG.messageTemplate!;
  message = message
    .replace(/{client}/g, customerName)
    .replace(/{ref}/g, ref)
    .replace(/{vehicle}/g, vehicle)
    .replace(/{dates}/g, dates)
    .replace(/{pickup}/g, pickup)
    .replace(/{total}/g, String(total))
    .replace(/{pdfUrl}/g, pdfUrl);

  const res = await sendWhatsAppMessage({
    to: customerPhone,
    message,
  });

  return res;
}

