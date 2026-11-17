import connectDB from "./db";
import { Booking } from "@/models";
import { sendEmail } from "./email";
import { notifyStaff } from "./notify";
import { getCompanyInfo } from "./pdfDocs";

const esc = (s: string) => s.replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[c] as string);

/** Calendar day in Tunisia (UTC+1 all year) `offset` days from now. */
function tunisDay(offset: number): string {
  return new Date(Date.now() + 3_600_000 + offset * 86_400_000).toISOString().slice(0, 10);
}

type Lang = "fr" | "en" | "ar";
const TEXT: Record<"pickup" | "return", Record<Lang, { subject: string; title: string; intro: string; date: string; place: string; car: string; balance: string; docs: string; fuel: string }>> = {
  pickup: {
    fr: { subject: "Rappel : votre location commence demain", title: "Votre voiture vous attend demain", intro: "Bonjour {name}, voici le rappel de votre réservation {ref}.", date: "Prise en charge", place: "Lieu", car: "Véhicule", balance: "Reste à payer", docs: "À présenter : permis de conduire original, CIN ou passeport.", fuel: "" },
    en: { subject: "Reminder: your rental starts tomorrow", title: "Your car is ready for tomorrow", intro: "Hello {name}, this is a reminder for your booking {ref}.", date: "Pick-up", place: "Location", car: "Vehicle", balance: "Balance due", docs: "Please bring: original driving licence, ID card or passport.", fuel: "" },
    ar: { subject: "تذكير: يبدأ إيجاركم غدًا", title: "سيارتكم جاهزة ليوم الغد", intro: "مرحبًا {name}، هذا تذكير بحجزكم {ref}.", date: "الاستلام", place: "المكان", car: "السيارة", balance: "المبلغ المتبقي", docs: "يرجى إحضار: رخصة القيادة الأصلية وبطاقة التعريف أو جواز السفر.", fuel: "" },
  },
  return: {
    fr: { subject: "Rappel : retour de votre véhicule demain", title: "Retour du véhicule prévu demain", intro: "Bonjour {name}, votre location {ref} se termine demain.", date: "Retour prévu", place: "Lieu", car: "Véhicule", balance: "Reste à payer", docs: "Besoin de garder la voiture plus longtemps ? Contactez-nous avant l'heure de retour.", fuel: "Merci de rendre le véhicule avec le même niveau de carburant qu'au départ." },
    en: { subject: "Reminder: vehicle return tomorrow", title: "Your vehicle is due back tomorrow", intro: "Hello {name}, your rental {ref} ends tomorrow.", date: "Return", place: "Location", car: "Vehicle", balance: "Balance due", docs: "Need the car longer? Contact us before the return time.", fuel: "Please return the car with the same fuel level as at pick-up." },
    ar: { subject: "تذكير: إرجاع السيارة غدًا", title: "موعد إرجاع السيارة غدًا", intro: "مرحبًا {name}، ينتهي إيجاركم {ref} غدًا.", date: "الإرجاع", place: "المكان", car: "السيارة", balance: "المبلغ المتبقي", docs: "تحتاجون السيارة لمدة أطول؟ اتصلوا بنا قبل موعد الإرجاع.", fuel: "يرجى إرجاع السيارة بنفس مستوى الوقود." },
  },
};

export interface ReminderResult {
  pickupEmails: number;
  returnEmails: number;
  failed: number;
  tomorrow: string;
  departures: number;
  returns: number;
}

/**
 * Day-before reminders: an email to each customer whose rental starts or ends tomorrow, and one
 * notification to the team with tomorrow's workload. Safe to call as often as wanted: each
 * reminder is claimed atomically on the booking and sent once.
 */
