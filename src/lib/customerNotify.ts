import connectDB from "./db";
import { Booking } from "@/models";
import { sendEmail } from "./email";
import { getCompanyInfo } from "./pdfDocs";
import { sanitizeWhatsAppNumber } from "./whatsapp";

type Lang = "fr" | "en" | "ar";
const esc = (s: string) => s.replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[c] as string);
const dt = (minor: number) => `${(Math.round(minor) / 100).toFixed(3)} DT`;
const day = (d: Date, lang: Lang) =>
  new Date(d).toLocaleDateString(lang === "ar" ? "ar-TN" : lang === "en" ? "en-GB" : "fr-FR", { day: "numeric", month: "long", year: "numeric", timeZone: "UTC" });

export interface ChangeNotice {
  kind: "vehicle_change" | "dates_change";
  /** Lines specific to the change, already localised. */
  lines: Record<Lang, string[]>;
  total: number;
  paid: number;
  remaining: number;
  refundDue: number;
}

const TITLES: Record<ChangeNotice["kind"], Record<Lang, string>> = {
  vehicle_change: { fr: "Changement de véhicule", en: "Vehicle change", ar: "تغيير السيارة" },
  dates_change: { fr: "Modification de votre location", en: "Your rental has been updated", ar: "تعديل إيجاركم" },
};
const L: Record<Lang, { hello: string; total: string; paid: string; remaining: string; refund: string; settled: string; questions: string }> = {
  fr: { hello: "Bonjour", total: "Nouveau total", paid: "Déjà réglé", remaining: "Reste à payer", refund: "À vous rembourser", settled: "Location soldée", questions: "Pour toute question, contactez-nous" },
  en: { hello: "Hello", total: "New total", paid: "Already paid", remaining: "Balance due", refund: "To be refunded to you", settled: "Fully paid", questions: "Any question? Contact us" },
  ar: { hello: "مرحبًا", total: "المجموع الجديد", paid: "المدفوع", remaining: "المبلغ المتبقي", refund: "المبلغ المسترجع لكم", settled: "تم الدفع بالكامل", questions: "لأي استفسار اتصلوا بنا" },
};

/**
 * Tells the customer about a change made by the agency (car, dates, price): an email when mail is
 * configured, and a ready-to-send WhatsApp link for the agent. Never contains a plate or an internal
 * note. Never throws.
 */
export async function notifyCustomerOfChange(
  bookingId: string,
  notice: ChangeNotice
): Promise<{ emailSent: boolean; whatsappUrl: string | null; text: string }> {
  try {
    await connectDB();
    const b = await Booking.findById(bookingId).populate("customerId", "firstName lastName email phone").lean();
    if (!b) return { emailSent: false, whatsappUrl: null, text: "" };
    const c = b.customerId as unknown as { firstName?: string; lastName?: string; email?: string; phone?: string } | null;
    const lang: Lang = (["fr", "en", "ar"] as const).includes(b.customerLanguage as Lang) ? (b.customerLanguage as Lang) : "fr";
    const t = L[lang];
    const company = await getCompanyInfo();
    const money: [string, string][] = [
      [t.total, dt(notice.total)],
      [t.paid, dt(notice.paid)],
      notice.refundDue > 0 ? [t.refund, dt(notice.refundDue)] : notice.remaining > 0 ? [t.remaining, dt(notice.remaining)] : [t.settled, "✓"],
    ];
    const title = `${TITLES[notice.kind][lang]} — ${b.bookingReference}`;
    const name = `${c?.firstName || ""}`.trim();
    const text = [`${t.hello}${name ? ` ${name}` : ""},`, "", `*${title}*`, ...notice.lines[lang], "", ...money.map(([k, v]) => `${k} : ${v}`), "", `${t.questions} : ${company.phone}`, company.name].join("\n");

    let emailSent = false;
    if (c?.email && !/@(example\.com|ex\.com)$/i.test(c.email)) {
      const html = `<div dir="${lang === "ar" ? "rtl" : "ltr"}" style="font-family:Arial,Helvetica,sans-serif;max-width:560px;margin:0 auto;color:#0f172a">
<div style="background:#0b1f4b;color:#fff;padding:20px 24px;border-radius:12px 12px 0 0;font-size:18px;font-weight:700">${esc(company.name)}</div>
<div style="border:1px solid #e2e8f0;border-top:0;padding:24px;border-radius:0 0 12px 12px">
<h1 style="font-size:18px;margin:0 0 12px">${esc(title)}</h1>
<p style="font-size:14px;margin:0 0 12px">${esc(t.hello)}${name ? ` ${esc(name)}` : ""},</p>
${notice.lines[lang].map((l) => `<p style="font-size:14px;color:#334155;margin:0 0 8px">${esc(l)}</p>`).join("")}
<table style="width:100%;border-collapse:collapse;font-size:14px;margin-top:12px">${money
        .map(([k, v]) => `<tr><td style="padding:8px 0;color:#64748b;border-bottom:1px solid #f1f5f9">${esc(k)}</td><td style="padding:8px 0;font-weight:700;border-bottom:1px solid #f1f5f9;text-align:${lang === "ar" ? "left" : "right"}">${esc(v)}</td></tr>`)
        .join("")}</table>
<p style="font-size:13px;color:#475569;margin:16px 0 0">${esc(t.questions)} : ${esc(company.phone)} · ${esc(company.email)}</p>
</div></div>`;
      const res = await sendEmail({
        to: c.email,
        toName: `${c.firstName || ""} ${c.lastName || ""}`.trim(),
        subject: title,
        html,
        text,
        templateType: notice.kind,
        language: lang,
        bookingId,
      }).catch(() => ({ success: false }));
      emailSent = Boolean(res.success);
    }
    const phone = sanitizeWhatsAppNumber(c?.phone || "");
    const whatsappUrl = phone ? `https://wa.me/${phone}?text=${encodeURIComponent(text)}` : null;
    return { emailSent, whatsappUrl, text };
  } catch (err) {
    console.error("notifyCustomerOfChange:", err);
    return { emailSent: false, whatsappUrl: null, text: "" };
  }
}

export const fmtDay = day;
