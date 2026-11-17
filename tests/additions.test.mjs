// Degressive tariff, period price filter/sort, day-before reminders, audit journal.
import { admin, book, check, finish, fixtures, pub, session, tag } from "./lib.mjs";

const A = await admin();
const P = "2031-03-02", R3 = "2031-03-05", R10 = "2031-03-12";
const { car, locationId } = await fixtures(P, R10);
await A.req("/api/admin/rental-rules", "PUT", { seasons: [], durationDiscounts: [], minRentalDaysGlobal: 1 });
const base = car.pricing.daily;

// ── Degressive tariff ──
let r = await A.req("/api/admin/rental-rules", "PUT", { durationDiscounts: [{ minDays: 7, percent: 10 }, { minDays: 3, percent: 15 }] });
check("lower discount on a longer tier refused", r.s === 400, r.j.error);
r = await A.req("/api/admin/rental-rules", "PUT", { durationDiscounts: [{ minDays: 7, percent: 10 }, { minDays: 7, percent: 20 }] });
check("two tiers on the same duration refused", r.s === 400, r.j.error);
r = await A.req("/api/admin/rental-rules", "PUT", { durationDiscounts: [{ minDays: 7, percent: 10 }, { minDays: 30, percent: 20 }] });
check("tiers saved", r.s === 200 && r.j.durationDiscounts.length === 2, r.j.error || "");
check("tiers published to the date pickers", (await pub("/api/rental-rules")).durationDiscounts?.length === 2);
const expected = Math.round((base * 0.9) / 100) * 100;
let v = (await pub(`/api/vehicles?pickupDate=${P}&returnDate=${R10}&limit=50`)).vehicles.find((x) => x._id === car._id);
check("10 days: -10 % on the list", v.periodPricing.dailyRate === expected && v.periodPricing.discountPercent === 10 && v.periodPricing.total === expected * 10, `${base} → ${v.periodPricing.dailyRate}`);
v = (await pub(`/api/vehicles?pickupDate=${P}&returnDate=${R3}&limit=50`)).vehicles.find((x) => x._id === car._id);
check("3 days: no discount", v.periodPricing.dailyRate === base && !v.periodPricing.discountPercent);
const b = await book(car._id, locationId, P, R10);
const row = (await A.req(`/api/admin/bookings?search=${b.j.bookingReference}`)).j.bookings[0];
const full = (await A.req(`/api/admin/bookings/${row._id}`)).j.booking;
check("booking API bills the discounted rate", b.s < 300 && full.pricingBreakdown.subtotal === expected * 10, `subtotal=${full.pricingBreakdown.subtotal}`);

// ── Price filter / sort on the period price ──
await A.req("/api/admin/rental-rules", "PUT", { durationDiscounts: [], seasons: [{ name: "Test haute", startDate: "2031-06-01", endDate: "2031-06-30", adjustPercent: 50, active: true }] });
const S = "2031-06-10", E = "2031-06-13";
const all = (await pub(`/api/vehicles?pickupDate=${S}&returnDate=${E}&limit=100`)).vehicles;
const rates = all.map((x) => x.periodPricing.dailyRate);
check("default sort follows the period price", rates.every((x, i) => i === 0 || x >= rates[i - 1]));
const desc = (await pub(`/api/vehicles?pickupDate=${S}&returnDate=${E}&limit=100&sort=price_desc`)).vehicles.map((x) => x.periodPricing.dailyRate);
check("price_desc follows the period price", desc.every((x, i) => i === 0 || x <= desc[i - 1]));
const cheapBase = all.find((x) => !(x.pricing.seasonalPrices || []).length && x.pricing.daily * 1.5 > x.pricing.daily + 100);
const cap = Math.floor(cheapBase.pricing.daily / 100) + 1; // above the base, below base +50 %
const filtered = (await pub(`/api/vehicles?pickupDate=${S}&returnDate=${E}&limit=100&maxPrice=${cap}`)).vehicles;
check("max price filter uses the season price, not the base", !filtered.some((x) => x._id === cheapBase._id) && filtered.every((x) => x.periodPricing.dailyRate <= cap * 100), `cap=${cap} DT`);
await A.req("/api/admin/rental-rules", "PUT", { seasons: [] });

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
check("audit: pricing rules logged", has("pricing.rules"));
check("audit: account created / suspended / deleted", has("user.create") && has("user.update") && has("user.delete"));
const sus = logs.find((l) => l.action === "user.update" && l.resourceId === uid);
check("audit keeps before / after", sus?.previousValue?.isActive === true && sus?.newValue?.isActive === false);
const staff = await session().login(`stf_${tag}@example.com`, "x");
check("audit journal closed to anonymous / other roles", (await staff.req("/api/admin/audit")).s === 401);
finish();
