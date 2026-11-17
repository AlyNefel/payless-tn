import { NextRequest, NextResponse } from "next/server";
import connectDB from "@/lib/db";
import { requirePermission } from "@/lib/permissions";
import { Expense, Payment } from "@/models";
import { PAYMENT_KIND_LABELS, PAYMENT_METHOD_LABELS, periodFromQuery } from "@/lib/ledger";
import { buildSummary } from "@/lib/accountingReport";
import { EXPENSE_LABELS } from "@/lib/accountingLabels";
import { logAudit } from "@/lib/audit";

export const dynamic = "force-dynamic";

/** CSV for Excel (FR): semicolon separator, comma decimals, UTF-8 BOM. Formula injection neutralised. */
function csv(rows: (string | number)[][]): string {
  const cell = (v: string | number) => {
    let s = typeof v === "number" ? String(v).replace(".", ",") : String(v ?? "");
    if (typeof v === "string" && /^[=+\-@\t\r]/.test(s)) s = `'${s}`;
    return /[";\n\r]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
  };
  return "﻿" + rows.map((r) => r.map(cell).join(";")).join("\r\n");
}
const tnd = (n: number) => Math.round(n) / 100;
const day = (d: Date | string) => new Date(d).toISOString().slice(0, 10);

/** GET ?type=payments|expenses|journal|receivables|vehicles&from&to */
export async function GET(request: NextRequest) {
  const guard = await requirePermission("accounting", "export");
  if (!guard.ok) return guard.response;
  await connectDB();
  const sp = new URL(request.url).searchParams;
  const type = sp.get("type") || "journal";
  const { from, to, fromStr, toStr } = periodFromQuery(sp.get("from"), sp.get("to"));
  let rows: (string | number)[][] = [];

  if (type === "payments" || type === "journal") {
    const payments = await Payment.find({ paidAt: { $gte: from, $lte: to } }).sort({ paidAt: 1 }).lean();
    const lines = payments.map((p) => {
      const sign = p.status === "voided" ? 0 : p.kind === "payment" || p.kind === "deposit" ? 1 : -1;
      return {
        date: day(p.paidAt),
        row: [day(p.paidAt), p.receiptNumber, PAYMENT_KIND_LABELS[p.kind], p.bookingReference, p.customerName, PAYMENT_METHOD_LABELS[p.method] || p.method, sign > 0 ? tnd(p.amount) : 0, sign < 0 ? tnd(p.amount) : 0, p.status === "voided" ? `ANNULÉ : ${p.voidReason || ""}` : p.reference || "", p.recordedBy] as (string | number)[],
      };
    });
    if (type === "journal") {
      const expenses = await Expense.find({ date: { $gte: from, $lte: to } }).sort({ date: 1 }).lean();
      for (const e of expenses) {
        lines.push({ date: day(e.date), row: [day(e.date), e.number, "Dépense", EXPENSE_LABELS[e.category] || e.category, e.supplier || e.label, PAYMENT_METHOD_LABELS[e.method] || e.method, 0, tnd(e.amount), e.label, e.createdBy] });
      }
      lines.sort((a, b) => a.date.localeCompare(b.date));
    }
    rows = [["Date", "Pièce", "Type", "Réservation / Catégorie", "Client / Fournisseur", "Mode", "Entrée (DT)", "Sortie (DT)", "Libellé", "Saisi par"], ...lines.map((l) => l.row)];
  } else if (type === "expenses") {
    const expenses = await Expense.find({ date: { $gte: from, $lte: to } }).sort({ date: 1 }).lean();
    rows = [
      ["Date", "N°", "Catégorie", "Libellé", "Fournisseur", "N° facture", "Mode", "Montant TTC (DT)", "dont TVA (DT)", "Justificatif", "Saisi par"],
      ...expenses.map((e) => [day(e.date), e.number, EXPENSE_LABELS[e.category] || e.category, e.label, e.supplier || "", e.invoiceNumber || "", PAYMENT_METHOD_LABELS[e.method] || e.method, tnd(e.amount), tnd(e.vatAmount || 0), e.receiptUrl ? "oui" : "non", e.createdBy]),
    ];
  } else {
    const s = await buildSummary(from, to, fromStr, toStr);
    if (type === "receivables") {
      rows = [["Réservation", "Client", "Téléphone", "Total (DT)", "Encaissé (DT)", "Reste (DT)", "Retour", "Statut"], ...s.receivables.map((r) => [r.reference, r.customer, r.phone, tnd(r.total), tnd(r.paid), tnd(r.remaining), day(r.returnDate), r.status])];
    } else if (type === "vehicles") {
      rows = [["Véhicule", "Unités", "Locations", "Jours loués", "Occupation %", "Chiffre d'affaires (DT)", "Dépenses (DT)", "Marge (DT)"], ...s.vehicles.map((v) => [v.name, v.units, v.bookings, v.rentedDays, v.occupancy, tnd(v.revenue), tnd(v.expenses), tnd(v.margin)])];
    } else {
      return NextResponse.json({ success: false, error: "Type d'export inconnu" }, { status: 400 });
    }
  }
  await logAudit(guard.session, `export.${type}`, "accounting", undefined, { after: { from: fromStr, to: toStr, rows: rows.length - 1 } });
  return new NextResponse(csv(rows), {
    headers: {
      "Content-Type": "text/csv; charset=utf-8",
      "Content-Disposition": `attachment; filename="payless-${type}-${fromStr}_${toStr}.csv"`,
      "Cache-Control": "no-store",
    },
  });
}
