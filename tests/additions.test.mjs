// Degressive tariff, period price filter/sort, day-before reminders, audit journal.
import { admin, book, check, finish, fixtures, pub, session, tag } from "./lib.mjs";

const A = await admin();
const P = "2031-03-02", R3 = "2031-03-05", R10 = "2031-03-12";
const { car, locationId } = await fixtures(P, R10);
const base = car.pricing.daily;
const tiersOf = (t) => A.req("/api/admin/vehicles/pricing", "PUT", { vehicleId: car._id, durationDiscounts: t });

// ── Degressive tariff, per model ──
let r = await A.req("/api/admin/rental-rules", "PUT", { durationDiscounts: [{ minDays: 7, percent: 10 }] });
check("fleet-wide degressive no longer accepted (per model)", r.s === 410, r.j.error);
r = await tiersOf([{ minDays: 7, percent: 10 }, { minDays: 3, percent: 15 }]);
check("lower discount on a longer tier refused", r.s === 400, r.j.error);
r = await tiersOf([{ minDays: 7, percent: 10 }, { minDays: 7, percent: 20 }]);
check("two tiers on the same duration refused", r.s === 400, r.j.error);
r = await tiersOf([{ minDays: 7, percent: 10 }, { minDays: 30, percent: 20 }]);
check("model tiers saved", r.s === 200, r.j.error || "");
const expected = Math.round((base * 0.9) / 100) * 100;
let all10 = (await pub(`/api/vehicles?pickupDate=${P}&returnDate=${R10}&limit=50`)).vehicles;
let v = all10.find((x) => x._id === car._id);
check("10 days: -10 % on this model", v.periodPricing.dailyRate === expected && v.periodPricing.discountPercent === 10 && v.periodPricing.total === expected * 10, `${base} → ${v.periodPricing.dailyRate}`);
const otherModel = all10.find((x) => x._id !== car._id && !(x.pricing.durationDiscounts || []).length);
check("other models keep their full price", otherModel.periodPricing.dailyRate === otherModel.pricing.daily && !otherModel.periodPricing.discountPercent);
v = (await pub(`/api/vehicles?pickupDate=${P}&returnDate=${R3}&limit=50`)).vehicles.find((x) => x._id === car._id);
check("3 days: no discount", v.periodPricing.dailyRate === base && !v.periodPricing.discountPercent);
const b = await book(car._id, locationId, P, R10);
const row = (await A.req(`/api/admin/bookings?search=${b.j.bookingReference}`)).j.bookings[0];
const full = (await A.req(`/api/admin/bookings/${row._id}`)).j.booking;
check("booking API bills the discounted rate", b.s < 300 && full.pricingBreakdown.subtotal === expected * 10, `subtotal=${full.pricingBreakdown.subtotal}`);
r = await A.req("/api/admin/vehicles/pricing", "PUT", { action: "copy", vehicleId: car._id, targetIds: [otherModel._id], priceMode: "percent", includeDurationDiscounts: true });
const copied = (await pub(`/api/vehicles?pickupDate=${P}&returnDate=${R10}&limit=50`)).vehicles.find((x) => x._id === otherModel._id);
check("tiers copied to another model", r.s === 200 && copied.periodPricing.discountPercent === 10);
await A.req("/api/admin/vehicles/pricing", "PUT", { vehicleId: otherModel._id, durationDiscounts: [], seasonalPrices: [] });
await tiersOf([]);

