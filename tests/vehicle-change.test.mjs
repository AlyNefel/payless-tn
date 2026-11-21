// Car change during a rental: split of the physical cars, price difference, refunds, notifications.
import { admin, book, check, finish, pub } from "./lib.mjs";

const A = await admin();
const P = "2032-04-01", R = "2032-04-05"; // 4 days
const locs = (await pub("/api/locations")).locations;
const loc = locs[0]._id;
const list = (await pub(`/api/vehicles?pickupDate=${P}&returnDate=${R}&limit=100`)).vehicles.filter((v) => !(v.pricing.seasonalPrices || []).length);
const rate = (v) => v.periodPricing.dailyRate;
// A mid-priced model with 3 cars, a pricier one and a cheaper one.
const modelA = list.filter((v) => v.availableUnits === 3).find((a) => list.some((b) => rate(b) > rate(a) + 1000 && b.availableUnits >= 2) && list.some((c) => rate(c) < rate(a) && c.availableUnits >= 2));
const modelB = list.find((v) => v.availableUnits >= 2 && rate(v) > rate(modelA) + 1000);
const modelC = list.find((v) => v.availableUnits >= 2 && rate(v) < rate(modelA));
check("fixtures: three models at different prices", Boolean(modelA && modelB && modelC), `${modelA?.model} ${modelB?.model} ${modelC?.model}`);
const dA = modelA.periodPricing.dailyRate, dB = modelB.periodPricing.dailyRate, dC = modelC.periodPricing.dailyRate;

const idOf = async (ref) => (await A.req(`/api/admin/bookings?search=${ref}`)).j.bookings[0]._id;
const get = async (id) => (await A.req(`/api/admin/bookings/${id}`)).j.booking;
const act = (id, body) => A.req(`/api/admin/bookings/${id}`, "PATCH", body);

// Booking 1: model A, 4 days, started and fully paid.
const b1 = await book(modelA._id, loc, P, R);
const id1 = await idOf(b1.j.bookingReference);
await act(id1, { action: "record_pickup", mileage: 10000 });
const total1 = (await get(id1)).pricingBreakdown.totalAmount;
await A.req("/api/admin/accounting/payments", "POST", { bookingId: id1, kind: "payment", amountTND: total1 / 100, method: "cash" });
const oldUnit = String((await get(id1)).assignedUnits[0].unitId);
// The two other A cars are taken for the whole period.
const o1 = await book(modelA._id, loc, P, R);
const o2 = await book(modelA._id, loc, P, R);
check("model A is now full on the period", o1.s < 300 && o2.s < 300 && (await book(modelA._id, loc, P, R)).s === 409);

// ── Mixed price over two periods (new booking, extension, reduction, car change) ──
{
  const tnd = Math.round((dC * 1.5) / 100);
  const H = tnd * 100; // high-season daily rate (minor units); low season = dC
  // Model C: high season from 4 September.
  await A.req("/api/admin/vehicles/pricing", "PUT", { vehicleId: modelC._id, seasonalPrices: [{ name: "Haute", startDate: "09-04", endDate: "09-30", dailyRate: tnd, minDays: 0 }] });
  // New booking 2 → 6 Sept: 2 low days (2, 3) + 2 high days (4, 5).
  const mb = await book(modelC._id, loc, "2032-09-02", "2032-09-06");
  const mid = await idOf(mb.j.bookingReference);
  const mSub = (await get(mid)).pricingBreakdown.subtotal;
  check("booking over two periods: mixed price (2 low days + 2 high days)", mSub === 2 * dC + 2 * H, `subtotal=${mSub} expected ${2 * dC + 2 * H}`);
  const listed = (await pub(`/api/vehicles?pickupDate=2032-09-02&returnDate=2032-09-06&limit=100`)).vehicles.find((v) => v._id === modelC._id);
  check("public list shows the same mixed total", listed?.periodPricing?.total === 2 * dC + 2 * H, JSON.stringify(listed?.periodPricing));
  // Reduction by one day: the removed day (5 Sept, high season) is refunded at the high rate.
  let x = await act(mid, { action: "change_return", newReturnDate: "2032-09-05" });
  const mSub2 = (await get(mid)).pricingBreakdown.subtotal;
  check("reduction: removed high-season day refunded at the high rate", x.s === 200 && mSub2 === 2 * dC + H, `subtotal=${mSub2} expected ${2 * dC + H}`);

  // Booking 1 → 4 Sept (low season), extended to 6 Sept: the 2 extra days are high season.
  const eb = await book(modelC._id, loc, "2032-09-01", "2032-09-04");
  const eid = await idOf(eb.j.bookingReference);
  x = await act(eid, { action: "change_return", newReturnDate: "2032-09-06", dryRun: true });
  check("extension preview: extra days at their own period's rate, nothing saved", x.s === 200 && x.j.quote.dailyRate === H && (await get(eid)).returnDate.slice(0, 10) === "2032-09-04", JSON.stringify(x.j.quote));
  const sub0 = (await get(eid)).pricingBreakdown.subtotal;
  x = await act(eid, { action: "change_return", newReturnDate: "2032-09-06" });
  const sub1 = (await get(eid)).pricingBreakdown.subtotal;
  check("extension into the next period: +2 days at the high rate", x.s === 200 && sub1 - sub0 === 2 * H, `+${sub1 - sub0} expected +${2 * H}`);
  // A rental entirely in the high season stays at the high rate.
  const hb = await book(modelC._id, loc, "2032-09-10", "2032-09-13");
  const hid = await idOf(hb.j.bookingReference);
  x = await act(hid, { action: "change_return", newReturnDate: "2032-09-14", dryRun: true });
  check("rental in high season: extension at the high-season price", x.s === 200 && x.j.quote.dailyRate === H, JSON.stringify(x.j.quote));
  // Car change on 5 Sept of a 1 → 7 Sept rental (3 low + 3 high days): the 2 changed days are high
  // season for both cars, so the same model costs exactly the same (no false difference).
  const cb = await book(modelC._id, loc, "2032-09-01", "2032-09-07");
  const cid = await idOf(cb.j.bookingReference);
  x = await act(cid, { action: "change_vehicle", effectiveDate: "2032-09-05", newVehicleId: modelC._id, dryRun: true });
  check("car change: changed days at their period's rate, same model = no difference", x.s === 200 && x.j.quote.newDailyRate === H && x.j.quote.daysChanged === 2 && x.j.quote.amount === 0, JSON.stringify({ rate: x.j.quote?.newDailyRate, days: x.j.quote?.daysChanged, amount: x.j.quote?.amount }));
  await A.req("/api/admin/vehicles/pricing", "PUT", { vehicleId: modelC._id, seasonalPrices: [] });
  for (const i of [mid, eid, hid, cid]) await act(i, { status: "cancelled" });
}

