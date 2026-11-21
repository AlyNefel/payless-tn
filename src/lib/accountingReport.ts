import connectDB from "./db";
import { Booking, Expense, MaintenanceRecord, Payment, Vehicle } from "@/models";
import { getVatRate, splitVat } from "./ledger";

const BILLABLE = ["confirmed", "awaiting_payment", "paid", "active", "completed"] as const;
const DAY = 86_400_000;

export interface AccountingSummary {
  period: { from: string; to: string; days: number };
  vatRate: number;
  kpis: {
    invoiced: number; // rentals starting in the period (tax incl.)
    collected: number; // payments − refunds, by payment date
    expenses: number;
    result: number; // collected − expenses
    receivables: number; // all unpaid balances
    depositsHeld: number;
    vatCollected: number;
    vatDeductible: number;
    vatDue: number;
    bookings: number;
    rentedDays: number;
    occupancy: number; // %
    averageBasket: number;
    stampDuty: number;
  };
  byMethod: { method: string; amount: number }[];
  byCategory: { category: string; amount: number }[];
  monthly: { month: string; collected: number; expenses: number; invoiced: number }[];
  vehicles: { vehicleId: string; name: string; units: number; bookings: number; rentedDays: number; occupancy: number; revenue: number; expenses: number; margin: number }[];
  receivables: { bookingId: string; reference: string; customer: string; phone: string; total: number; paid: number; remaining: number; returnDate: Date; status: string }[];
  /** Customers who paid more than the (new) total after a car change or a shortened rental. */
  refundsDue: { bookingId: string; reference: string; customer: string; phone: string; total: number; paid: number; due: number }[];
  deposits: { bookingId: string; reference: string; customer: string; held: number; status: string; returnDate: Date }[];
  topCustomers: { customer: string; bookings: number; revenue: number }[];
  agents: { agent: string; collected: number; count: number }[];
}

