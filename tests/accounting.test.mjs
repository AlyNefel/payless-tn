// Accounting: payment ledger, expenses with receipts, cash closing, documents, permissions.
import { admin, book, check, day, finish, fixtures, session, tag } from "./lib.mjs";

const A = await admin();
const P = "2030-02-03", R = "2030-02-06";
const { car, locationId } = await fixtures(P, R);
const b = await book(car._id, locationId, P, R);
const ref = b.j.bookingReference;
const row = (await A.req(`/api/admin/bookings?search=${ref}`)).j.bookings[0];
const id = row._id;
const total = row.totalAmount;
check("booking created for the ledger tests", b.s < 300 && total > 0, `${ref} total=${total}`);

const pay = (S, body) => S.req("/api/admin/accounting/payments", "POST", { bookingId: id, method: "cash", ...body });
const money = async () => (await A.req(`/api/admin/accounting/payments?bookingId=${id}`)).j;

// ── Ledger rules ──
let r = await pay(A, { kind: "payment", amountTND: total / 100 + 1 });
check("paying more than the balance is refused", r.s === 400, r.j.error);
r = await pay(A, { kind: "refund", amountTND: 10 });
check("refund without any payment is refused", r.s === 400, r.j.error);
r = await pay(A, { kind: "payment", amountTND: 100 });
check("partial payment recorded with a receipt number", r.s === 201 && /^REC-\d{4}-\d{5}$/.test(r.j.payment.receiptNumber), r.j.payment?.receiptNumber);
const firstId = r.j.payment._id;
check("booking becomes 'partial'", r.j.money.paymentStatus === "partial" && r.j.money.paid === 10000 && r.j.money.remaining === total - 10000);
r = await pay(A, { kind: "deposit", amountTND: 500, method: "card", reference: "TPE 4471" });
check("deposit recorded, not counted as revenue", r.s === 201 && r.j.money.depositHeld === 50000 && r.j.money.paid === 10000);
r = await pay(A, { kind: "deposit_refund", amountTND: 600 });
check("giving back more deposit than held is refused", r.s === 400, r.j.error);
r = await pay(A, { kind: "payment", amountTND: (total - 10000) / 100, method: "bank_transfer", reference: "VIR 22" });
check("balance paid → booking 'paid'", r.s === 201 && r.j.money.paymentStatus === "paid" && r.j.money.remaining === 0);
const list = (await A.req(`/api/admin/bookings?search=${ref}`)).j.bookings[0];
check("booking list reflects the ledger", list.paymentStatus === "paid" && list.amountPaid === total && list.depositHeld === 50000);
const numbers = (await money()).payments.map((p) => p.receiptNumber);
check("receipt numbers are unique", new Set(numbers).size === numbers.length, numbers.join(","));

// concurrent payments cannot overpay… they are validated one by one; at least numbering stays unique
const b2 = await book(car._id, locationId, "2030-02-10", "2030-02-12");
const id2 = (await A.req(`/api/admin/bookings?search=${b2.j.bookingReference}`)).j.bookings[0]._id;
const burst = await Promise.all([1, 2, 3, 4, 5].map(() => A.req("/api/admin/accounting/payments", "POST", { bookingId: id2, kind: "deposit", amountTND: 10, method: "cash" })));
const burstNumbers = burst.filter((x) => x.s === 201).map((x) => x.j.payment.receiptNumber);
check("5 simultaneous movements get 5 different receipt numbers", burstNumbers.length === 5 && new Set(burstNumbers).size === 5);

// ── Void ──
r = await A.req(`/api/admin/accounting/payments?id=${firstId}&reason=`, "DELETE");
check("void without a reason is refused", r.s === 400, r.j.error);
r = await A.req(`/api/admin/accounting/payments?id=${firstId}&reason=${encodeURIComponent("erreur de saisie")}`, "DELETE");
check("void keeps the line and re-opens the balance", r.s === 200 && r.j.money.paymentStatus === "partial" && r.j.money.remaining === 10000);
const voided = (await money()).payments.find((p) => p._id === firstId);
check("voided movement still in the ledger with its reason", voided?.status === "voided" && voided.voidReason === "erreur de saisie");
r = await A.req(`/api/admin/bookings/${id}`, "PATCH", { paymentStatus: "paid" });
const after = await money();
check("'Payé' from the booking form records the balance as a payment", r.s === 200 && after.money.remaining === 0 && after.payments.filter((p) => p.status === "completed" && p.kind === "payment").length === 2);
r = await A.req(`/api/admin/bookings/${id}`, "PATCH", { paymentStatus: "unpaid" });
check("status cannot be forced to 'unpaid' while payments exist", r.s === 409, r.j.error);