// ── Edge cases ──
let r = await act(id1, { action: "change_vehicle", effectiveDate: R, newVehicleId: modelB._id, reason: "x" });
check("change on the return day refused", r.s === 400, r.j.error);
r = await act(id1, { action: "change_vehicle", effectiveDate: "2032-04-03", newVehicleId: modelA._id, reason: "x" });
check("same model with no other free car refused", r.s === 409, r.j.error);
r = await act(id1, { action: "change_vehicle", effectiveDate: "2032-04-03", newVehicleId: modelB._id, reason: "" });
check("motif required", r.s === 400, r.j.error);

// ── Quote (dry run) ──
r = await act(id1, { action: "change_vehicle", effectiveDate: "2032-04-03", newVehicleId: modelB._id, dryRun: true });
const q = r.j.quote;
check("quote: 2 days at the new rate, nothing saved", r.s === 200 && q.daysChanged === 2 && q.amount === (dB - dA) * 2 && q.remaining === q.amount && (await get(id1)).vehicleChanges.length === 0, JSON.stringify({ days: q?.daysChanged, amount: q?.amount }));

// ── Mid-rental change to a more expensive car ──
r = await act(id1, { action: "change_vehicle", effectiveDate: "2032-04-03", newVehicleId: modelB._id, reason: "Panne moteur", oldCarMileage: 10250, newCarMileage: 30000, oldCarToGarage: true });
check("change accepted", r.s === 200, r.j.error);
check("customer owes the difference for the 2 remaining days", r.j.money.remaining === (dB - dA) * 2 && r.j.money.refundDue === 0);
const after = await get(id1);
const units = after.assignedUnits;
const oldEntry = units.find((u) => String(u.unitId) === oldUnit);
const newEntry = units.find((u) => !u.to);
check("old car kept for days 1-2, new car from day 3", oldEntry?.to?.slice(0, 10) === "2032-04-03" && newEntry?.from?.slice(0, 10) === "2032-04-03" && String(newEntry.vehicleId) === modelB._id);
check("booking now on the new model", String(after.vehicleId._id || after.vehicleId) === modelB._id && after.vehicleChanges.length === 1);
check("departure mileage = new car's odometer", after.pickupMileage === 30000);
check("customer WhatsApp message prepared without plate", typeof r.j.customer.whatsappUrl === "string" && !decodeURIComponent(r.j.customer.whatsappUrl).includes(oldEntry.licensePlate || "§§") && decodeURIComponent(r.j.customer.whatsappUrl).includes(modelB.model));
const fleet = (await A.req("/api/admin/fleet/units")).j.models.find((m) => m._id === modelA._id || m.vehicleId === modelA._id);
const oldCar = fleet?.units.find((u) => u.unitId === oldUnit);
check("old car sent to the garage", oldCar?.status === "maintenance", oldCar?.status);