// ── Price filter / sort on the period price ──
const S = "2031-06-10", E = "2031-06-13";
// The cheapest model gets a June period at +50 %: its period price must drive filter and sort.
const pre = (await pub(`/api/vehicles?pickupDate=${S}&returnDate=${E}&limit=100`)).vehicles.filter((x) => !(x.pricing.seasonalPrices || []).length);
const cheap = pre.sort((x, y) => x.pricing.daily - y.pricing.daily)[0];
r = await A.req("/api/admin/vehicles/pricing", "PUT", { vehicleId: cheap._id, seasonalPrices: [{ name: "Juin", startDate: "2031-06-01", endDate: "2031-06-30", dailyRate: Math.round((cheap.pricing.daily * 1.5) / 100), minDays: 0 }] });
check("model period saved for the sort test", r.s === 200, r.j.error || "");
const all = (await pub(`/api/vehicles?pickupDate=${S}&returnDate=${E}&limit=100`)).vehicles;
const rates = all.map((x) => x.periodPricing.dailyRate);
check("default sort follows the period price", rates.every((x, i) => i === 0 || x >= rates[i - 1]));
const desc = (await pub(`/api/vehicles?pickupDate=${S}&returnDate=${E}&limit=100&sort=price_desc`)).vehicles.map((x) => x.periodPricing.dailyRate);
check("price_desc follows the period price", desc.every((x, i) => i === 0 || x <= desc[i - 1]));
const cheapBase = all.find((x) => x._id === cheap._id);
const cap = Math.floor(cheapBase.pricing.daily / 100) + 1; // above the base, below base +50 %
const filtered = (await pub(`/api/vehicles?pickupDate=${S}&returnDate=${E}&limit=100&maxPrice=${cap}`)).vehicles;
check("max price filter uses the season price, not the base", !filtered.some((x) => x._id === cheapBase._id) && filtered.every((x) => x.periodPricing.dailyRate <= cap * 100), `cap=${cap} DT`);
await A.req("/api/admin/vehicles/pricing", "PUT", { vehicleId: cheap._id, seasonalPrices: [] });

// ── Reminders ──
const t = new Date(Date.now() + 3_600_000 + 86_400_000).toISOString().slice(0, 10);
const t2 = new Date(Date.now() + 3_600_000 + 4 * 86_400_000).toISOString().slice(0, 10);
const tb = await book(car._id, locationId, t, t2);
r = await A.req("/api/cron/reminders");
check("reminder run lists tomorrow's departures", r.s === 200 && r.j.tomorrow === t && r.j.departures >= 1, JSON.stringify(r.j));
const tbRow = (await A.req(`/api/admin/bookings?search=${tb.j.bookingReference}`)).j.bookings[0];
const notes = (await A.req("/api/admin/notifications?limit=50")).j.notifications.filter((n) => n.type === "tomorrow_agenda");
check("team notified of tomorrow's agenda", notes.length >= 1, notes[0]?.title?.fr);
const anon = await fetch(`${process.env.TEST_URL || "http://localhost:3456"}/api/cron/reminders`);
check("reminders cannot be triggered anonymously", anon.status === 401);
void tbRow;

// ── Audit journal ──
await A.req(`/api/admin/bookings/${row._id}`, "PATCH", { action: "add_note", note: "x" });
await A.req(`/api/admin/bookings/${row._id}`, "PATCH", { action: "change_return", newReturnDate: "2031-03-13" });
const email = `aud_${tag}@example.com`;
await A.req("/api/admin/users", "POST", { name: "Audit Test", email, password: "auditpass12", role: "staff" });
const uid = (await A.req("/api/admin/users")).j.users.find((u) => u.email === email)._id;
await A.req("/api/admin/users", "PATCH", { id: uid, isActive: false });
await A.req(`/api/admin/users?id=${uid}`, "DELETE");
const logs = (await A.req("/api/admin/audit")).j.logs;
const has = (a) => logs.some((l) => l.action === a);
check("audit: extension logged", has("booking.change_return"));
check("audit: model price change logged", has("pricing.model"));
check("audit: account created / suspended / deleted", has("user.create") && has("user.update") && has("user.delete"));
const sus = logs.find((l) => l.action === "user.update" && l.resourceId === uid);
check("audit keeps before / after", sus?.previousValue?.isActive === true && sus?.newValue?.isActive === false);
const staff = await session().login(`stf_${tag}@example.com`, "x");
check("audit journal closed to anonymous / other roles", (await staff.req("/api/admin/audit")).s === 401);
finish();