// ── Documents ──
const pdf = async (path) => {
  const res = await A.raw(path);
  const buf = Buffer.from(await res.arrayBuffer());
  return { s: res.status, type: res.headers.get("content-type"), ok: buf.subarray(0, 5).toString() === "%PDF-", size: buf.length, text: buf.toString("latin1") };
};
r = await A.req(`/api/admin/bookings/${id}/contract`, "PUT", { driver: { fullName: "Test Client", idType: "cin", idNumber: "09876543", licenceNumber: "TN-55/1234", nationality: "Tunisienne" }, secondDriver: { fullName: "Second Driver", licenceNumber: "TN-77" } });
check("driver identity saved for the contract", r.s === 200, r.j.error);
let d = await pdf(`/api/admin/bookings/${id}/contract`);
check("rental contract PDF generated", d.s === 200 && d.ok && d.size > 20000, `size=${d.size}`);
const c1 = (await A.req(`/api/admin/bookings?search=${ref}`)).j.bookings[0].contractNumber;
await pdf(`/api/admin/bookings/${id}/contract`);
const c2 = (await A.req(`/api/admin/bookings?search=${ref}`)).j.bookings[0].contractNumber;
check("contract number assigned once and stable", /^CTR-\d{4}-\d{5}$/.test(c1) && c1 === c2, c1);
d = await pdf(`/api/admin/bookings/${id}/invoice`);
const inv = (await A.req(`/api/admin/bookings?search=${ref}`)).j.bookings[0].invoiceNumber;
check("invoice PDF generated with a sequential number", d.s === 200 && d.ok && /^FAC-\d{4}-\d{5}$/.test(inv), inv);
d = await pdf(`/api/admin/accounting/payments/${firstId}/receipt`);
check("receipt PDF generated", d.s === 200 && d.ok);
const anon = await fetch(`${process.env.TEST_URL || "http://localhost:3456"}/api/admin/bookings/${id}/contract`);
check("contract not readable without login", anon.status === 401);

// ── Expenses ──
const png = Buffer.from("iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNkYPhfDwAChwGA60e6kgAAAABJRU5ErkJggg==", "base64");
const up = await A.upload("/api/admin/documents", png, "ticket.png", "image/png", { purpose: "expense" });
check("expense receipt image uploaded", up.s === 201, up.j.error || up.j.url);
const exp = (body) => A.req("/api/admin/accounting/expenses", "POST", { date: day(0), category: "fuel", label: `Plein ${tag}`, amountTND: 80, vatTND: 12.773, method: "cash", receiptUrl: up.j.url, vehicleId: car._id, ...body });
r = await exp({});
check("expense created with its receipt", r.s === 201 && /^DEP-\d{4}-\d{5}$/.test(r.j.expense.number), r.j.expense?.number);
const expId = r.j.expense._id;
r = await exp({ vatTND: 500 });
check("VAT above the amount is refused", r.s === 400, r.j.error);
r = await exp({ receiptUrl: "javascript:alert(1)" });
check("unsafe receipt link refused", r.s === 400, r.j.error);
r = await A.req("/api/admin/accounting/expenses", "PUT", { id: expId, date: day(0), category: "maintenance", label: `Vidange ${tag}`, amountTND: 95, vatTND: 0, method: "cash", receiptUrl: up.j.url, vehicleId: car._id });
check("expense edited", r.s === 200 && r.j.expense.amount === 9500 && r.j.expense.category === "maintenance");
const today = day(0);
r = await A.req(`/api/admin/accounting/expenses?from=${today}&to=${today}&q=${tag}`);
check("expense list + totals", r.j.expenses.length === 1 && r.j.totals.amount === 9500 && r.j.expenses[0].vehicleName.length > 0);

// ── Summary ──
r = await A.req(`/api/admin/accounting/summary?from=${today}&to=${today}`);
const s = r.j.summary;
check("summary: collected = payments − refunds (voided ignored)", r.s === 200 && s.kpis.collected >= total, `collected=${s?.kpis.collected}`);
check("summary: expenses and result", s.kpis.expenses >= 9500 && s.kpis.result === s.kpis.collected - s.kpis.expenses);
check("summary: deposits held listed", s.deposits.some((x) => x.reference === ref && x.held === 50000));
check("summary: 12 months series", s.monthly.length === 12);
r = await A.req(`/api/admin/accounting/summary?from=2030-02-01&to=2030-02-28`);
check("summary: invoiced revenue by rental start + VAT estimate", r.j.summary.kpis.invoiced >= total && r.j.summary.kpis.vatCollected > 0 && r.j.summary.vehicles.some((v) => v.vehicleId === car._id && v.revenue > 0));