// Old car days 3-4 are free again (but it is in the garage): repair it, then book A on days 3-5.
await A.req("/api/admin/fleet/units", "PATCH", { vehicleId: modelA._id, unitId: oldUnit, status: "active" });
r = await book(modelA._id, loc, "2032-04-03", "2032-04-05");
check("the replaced car is bookable from the change date", r.s < 300, r.j.error || "");
r = await book(modelA._id, loc, "2032-04-01", "2032-04-03");
check("…but still held for the first two days", r.s === 409);

// ── Return after a change: mileage checked against the new car ──
r = await act(id1, { action: "record_return", mileage: 29000 });
check("return below the NEW car's departure km refused", r.s === 400);
// Extension then reduction after the change.
r = await act(id1, { action: "change_return", newReturnDate: "2032-04-02" });
check("reduction before the change date refused", r.s === 409, r.j.error);
r = await act(id1, { action: "change_return", newReturnDate: "2032-04-06" });
check("extension uses the new car and its rate", r.s === 200 && r.j.amount >= dB, `amount=${r.j.amount}`);
check("customer told about the new date", typeof r.j.customer?.whatsappUrl === "string");
r = await act(id1, { action: "change_return", newReturnDate: "2032-04-05" });
check("reduction refunds the current car's rate", r.s === 200 && r.j.amount <= -dB + 1, `amount=${r.j.amount}`);

// ── Downgrade before departure, already paid → refund due ──
const P2 = "2032-05-10", R2 = "2032-05-13";
const b2 = await book(modelA._id, loc, P2, R2);
const id2 = await idOf(b2.j.bookingReference);
const t2 = (await get(id2)).pricingBreakdown.totalAmount;
await A.req("/api/admin/accounting/payments", "POST", { bookingId: id2, kind: "payment", amountTND: t2 / 100, method: "card" });
r = await act(id2, { action: "change_vehicle", effectiveDate: P2, newVehicleId: modelC._id, reason: "Demande du client" });
check("whole-rental change to a cheaper car → refund due", r.s === 200 && r.j.money.refundDue === (dA - dC) * 3 && r.j.money.remaining === 0, JSON.stringify(r.j.money));
const b2after = await get(id2);
check("no split when the change is on the first day", b2after.assignedUnits.length === 1 && !b2after.assignedUnits[0].to && !b2after.assignedUnits[0].from);
r = await A.req("/api/admin/accounting/payments", "POST", { bookingId: id2, kind: "refund", amountTND: (dA - dC) * 3 / 100, method: "card" });
check("refund recorded in the ledger closes the gap", r.s === 201 && r.j.money.refundDue === 0 && r.j.money.paid === b2after.pricingBreakdown.totalAmount);
const s = (await A.req("/api/admin/accounting/summary?from=2026-01-01&to=2032-12-31")).j.summary;
check("accounting lists customers to refund", Array.isArray(s.refundsDue));

// ── Keep price ──
const b3 = await book(modelC._id, loc, "2032-06-01", "2032-06-04");
const id3 = await idOf(b3.j.bookingReference);
const t3 = (await get(id3)).pricingBreakdown.totalAmount;
r = await act(id3, { action: "change_vehicle", effectiveDate: "2032-06-01", newVehicleId: modelB._id, priceMode: "keep", reason: "Surclassement offert" });
check("free upgrade keeps the total", r.s === 200 && r.j.money.total === t3);

// ── Guards ──
r = await act(id3, { vehicleId: modelA._id });
check("model change through the generic form is redirected", r.s === 409 && r.j.code === "USE_CHANGE_VEHICLE");
r = await act(id1, { pickupDate: "2032-03-30" });
check("start date locked after a mid-rental change", r.s === 409, r.j.error);
r = await act(id1, { action: "change_vehicle", effectiveDate: "2032-04-02", newVehicleId: modelC._id, reason: "x" });
check("second change before the first one refused", r.s === 400, r.j.error);

// ── Documents, notifications, integrity ──
const inv = await A.raw(`/api/admin/bookings/${id1}/invoice`);
check("invoice still generated after the change", inv.status === 200 && (await inv.arrayBuffer()).byteLength > 10000);
const notes = (await A.req("/api/admin/notifications?limit=50")).j.notifications.filter((n) => n.type === "vehicle_change");
check("team notified", notes.length >= 3);
const audit = (await A.req("/api/admin/fleet/integrity")).j.report;
check("integrity: no car shared, nothing orphaned", audit.conflicts.length === 0 && audit.orphanAssignments.length === 0, JSON.stringify(audit.conflicts));
finish();