/** Every figure of the accounting dashboard for a period. Amounts in minor units. */
export async function buildSummary(from: Date, to: Date, fromStr: string, toStr: string): Promise<AccountingSummary> {
  await connectDB();
  const vatRate = await getVatRate();
  const days = Math.max(1, Math.round((to.getTime() - from.getTime()) / DAY));

  const yearAgo = new Date(Date.UTC(to.getUTCFullYear(), to.getUTCMonth() - 11, 1));
  const [payments, expenses, bookings, overlapping, vehicles, maintenance, open, monthlyPay, monthlyExp, monthlyInv] = await Promise.all([
    Payment.find({ status: "completed", paidAt: { $gte: from, $lte: to } }).lean(),
    Expense.find({ date: { $gte: from, $lte: to } }).lean(),
    Booking.find({ bookingStatus: { $in: BILLABLE }, pickupDate: { $gte: from, $lte: to } })
      .populate("customerId", "firstName lastName phone")
      .select("bookingReference customerId vehicleId vehicles pricingBreakdown pickupDate returnDate rentalDuration bookingStatus")
      .lean(),
    Booking.find({ bookingStatus: { $in: BILLABLE }, pickupDate: { $lte: to }, returnDate: { $gte: from } })
      .select("vehicleId vehicles pickupDate returnDate")
      .lean(),
    Vehicle.find({}).select("brand model units._id totalUnits").lean(),
    MaintenanceRecord.find({ startDate: { $gte: from, $lte: to } }).select("vehicleId cost").lean().catch(() => []),
    Booking.find({ bookingStatus: { $in: BILLABLE } })
      .populate("customerId", "firstName lastName phone")
      .select("bookingReference customerId pricingBreakdown.totalAmount amountPaid depositHeld returnDate bookingStatus paymentStatus")
      .lean(),
    Payment.aggregate<{ _id: { m: string; k: string }; sum: number }>([
      { $match: { status: "completed", paidAt: { $gte: yearAgo, $lte: to } } },
      { $group: { _id: { m: { $dateToString: { format: "%Y-%m", date: "$paidAt" } }, k: "$kind" }, sum: { $sum: "$amount" } } },
    ]),
    Expense.aggregate<{ _id: string; sum: number }>([
      { $match: { date: { $gte: yearAgo, $lte: to } } },
      { $group: { _id: { $dateToString: { format: "%Y-%m", date: "$date" } }, sum: { $sum: "$amount" } } },
    ]),
    Booking.aggregate<{ _id: string; sum: number }>([
      { $match: { bookingStatus: { $in: [...BILLABLE] }, pickupDate: { $gte: yearAgo, $lte: to } } },
      { $group: { _id: { $dateToString: { format: "%Y-%m", date: "$pickupDate" } }, sum: { $sum: "$pricingBreakdown.totalAmount" } } },
    ]),
  ]);

  const sumKind = (k: string) => payments.filter((p) => p.kind === k).reduce((a, p) => a + p.amount, 0);
  const collected = sumKind("payment") - sumKind("refund");
  const expenseTotal = expenses.reduce((a, e) => a + e.amount, 0);
  const invoiced = bookings.reduce((a, b) => a + (b.pricingBreakdown?.totalAmount || 0), 0);
  // Stamp duty and the LF contribution are not subject to VAT.
  const stampDuty = bookings.reduce((a, b) => a + (b.pricingBreakdown?.timbreFiscal || 0), 0);
  const contribution = bookings.reduce((a, b) => a + (b.pricingBreakdown?.contributionLF2026 || 0), 0);
  const vatCollected = splitVat(Math.max(0, invoiced - stampDuty - contribution), vatRate).vat;
  const vatDeductible = expenses.reduce((a, e) => a + (e.vatAmount || 0), 0);

  const methods = new Map<string, number>();
  for (const p of payments) {
    const sign = p.kind === "payment" ? 1 : p.kind === "refund" ? -1 : 0;
    if (sign) methods.set(p.method, (methods.get(p.method) || 0) + sign * p.amount);
  }
  const categories = new Map<string, number>();
  for (const e of expenses) categories.set(e.category, (categories.get(e.category) || 0) + e.amount);

  // Months of the last 12 months, oldest first.
  const monthly: AccountingSummary["monthly"] = [];
  for (let i = 0; i < 12; i++) {
    const d = new Date(Date.UTC(yearAgo.getUTCFullYear(), yearAgo.getUTCMonth() + i, 1));
    const key = d.toISOString().slice(0, 7);
    const pay = (k: string) => monthlyPay.find((r) => r._id.m === key && r._id.k === k)?.sum || 0;
    monthly.push({
      month: key,
      collected: pay("payment") - pay("refund"),
      expenses: monthlyExp.find((r) => r._id === key)?.sum || 0,
      invoiced: monthlyInv.find((r) => r._id === key)?.sum || 0,
    });
  }

  // Per model: revenue of rentals starting in the period, days rented inside the period.
  const modelsOf = (b: { vehicleId?: unknown; vehicles?: { vehicleId?: unknown }[] }) =>
    b.vehicles && b.vehicles.length ? b.vehicles.map((v) => String(v.vehicleId)) : [String(b.vehicleId)];
  const stats = new Map<string, { bookings: number; rentedDays: number; revenue: number; expenses: number }>();
  const stat = (id: string) => {
    if (!stats.has(id)) stats.set(id, { bookings: 0, rentedDays: 0, revenue: 0, expenses: 0 });
    return stats.get(id)!;
  };
  for (const b of bookings) {
    const ids = modelsOf(b);
    const lines = (b.vehicles || []) as { vehicleId?: unknown; subtotal?: number }[];
    ids.forEach((id, i) => {
      const s = stat(id);
      s.bookings++;
      s.revenue += lines[i]?.subtotal ?? Math.round((b.pricingBreakdown?.subtotal || 0) / ids.length);
    });
  }
  let rentedDays = 0;
  for (const b of overlapping) {
    const start = Math.max(new Date(b.pickupDate).getTime(), from.getTime());
    const end = Math.min(new Date(b.returnDate).getTime(), to.getTime());
    const d = Math.max(0, Math.round((end - start) / DAY));
    for (const id of modelsOf(b)) {
      stat(id).rentedDays += d;
      rentedDays += d;
    }
  }
  for (const e of expenses) if (e.vehicleId) stat(String(e.vehicleId)).expenses += e.amount;
  for (const m of maintenance as { vehicleId?: unknown; cost?: number }[]) if (m.vehicleId) stat(String(m.vehicleId)).expenses += Math.round(Number(m.cost || 0) * 100); // garage costs are stored in TND

  let fleetUnits = 0;
  const vehicleRows = vehicles.map((v) => {
    const units = Math.max(1, (v.units || []).length || Number((v as { totalUnits?: number }).totalUnits) || 1);
    fleetUnits += units;
    const s = stats.get(String(v._id)) || { bookings: 0, rentedDays: 0, revenue: 0, expenses: 0 };
    return {
      vehicleId: String(v._id),
      name: `${v.brand} ${v.model}`,
      units,
      bookings: s.bookings,
      rentedDays: s.rentedDays,
      occupancy: Math.min(100, Math.round((s.rentedDays / (units * days)) * 100)),
      revenue: s.revenue,
      expenses: s.expenses,
      margin: s.revenue - s.expenses,
    };
  });

  type Cust = { firstName?: string; lastName?: string; phone?: string } | null;
  const name = (c: Cust) => `${c?.firstName || ""} ${c?.lastName || ""}`.trim() || "—";
  const receivables = open
    .map((b) => {
      const total = b.pricingBreakdown?.totalAmount || 0;
      // Bookings marked paid before the ledger existed have no movement: they are not receivables.
      const paid = b.amountPaid || (b.paymentStatus === "paid" ? total : 0);
      const c = b.customerId as unknown as Cust;
      return { bookingId: String(b._id), reference: b.bookingReference, customer: name(c), phone: c?.phone || "", total, paid, remaining: total - paid, returnDate: b.returnDate, status: b.bookingStatus };
    })
    .filter((r) => r.remaining > 0)
    .sort((a, b) => b.remaining - a.remaining);
  // Cancelled or refused bookings keep nothing: every dinar still held is owed back (or must be
  // recorded as a cancellation fee). They were invisible in every report before.
  const cancelledWithMoney = await Booking.find({
    bookingStatus: { $in: ["cancelled", "rejected"] },
    $or: [{ amountPaid: { $gt: 0 } }, { depositHeld: { $gt: 0 } }],
  })
    .populate("customerId", "firstName lastName phone")
    .select("bookingReference customerId pricingBreakdown.totalAmount amountPaid depositHeld returnDate bookingStatus paymentStatus")
    .lean();
  const refundsDue = [
    ...cancelledWithMoney.map((b) => ({ ...b, pricingBreakdown: { totalAmount: 0 } })),
    ...open,
  ]
    .filter((b) => (b.amountPaid || 0) > (b.pricingBreakdown?.totalAmount || 0))
    .map((b) => {
      const c = b.customerId as unknown as Cust;
      const total = b.pricingBreakdown?.totalAmount || 0;
      return { bookingId: String(b._id), reference: b.bookingReference, customer: name(c), phone: c?.phone || "", total, paid: b.amountPaid || 0, due: (b.amountPaid || 0) - total };
    })
    .sort((a, b) => b.due - a.due);
  const deposits = [...open, ...cancelledWithMoney]
    .filter((b) => (b.depositHeld || 0) > 0)
    .map((b) => ({ bookingId: String(b._id), reference: b.bookingReference, customer: name(b.customerId as unknown as Cust), held: b.depositHeld || 0, status: b.bookingStatus, returnDate: b.returnDate }));

  const customers = new Map<string, { bookings: number; revenue: number }>();
  for (const b of bookings) {
    const key = name(b.customerId as unknown as Cust);
    const c = customers.get(key) || { bookings: 0, revenue: 0 };
    c.bookings++;
    c.revenue += b.pricingBreakdown?.totalAmount || 0;
    customers.set(key, c);
  }
  const agents = new Map<string, { collected: number; count: number }>();
  for (const p of payments) {
    if (p.kind !== "payment" && p.kind !== "refund") continue;
    const a = agents.get(p.recordedBy) || { collected: 0, count: 0 };
    a.collected += p.kind === "payment" ? p.amount : -p.amount;
    a.count++;
    agents.set(p.recordedBy, a);
  }

  return {
    period: { from: fromStr, to: toStr, days },
    vatRate,
    kpis: {
      invoiced,
      collected,
      expenses: expenseTotal,
      result: collected - expenseTotal,
      receivables: receivables.reduce((a, r) => a + r.remaining, 0),
      depositsHeld: deposits.reduce((a, d) => a + d.held, 0),
      vatCollected,
      vatDeductible,
      vatDue: vatCollected - vatDeductible,
      bookings: bookings.length,
      rentedDays,
      occupancy: fleetUnits ? Math.min(100, Math.round((rentedDays / (fleetUnits * days)) * 100)) : 0,
      averageBasket: bookings.length ? Math.round(invoiced / bookings.length) : 0,
      stampDuty,
    },
    byMethod: [...methods].map(([method, amount]) => ({ method, amount })).sort((a, b) => b.amount - a.amount),
    byCategory: [...categories].map(([category, amount]) => ({ category, amount })).sort((a, b) => b.amount - a.amount),
    monthly,
    vehicles: vehicleRows.sort((a, b) => b.revenue - a.revenue),
    receivables: receivables.slice(0, 200),
    refundsDue,
    deposits,
    topCustomers: [...customers].map(([customer, v]) => ({ customer, ...v })).sort((a, b) => b.revenue - a.revenue).slice(0, 10),
    agents: [...agents].map(([agent, v]) => ({ agent, ...v })).sort((a, b) => b.collected - a.collected),
  };
}