// ── Cash closing ──
r = await A.req("/api/admin/accounting/closings");
const open = r.j.open;
check("cash drawer: expected = float + cash in − cash out − cash expenses", open.expected === open.openingFloat + open.cashIn - open.cashOut - open.cashExpenses && open.cashExpenses >= 9500);
r = await A.req("/api/admin/accounting/closings", "POST", { agent: "", countedTND: open.expected / 100 - 5 });
check("closing with a difference needs an explanation", r.s === 400, r.j.error);
r = await A.req("/api/admin/accounting/closings", "POST", { agent: "", countedTND: open.expected / 100 - 5, notes: "5 DT de monnaie manquante" });
check("closing stored with its difference", r.s === 201 && r.j.closing.difference === -500 && /^CAI-/.test(r.j.closing.number));
r = await A.req("/api/admin/accounting/closings");
check("after closing: nothing left to count, float = counted amount", r.j.open.payments.length === 0 && r.j.open.expenses.length === 0 && r.j.open.openingFloat === open.expected - 500);
r = await A.req(`/api/admin/accounting/expenses?id=${expId}`, "DELETE");
check("closed expense cannot be deleted", r.s === 409, r.j.error);
const cashPay = (await money()).payments.find((p) => p.method === "cash" && p.status === "completed");
r = await A.req(`/api/admin/accounting/payments?id=${cashPay._id}&reason=test`, "DELETE");
check("closed cash movement cannot be voided", r.s === 409, r.j.error);

// ── Exports ──
const csv = await A.raw(`/api/admin/accounting/export?type=journal&from=${today}&to=${today}`);
const bytes = Buffer.from(await csv.arrayBuffer());
const text = bytes.toString("utf8");
// UTF-8 BOM (EF BB BF) so Excel reads the accents; fetch().text() would strip it.
check("journal CSV export (Excel FR format)", csv.status === 200 && bytes[0] === 0xef && bytes[1] === 0xbb && text.includes(";") && text.includes(ref));
r = await A.req("/api/admin/accounting/expenses", "POST", { date: day(0), category: "other", label: "=HYPERLINK(\"http://x\")", amountTND: 1, method: "card" });
const csv2 = await (await A.raw(`/api/admin/accounting/export?type=expenses&from=${today}&to=${today}`)).text();
check("CSV neutralises spreadsheet formulas", csv2.includes("'=HYPERLINK"));

// ── Roles ──
const mail = (k) => `${k}_${tag}@example.com`;
await A.req("/api/admin/users", "POST", { name: "Comptable Test", email: mail("acc"), password: "comptable123", role: "accountant" });
await A.req("/api/admin/users", "POST", { name: "Agent Test", email: mail("wrk"), password: "workerpass1", role: "worker" });
const C = await session().login(mail("acc"), "comptable123");
const W = await session().login(mail("wrk"), "workerpass1");
r = await C.req("/api/admin/me");
check("accountant role signs in with accounting access", r.j.user?.role === "accountant" && r.j.access?.accounting === "edit", JSON.stringify(r.j.access?.accounting));
check("accountant reads the dashboard", (await C.req(`/api/admin/accounting/summary?from=${today}&to=${today}`)).s === 200);
check("accountant creates an expense", (await C.req("/api/admin/accounting/expenses", "POST", { date: day(0), category: "office", label: "Papier", amountTND: 12, method: "card" })).s === 201);
for (const [name, path, method, body] of [
  ["fleet", "/api/admin/vehicles", "GET"],
  ["users", "/api/admin/users", "GET"],
  ["settings", "/api/admin/settings", "GET"],
  ["pricing rules", "/api/admin/rental-rules", "PUT", { minRentalDaysGlobal: 3 }],
  ["booking edit", `/api/admin/bookings/${id}`, "PATCH", { internalNotes: "x" }],
  ["audit journal", "/api/admin/audit", "GET"],
]) {
  const x = await C.req(path, method, body);
  check(`accountant blocked: ${name}`, x.s === 403, `status=${x.s}`);
}
check("worker blocked from the accounting dashboard", (await W.req(`/api/admin/accounting/summary`)).s === 403);
check("worker blocked from the whole ledger", (await W.req(`/api/admin/accounting/payments?from=${today}&to=${today}`)).s === 403);
check("worker blocked from expenses", (await W.req("/api/admin/accounting/expenses")).s === 403);
check("worker sees the payments of one booking", (await W.req(`/api/admin/accounting/payments?bookingId=${id2}`)).s === 200);
r = await W.req("/api/admin/accounting/payments", "POST", { bookingId: id2, kind: "payment", amountTND: 50, method: "cash" });
check("worker records a payment at the counter", r.s === 201 && r.j.payment.recordedBy === mail("wrk"));
r = await W.req("/api/admin/accounting/payments", "POST", { bookingId: id2, kind: "refund", amountTND: 10, method: "cash" });
check("worker cannot refund", r.s === 403, r.j.error);
r = await W.req(`/api/admin/accounting/payments?id=${r.j.payment?._id || firstId}&reason=x`, "DELETE");
check("worker cannot void a payment", r.s === 403);
r = await W.req("/api/admin/accounting/payments", "POST", { bookingId: id2, kind: "payment", amountTND: 5, method: "cash", paidAt: "2020-01-01" });
check("worker cannot back-date a payment", r.s === 201 && new Date(r.j.payment.paidAt).getFullYear() >= new Date().getFullYear());

// ── Audit journal ──
r = await A.req("/api/admin/audit?resource=payment");
check("audit journal lists money actions with their author", r.s === 200 && r.j.logs.some((l) => l.action === "payment.void") && r.j.logs.some((l) => l.userEmail === mail("wrk")));
finish();
