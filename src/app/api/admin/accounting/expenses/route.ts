import { NextRequest, NextResponse } from "next/server";
import mongoose from "mongoose";
import { z } from "zod";
import connectDB from "@/lib/db";
import { requirePermission } from "@/lib/permissions";
import { Expense, Vehicle } from "@/models";
import { deletePrivateFile } from "@/lib/privateFiles";
import { EXPENSE_CATEGORIES } from "@/models/Expense";
import { nextNumber } from "@/models/Counter";
import { periodFromQuery } from "@/lib/ledger";
import { logAudit } from "@/lib/audit";

export const dynamic = "force-dynamic";

const schema = z
  .object({
    date: z.string().regex(/^\d{4}-\d{2}-\d{2}$/, "Date invalide"),
    category: z.enum(EXPENSE_CATEGORIES),
    label: z.string().trim().min(2, "Libellé obligatoire").max(200),
    supplier: z.string().trim().max(120).optional().default(""),
    amountTND: z.number().positive("Montant obligatoire").max(10_000_000),
    vatTND: z.number().min(0).max(10_000_000).optional().default(0),
    method: z.enum(["cash", "card", "bank_transfer", "cheque", "other"]).default("cash"),
    invoiceNumber: z.string().trim().max(80).optional().default(""),
    vehicleId: z.string().optional().default(""),
    unitId: z.string().optional().default(""),
    receiptUrl: z
      .string()
      .trim()
      .max(1000)
      .refine((v) => v === "" || /^https:\/\//.test(v) || /^\/api\/admin\/documents\/[a-f0-9]{24}$/.test(v), "Justificatif invalide")
      .default(""),
    notes: z.string().max(1000).optional().default(""),
  })
  .refine((d) => d.vatTND <= d.amountTND, { message: "La TVA ne peut pas dépasser le montant TTC." });

const oid = (v: string) => (mongoose.Types.ObjectId.isValid(v) ? new mongoose.Types.ObjectId(v) : undefined);

async function dropReceipt(url?: string | null) {
  const m = /^\/api\/admin\/documents\/([a-f0-9]{24})$/.exec(String(url || ""));
  if (m && !(await Expense.exists({ receiptUrl: url }))) await deletePrivateFile(m[1]);
}

export async function GET(request: NextRequest) {
  const guard = await requirePermission("accounting", "view");
  if (!guard.ok) return guard.response;
  await connectDB();
  const sp = new URL(request.url).searchParams;
  const { from, to, fromStr, toStr } = periodFromQuery(sp.get("from"), sp.get("to"));
  const filter: Record<string, unknown> = { date: { $gte: from, $lte: to } };
  if (sp.get("category")) filter.category = sp.get("category");
  if (sp.get("vehicleId") && oid(sp.get("vehicleId")!)) filter.vehicleId = oid(sp.get("vehicleId")!);
  const q = (sp.get("q") || "").trim();
  if (q) {
    const rx = new RegExp(q.replace(/[.*+?^${}()|[\]\\]/g, "\\$&"), "i");
    filter.$or = [{ label: rx }, { supplier: rx }, { number: rx }, { invoiceNumber: rx }];
  }
  const [expenses, vehicles] = await Promise.all([
    Expense.find(filter).sort({ date: -1, createdAt: -1 }).limit(1000).lean(),
    Vehicle.find({}).select("brand model units._id units.licensePlate").sort({ brand: 1, model: 1 }).lean(),
  ]);
  const names = new Map(vehicles.map((v) => [String(v._id), `${v.brand} ${v.model}`]));
  const byCategory: Record<string, number> = {};
  for (const e of expenses) byCategory[e.category] = (byCategory[e.category] || 0) + e.amount;
  return NextResponse.json({
    success: true,
    period: { from: fromStr, to: toStr },
    expenses: expenses.map((e) => ({ ...e, vehicleName: e.vehicleId ? names.get(String(e.vehicleId)) || "" : "" })),
    totals: { amount: expenses.reduce((a, e) => a + e.amount, 0), vat: expenses.reduce((a, e) => a + (e.vatAmount || 0), 0), byCategory },
    vehicles: vehicles.map((v) => ({
      _id: String(v._id),
      name: `${v.brand} ${v.model}`,
      units: (v.units || []).map((u, i) => ({ _id: String(u._id), label: u.licensePlate || `Unité ${i + 1}` })),
    })),
  });
}

export async function POST(request: NextRequest) {
  const guard = await requirePermission("accounting", "create");
  if (!guard.ok) return guard.response;
  const parsed = schema.safeParse(await request.json().catch(() => ({})));
  if (!parsed.success) return NextResponse.json({ success: false, error: parsed.error.issues[0]?.message || "Données invalides" }, { status: 400 });
  const d = parsed.data;
  await connectDB();
  const date = new Date(`${d.date}T12:00:00.000Z`);
  const expense = await Expense.create({
    number: await nextNumber("DEP", date),
    date,
    category: d.category,
    label: d.label,
    supplier: d.supplier,
    amount: Math.round(d.amountTND * 100),
    vatAmount: Math.round(d.vatTND * 100),
    method: d.method,
    invoiceNumber: d.invoiceNumber,
    vehicleId: oid(d.vehicleId),
    unitId: oid(d.unitId),
    receiptUrl: d.receiptUrl,
    notes: d.notes,
    createdBy: guard.session.user?.email || "inconnu",
  });
  await logAudit(guard.session, "expense.create", "expense", String(expense._id), { after: { number: expense.number, amount: expense.amount, category: expense.category } });
  return NextResponse.json({ success: true, expense }, { status: 201 });
}

export async function PUT(request: NextRequest) {
  const guard = await requirePermission("accounting", "edit");
  if (!guard.ok) return guard.response;
  const body = await request.json().catch(() => ({}));
  const id = String(body.id || "");
  if (!mongoose.Types.ObjectId.isValid(id)) return NextResponse.json({ success: false, error: "Dépense introuvable" }, { status: 404 });
  const parsed = schema.safeParse(body);
  if (!parsed.success) return NextResponse.json({ success: false, error: parsed.error.issues[0]?.message || "Données invalides" }, { status: 400 });
  const d = parsed.data;
  await connectDB();
  const expense = await Expense.findById(id);
  if (!expense) return NextResponse.json({ success: false, error: "Dépense introuvable" }, { status: 404 });
  if (expense.closingId && (Math.round(d.amountTND * 100) !== expense.amount || d.method !== expense.method)) {
    return NextResponse.json({ success: false, error: "Dépense déjà comptée dans une clôture de caisse : montant et mode de paiement verrouillés." }, { status: 409 });
  }
  const before = { amount: expense.amount, category: expense.category, label: expense.label };
  const oldReceipt = expense.receiptUrl;
  Object.assign(expense, {
    date: new Date(`${d.date}T12:00:00.000Z`),
    category: d.category,
    label: d.label,
    supplier: d.supplier,
    amount: Math.round(d.amountTND * 100),
    vatAmount: Math.round(d.vatTND * 100),
    method: d.method,
    invoiceNumber: d.invoiceNumber,
    vehicleId: oid(d.vehicleId),
    unitId: oid(d.unitId),
    receiptUrl: d.receiptUrl,
    notes: d.notes,
  });
  await expense.save();
  if (oldReceipt !== d.receiptUrl) await dropReceipt(oldReceipt);
  await logAudit(guard.session, "expense.update", "expense", id, { before, after: { amount: expense.amount, category: expense.category, label: expense.label } });
  return NextResponse.json({ success: true, expense });
}

export async function DELETE(request: NextRequest) {
  const guard = await requirePermission("accounting", "delete");
  if (!guard.ok) return guard.response;
  const id = new URL(request.url).searchParams.get("id") || "";
  if (!mongoose.Types.ObjectId.isValid(id)) return NextResponse.json({ success: false, error: "Dépense introuvable" }, { status: 404 });
  await connectDB();
  const expense = await Expense.findById(id);
  if (!expense) return NextResponse.json({ success: false, error: "Dépense introuvable" }, { status: 404 });
  if (expense.closingId) return NextResponse.json({ success: false, error: "Dépense déjà comptée dans une clôture de caisse : suppression impossible." }, { status: 409 });
  await expense.deleteOne();
  await dropReceipt(expense.receiptUrl);
  await logAudit(guard.session, "expense.delete", "expense", id, { before: { number: expense.number, amount: expense.amount, label: expense.label } });
  return NextResponse.json({ success: true });
}