export async function runReminders(): Promise<ReminderResult> {
  await connectDB();
  const tomorrow = tunisDay(1);
  const start = new Date(`${tomorrow}T00:00:00.000Z`);
  const end = new Date(start.getTime() + 86_400_000);
  const result: ReminderResult = { pickupEmails: 0, returnEmails: 0, failed: 0, tomorrow, departures: 0, returns: 0 };
  const company = await getCompanyInfo();

  const run = async (kind: "pickup" | "return") => {
    const filter =
      kind === "pickup"
        ? { bookingStatus: { $in: ["confirmed", "awaiting_payment", "paid"] as const }, pickupDate: { $gte: start, $lt: end } }
        : { bookingStatus: "active" as const, returnDate: { $gte: start, $lt: end } };
    const bookings = await Booking.find(filter)
      .populate("customerId", "firstName lastName email")
      .populate("vehicleId", "brand model")
      .populate("pickupLocationId", "name")
      .populate("returnLocationId", "name")
      .lean();
    if (kind === "pickup") result.departures = bookings.length;
    else result.returns = bookings.length;

    for (const b of bookings) {
      const key = `${kind}:${tomorrow}`;
      // Claim first: two servers running at the same time cannot both send.
      const claim = await Booking.updateOne({ _id: b._id, remindersSent: { $ne: key } }, { $addToSet: { remindersSent: key } });
      if (claim.modifiedCount !== 1) continue;
      const c = b.customerId as unknown as { firstName?: string; lastName?: string; email?: string } | null;
      if (!c?.email || /@(example\.com|ex\.com)$/i.test(c.email)) continue;
      const lang: Lang = (["fr", "en", "ar"] as const).includes(b.customerLanguage as Lang) ? (b.customerLanguage as Lang) : "fr";
      const t = TEXT[kind][lang];
      const v = b.vehicleId as unknown as { brand?: string; model?: string } | null;
      const loc = (kind === "pickup" ? b.pickupLocationId : b.returnLocationId) as unknown as { name?: { fr?: string; en?: string; ar?: string } } | null;
      const time = kind === "pickup" ? b.pickupTime : b.returnTime;
      const dateText = new Date(`${tomorrow}T12:00:00Z`).toLocaleDateString(lang === "ar" ? "ar-TN" : lang === "en" ? "en-GB" : "fr-FR", { weekday: "long", day: "numeric", month: "long", timeZone: "UTC" });
      const total = b.pricingBreakdown?.totalAmount || 0;
      const remaining = b.paymentStatus === "paid" && !b.amountPaid ? 0 : Math.max(0, total - (b.amountPaid || 0));
      const rows: [string, string][] = [
        [t.date, `${dateText}${time ? ` — ${time}` : ""}`],
        [t.place, loc?.name?.[lang] || loc?.name?.fr || ""],
        // Model only: plates and internal references never go to the customer.
        [t.car, `${v?.brand || ""} ${v?.model || ""}`.trim()],
      ];
      if (remaining > 0) rows.push([t.balance, `${(remaining / 100).toFixed(3)} DT`]);
      const name = esc(`${c.firstName || ""}`.trim() || "client");
      const html = `<div dir="${lang === "ar" ? "rtl" : "ltr"}" style="font-family:Arial,Helvetica,sans-serif;max-width:560px;margin:0 auto;color:#0f172a">
<div style="background:#0b1f4b;color:#fff;padding:20px 24px;border-radius:12px 12px 0 0"><div style="font-size:18px;font-weight:700">${esc(company.name)}</div></div>
<div style="border:1px solid #e2e8f0;border-top:0;padding:24px;border-radius:0 0 12px 12px">
<h1 style="font-size:18px;margin:0 0 8px">${esc(t.title)}</h1>
<p style="font-size:14px;color:#475569;margin:0 0 16px">${esc(t.intro).replace("{name}", name).replace("{ref}", `<b>${esc(b.bookingReference)}</b>`)}</p>
<table style="width:100%;border-collapse:collapse;font-size:14px">${rows.map(([k, val]) => `<tr><td style="padding:8px 0;color:#64748b;border-bottom:1px solid #f1f5f9">${esc(k)}</td><td style="padding:8px 0;font-weight:700;border-bottom:1px solid #f1f5f9;text-align:${lang === "ar" ? "left" : "right"}">${esc(val)}</td></tr>`).join("")}</table>
<p style="font-size:13px;color:#475569;margin:16px 0 0">${esc(t.docs)}</p>${t.fuel ? `<p style="font-size:13px;color:#475569;margin:8px 0 0">${esc(t.fuel)}</p>` : ""}
<p style="font-size:13px;color:#475569;margin:16px 0 0">${esc(company.phone)} · ${esc(company.email)}</p>
</div></div>`;
      const sent = await sendEmail({
        to: c.email,
        toName: `${c.firstName || ""} ${c.lastName || ""}`.trim(),
        subject: `${t.subject} — ${b.bookingReference}`,
        html,
        templateType: kind === "pickup" ? "pickup_reminder" : "return_reminder",
        language: lang,
        bookingId: String(b._id),
      }).catch((e) => ({ success: false, error: String(e) }));
      if (sent.success) {
        if (kind === "pickup") result.pickupEmails++;
        else result.returnEmails++;
      } else {
        result.failed++;
        // Not delivered (mail not configured, bounce…): release the claim so the next run retries.
        await Booking.updateOne({ _id: b._id }, { $pull: { remindersSent: key } });
      }
    }
  };
  await run("pickup");
  await run("return");

  if (result.departures + result.returns > 0) {
    await notifyStaff({
      type: "tomorrow_agenda",
      category: "reminder",
      severity: "info",
      title: {
        fr: `Demain : ${result.departures} départ(s), ${result.returns} retour(s)`,
        en: `Tomorrow: ${result.departures} departure(s), ${result.returns} return(s)`,
        ar: `غدًا: ${result.departures} انطلاق، ${result.returns} إرجاع`,
      },
      message: {
        fr: "Préparez les véhicules et les contrats. Les clients ont reçu un rappel par e-mail lorsque la messagerie est configurée.",
        en: "Prepare the cars and contracts.",
        ar: "جهزوا السيارات والعقود.",
      },
      link: "/admin/worker",
      dedupeKey: `agenda:${tomorrow}:${result.departures}:${result.returns}`,
    });
  }
  return result;
}

let last = 0;
/** Throttled trigger (at most once per hour per server) used when no external cron is configured. */
export function runRemindersThrottled(): void {
  if (Date.now() - last < 3_600_000) return;
  last = Date.now();
  runReminders().catch((e) => console.error("runReminders:", e));
}
