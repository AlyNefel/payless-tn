// Date changes by the customer or the agency: re-priced with the booking rules, minimum enforced,
// every fee kept; cancellation with money held raises an alert; contract mentions car changes.
import { B, admin, check, finish, pub, tag } from "./lib.mjs";

const A = await admin();
const loc = (await pub("/api/locations")).locations[0]._id;
const list = (await pub(`/api/vehicles?pickupDate=2034-03-01&returnDate=2034-03-04&limit=100`)).vehicles.filter((v) => !(v.pricing.seasonalPrices || []).length && v.availableUnits >= 2);
const car = list[0];
const baseTND = car.pricing.daily / 100;
// High season for this model only: July–August at +50 %, 5 days minimum.
let r = await A.req("/api/admin/vehicles/pricing", "PUT", { vehicleId: car._id, seasonalPrices: [{ name: "Été", startDate: "07-01", endDate: "08-31", dailyRate: Math.round(baseTND * 1.5), minDays: 5 }] });
check("model period saved", r.s === 200, r.j.error || "");
const email = `dc_${tag}@example.com`;
const book = async (p, q) => {
  const res = await fetch(`${B}/api/bookings`, { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ vehicleId: car._id, vehicles: [{ vehicleId: car._id, extras: [] }], pickupLocationId: loc, returnLocationId: loc, pickupDate: p, returnDate: q, pickupTime: "10:00", returnTime: "10:00", customer: { firstName: "Dc", lastName: tag, email, phone: "+21624000111", country: "Tunisie", preferredLanguage: "fr", drivingLicenceYear: 2015, licenceIssueYear: 2015, dateOfBirth: "1990-01-01" }, customerLanguage: "fr", accountOption: "guest", acceptTerms: true }) });
  return { s: res.status, j: await res.json() };
};
const modify = async (ref, body) => {
  const res = await fetch(`${B}/api/bookings/${ref}/modify`, { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ reference: ref, email, ...body }) });
  return { s: res.status, j: await res.json().catch(() => ({})) };
};
const byRef = async (ref) => {
  const id = (await A.req(`/api/admin/bookings?search=${ref}`)).j.bookings[0]._id;
  return (await A.req(`/api/admin/bookings/${id}`)).j.booking;
};

// 6 days in March (base price). Website bookings start "pending" or "confirmed" depending on the
// agency settings: a pending one is changed directly, a confirmed one becomes a request.
const b = await book("2034-03-01", "2034-03-07");
const ref = b.j.bookingReference;
const before = await byRef(ref);
check("booking created at base price", b.s < 300 && before.pricingBreakdown.subtotal === car.pricing.daily * 6, `${before.pricingBreakdown.subtotal} ${before.bookingStatus}`);
// Force "pending" to exercise the direct change.
const bid = before._id;
await A.req(`/api/admin/bookings/${bid}`, "PATCH", { status: "pending" });
// Same duration, moved into July: must be re-priced at the summer rate.
r = await modify(ref, { pickupDate: "2034-07-10", returnDate: "2034-07-16" });
const moved = await byRef(ref);
check("same duration moved into high season is re-priced", r.s < 300 && moved.pricingBreakdown.subtotal === Math.round(baseTND * 1.5) * 100 * 6, `${moved.pricingBreakdown.subtotal} (${r.j.error || ""})`);
// Shortened below the summer minimum: refused.
r = await modify(ref, { pickupDate: "2034-07-10", returnDate: "2034-07-12" });
check("customer cannot go below the period minimum", r.s === 400 && /5 jour/.test(r.j.error || ""), r.j.error);
// Out-of-town fee survives a re-pricing (set directly on the test booking).
const { MongoClient } = await import("mongodb");
const cli = await MongoClient.connect(process.env.TEST_MONGO_URL || "mongodb://127.0.0.1:27999");
const db = cli.db("payless");
await db.collection("bookings").updateOne({ bookingReference: ref }, { $inc: { "pricingBreakdown.outOfTownFee": 5000, "pricingBreakdown.totalAmount": 5000 } });
r = await modify(ref, { pickupDate: "2034-07-11", returnDate: "2034-07-17" });
const kept = await byRef(ref);
const pb = kept.pricingBreakdown;
const sum = pb.subtotal + (pb.extrasTotal || 0) + (pb.timbreFiscal || 0) + (pb.contributionLF2026 || 0) + (pb.outOfTownFee || 0) + (pb.pickupLocationFee || 0) + (pb.returnLocationFee || 0) + (pb.differentLocationFee || 0) - (pb.discountAmount || 0);
check("out-of-town fee kept in the new total", r.s < 300 && pb.outOfTownFee === 5000 && pb.totalAmount === sum, `total=${pb.totalAmount} sum=${sum}`);

// Agency approval of a customer request on a confirmed booking: same rules.
const c = await book("2034-03-10", "2034-03-16");
const cid = (await A.req(`/api/admin/bookings?search=${c.j.bookingReference}`)).j.bookings[0]._id;
await A.req(`/api/admin/bookings/${cid}`, "PATCH", { status: "confirmed" });
r = await modify(c.j.bookingReference, { pickupDate: "2034-08-01", returnDate: "2034-08-03", reason: "test" });
check("request below the period minimum refused before reaching the agency", r.s === 400 && /5 jour/.test(r.j.error || ""), r.j.error);
r = await modify(c.j.bookingReference, { pickupDate: "2034-08-01", returnDate: "2034-08-07", reason: "test" });
check("valid change request recorded", r.s < 300, r.j.error || "");
r = await A.req(`/api/admin/bookings/${cid}`, "PATCH", { modificationDecision: "approve" });
const approved = (await A.req(`/api/admin/bookings/${cid}`)).j.booking;
check("approved request re-priced at the summer rate", r.s === 200 && approved.pricingBreakdown.subtotal === Math.round(baseTND * 1.5) * 100 * 6, `${approved.pricingBreakdown.subtotal}`);

// Agency direct date edit re-prices too.
r = await A.req(`/api/admin/bookings/${cid}`, "PATCH", { pickupDate: "2034-07-20", returnDate: "2034-07-26" });
const edited = (await A.req(`/api/admin/bookings/${cid}`)).j.booking;
check("agency date edit re-prices the booking", r.s === 200 && edited.pricingBreakdown.subtotal === Math.round(baseTND * 1.5) * 100 * 6, `${edited.pricingBreakdown.subtotal}`);

// Cancellation with money held → alert.
await A.req("/api/admin/accounting/payments", "POST", { bookingId: cid, kind: "payment", amountTND: 50, method: "cash" });
r = await A.req(`/api/admin/bookings/${cid}`, "PATCH", { status: "cancelled" });
const alerts = (await A.req("/api/admin/notifications?limit=50")).j.notifications.filter((n) => n.type === "cancel_with_money");
check("cancelling a booking with money held raises an alert", r.s === 200 && alerts.some((n) => n.title.fr.includes(c.j.bookingReference)));
const s = (await A.req("/api/admin/accounting/summary?from=2026-01-01&to=2034-12-31")).j.summary;
check("cancelled booking with money listed in « à rembourser »", s.refundsDue.some((x) => x.reference === c.j.bookingReference && x.due === 5000));

await A.req("/api/admin/vehicles/pricing", "PUT", { vehicleId: car._id, seasonalPrices: [] });
await cli.close();
finish();
