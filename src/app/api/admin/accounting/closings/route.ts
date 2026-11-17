import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import connectDB from "@/lib/db";
import { requirePermission } from "@/lib/permissions";
import { CashClosing, Expense, Payment } from "@/models";
import { nextNumber } from "@/models/Counter";
import { logAudit } from "@/lib/audit";

export const dynamic = "force-dynamic";

/** Cash movements not yet counted in a closing (optionally for one agent). */
async function openCash(agent: string) {
  const payFilter: Record<string, unknown> = { method: "cash", status: "completed", closingId: { $exists: false } };
  const expFilter: Record<string, unknown> = { method: "cash", closingId: { $exists: false } };
  if (agent) {
    payFilter.recordedBy = agent;
    expFilter.createdBy = agent;
  }
  const [payments, expenses, last] = await Promise.all([
    Payment.find(payFilter).sort({ paidAt: 1 }).lean(),
    Expense.find(expFilter).sort({ date: 1 }).lean(),
    CashClosing.findOne({ agent }).sort({ closedAt: -1 }).lean(),
  ]);
  const cashIn = payments.filter((p) => p.kind === "payment" || p.kind === "deposit").reduce((a, p) => a + p.amount, 0);
  const cashOut = payments.filter((p) => p.kind === "refund" || p.kind === "deposit_refund").reduce((a, p) => a + p.amount, 0);
  const cashExpenses = expenses.reduce((a, e) => a + e.amount, 0);
  // The drawer starts with what was counted at the previous closing.
  const openingFloat = last?.counted || 0;
  return { payments, expenses, cashIn, cashOut, cashExpenses, openingFloat, expected: openingFloat + cashIn - cashOut - cashExpenses, lastClosedAt: last?.closedAt || null };
}

export async function GET(request: NextRequest) {
  const guard = await requirePermission("accounting", "view");
  if (!guard.ok) return guard.response;
  await connectDB();
  const agent = new URL(request.url).searchParams.get("agent") || "";
  const [open, closings, agents] = await Promise.all([
    openCash(agent),
    CashClosing.find({}).sort({ closedAt: -1 }).limit(100).lean(),
    Payment.distinct("recordedBy", { method: "cash" }),
  ]);
  return NextResponse.json({
    success: true,
    open: {
      agent,
      openingFloat: open.openingFloat,
      cashIn: open.cashIn,
      cashOut: open.cashOut,
      cashExpenses: open.cashExpenses,
      expected: open.expected,
      lastClosedAt: open.lastClosedAt,
      payments: open.payments,
      expenses: open.expenses,
    },
    closings,
    agents: (agents as string[]).sort(),
  });
}

const schema = z.object({
  agent: z.string().max(200).default(""),
  countedTND: z.number().min(0).max(100_000_000),
  notes: z.string().max(1000).optional().default(""),
});

/** Closes the cash drawer: locks the counted movements and stores the difference. */
export async function POST(request: NextRequest) {
  const guard = await requirePermission("accounting", "create");
  if (!guard.ok) return guard.response;
  const parsed = schema.safeParse(await request.json().catch(() => ({})));
  if (!parsed.success) return NextResponse.json({ success: false, error: parsed.error.issues[0]?.message || "Données invalides" }, { status: 400 });
  await connectDB();
  const d = parsed.data;
  const open = await openCash(d.agent);
  const counted = Math.round(d.countedTND * 100);
  const difference = counted - open.expected;
  if (difference !== 0 && !d.notes.trim()) {
    return NextResponse.json({ success: false, error: "Écart de caisse : une explication est obligatoire.", difference }, { status: 400 });
  }
  const closing = await CashClosing.create({
    number: await nextNumber("CAI"),
    closedAt: new Date(),
    closedBy: guard.session.user?.email || "inconnu",
    agent: d.agent,
    openingFloat: open.openingFloat,
    cashIn: open.cashIn,
    cashOut: open.cashOut,
    cashExpenses: open.cashExpenses,
    expected: open.expected,
    counted,
    difference,
    paymentCount: open.payments.length,
    expenseCount: open.expenses.length,
    notes: d.notes,
  });
  await Payment.updateMany({ _id: { $in: open.payments.map((p) => p._id) }, closingId: { $exists: false } }, { $set: { closingId: closing._id } });
  await Expense.updateMany({ _id: { $in: open.expenses.map((e) => e._id) }, closingId: { $exists: false } }, { $set: { closingId: closing._id } });
  await logAudit(guard.session, "cash.close", "cash_closing", String(closing._id), { after: { number: closing.number, expected: closing.expected, counted, difference } });
  return NextResponse.json({ success: true, closing }, { status: 201 });
}
