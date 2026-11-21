// Prices by period and minimum per model, live on every step; PDF upload; same-day turnover alert.
const B = process.env.TEST_URL || "http://localhost:3456";
function session() {
  let c = {};
  const jar = () => Object.entries(c).map(([k, v]) => k + "=" + v).join("; ");
  const st = (r) => { for (const x of r.headers.getSetCookie()) { const [kv] = x.split(";"); const i = kv.indexOf("="); c[kv.slice(0, i)] = kv.slice(i + 1); } };
  return {
    jar,
    async login(e, p) { const cs = await fetch(B + "/api/auth/csrf"); st(cs); const t = (await cs.json()).csrfToken; const r = await fetch(B + "/api/auth/callback/credentials", { method: "POST", redirect: "manual", body: new URLSearchParams({ csrfToken: t, email: e, password: p }), headers: { cookie: jar(), "content-type": "application/x-www-form-urlencoded" } }); st(r); },
    async req(path, method = "GET", body) { const r = await fetch(B + path, { method, headers: { cookie: jar(), "content-type": "application/json" }, body: body ? JSON.stringify(body) : undefined }); let j; try { j = await r.json(); } catch { j = {}; } return { s: r.status, j }; },
  };
}
let fails = 0;
const log = (n, ok, x = "") => { if (!ok) fails++; console.log(`${ok ? "PASS" : "FAIL"}  ${n} ${x}`); };
const pub = async (p) => (await fetch(B + p)).json();
const A = session(); await A.login("admin@paylesscarrental.com", process.env.ADMIN_INITIAL_PASSWORD || "TestPassword123!");
const tag = Date.now().toString(36);
const locs = (await pub("/api/locations")).locations;
const P = "2028-07-10", R3 = "2028-07-13", R7 = "2028-07-17";   // inside the season
const OP = "2028-10-10", OR = "2028-10-13";                      // outside
// Prices by period and minimum durations are set PER MODEL (no fleet-wide rule).
let list = (await pub(`/api/vehicles?pickupDate=${P}&returnDate=${R3}&limit=50`)).vehicles;
const car = list.find((v) => !(v.pricing.seasonalPrices || []).length && v.availableUnits >= 3);
// A model with a different standard price, so "same %" and "same price" give different results.
const other = list.find((v) => v._id !== car._id && v.pricing.daily !== car.pricing.daily && !(v.pricing.seasonalPrices || []).length);
const base = car.pricing.daily;
const baseTND = base / 100;
log("before: list shows the base rate", car.periodPricing.dailyRate === base && car.periodPricing.total === base * 3, `${base}`);

let r = await A.req("/api/admin/rental-rules", "PUT", { minRentalDaysGlobal: 3 });
log("fleet-wide minimum no longer accepted (per model now)", r.s === 410, r.j.error);
r = await A.req("/api/admin/rental-rules", "PUT", { seasons: [] });
log("fleet-wide periods no longer accepted", r.s === 410);

const period = (extra = {}) => ({ name: "Haute saison", startDate: "07-01", endDate: "08-31", dailyRate: Math.round(baseTND * 1.2), discountPercent: 0, minDays: 5, ...extra });
const save = (periods, more = {}) => A.req("/api/admin/vehicles/pricing", "PUT", { vehicleId: car._id, seasonalPrices: periods, ...more });
r = await save([period({ endDate: "06-31" })]);
log("impossible day (31 June) refused", r.s === 400, r.j.error);
r = await save([period({ startDate: "2028-08-01", endDate: "2028-07-01" })]);
log("fixed dates: end before start refused", r.s === 400, r.j.error);
r = await save([period(), period({ name: "Août", startDate: "08-15", endDate: "09-15" })]);
log("overlapping periods of one model refused", r.s === 400 && /chevauchent/.test(r.j.error || ""), r.j.error);
r = await save([period(), period({ name: "Fixe", startDate: "2028-08-20", endDate: "2028-08-25" })]);
log("a fixed-date period inside a yearly one refused", r.s === 400, r.j.error);
r = await save([period(), period({ name: "Hiver", startDate: "11-15", endDate: "03-15", dailyRate: Math.round(baseTND * 0.8), minDays: 0 })]);
log("model saves its own periods (day precision, over New Year)", r.s === 200, r.j.error || "");
const expected = Math.round(baseTND * 1.2) * 100;

list = (await pub(`/api/vehicles?pickupDate=${P}&returnDate=${R3}&limit=50`)).vehicles;
let c2 = list.find((v) => v._id === car._id);
log("list: period price applied immediately", c2.periodPricing.dailyRate === expected, `${base} → ${c2.periodPricing.dailyRate}`);
const o2 = list.find((v) => v._id === other._id);
log("other models are NOT affected", o2.periodPricing.dailyRate === other.pricing.daily && o2.periodPricing.meetsMinimum === true);
log("list: 3 days flagged below the period's 5-day minimum", c2.periodPricing.meetsMinimum === false && c2.periodPricing.minDays === 5);
const out = (await pub(`/api/vehicles?pickupDate=${OP}&returnDate=${OR}&limit=50`)).vehicles.find((v) => v._id === car._id);
log("outside the periods: base rate, model minimum", out.periodPricing.dailyRate === base && out.periodPricing.meetsMinimum === true);
const winter = (await pub(`/api/vehicles?pickupDate=2029-01-10&returnDate=2029-01-13&limit=50`)).vehicles.find((v) => v._id === car._id);
log("period across New Year (15 Nov → 15 Mar) applies in January", winter.periodPricing.dailyRate === Math.round(baseTND * 0.8) * 100);
const edge = (await pub(`/api/vehicles?pickupDate=2029-03-16&returnDate=2029-03-19&limit=50`)).vehicles.find((v) => v._id === car._id);
log("day after the period: base rate again", edge.periodPricing.dailyRate === base);
const det = await pub(`/api/vehicles/${car._id}?pickupDate=${P}&returnDate=${R7}`);
const dv = det.vehicle || det.data || det;
log("detail page payload carries the period minimum", dv.minRentalDaysForPeriod === 5);

const mk = async (p, q, extra = {}) => { const res = await fetch(B + "/api/bookings", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ vehicleId: car._id, vehicles: [{ vehicleId: car._id, extras: [] }], pickupLocationId: locs[0]._id, returnLocationId: locs[0]._id, pickupDate: p, returnDate: q, pickupTime: "10:00", returnTime: "10:00", customer: { firstName: "Pr", lastName: tag, email: `pr_${tag}_${Math.random().toString(36).slice(2, 7)}@ex.com`, phone: "+21624000111", country: "Tunisie", preferredLanguage: "fr", drivingLicenceYear: 2015, licenceIssueYear: 2015, dateOfBirth: "1990-01-01" }, customerLanguage: "fr", accountOption: "guest", acceptTerms: true, ...extra }) }); return { s: res.status, j: await res.json() }; };
r = await mk(P, R3);
log("booking API refuses 3 days in the period", r.s === 400 && /5 jour/.test(r.j.error || ""), r.j.error);
r = await mk(P, R7);
const bk = (await A.req(`/api/admin/bookings?search=${r.j.bookingReference}`)).j.bookings?.[0];
const full = (await A.req(`/api/admin/bookings/${bk?._id}`)).j.booking || bk;
const sub = full?.pricingBreakdown?.subtotal ?? full?.pricingBreakdown?.vehicleSubtotal;
log("booking API bills the period rate × 7 days", r.s < 300 && sub === expected * 7, `subtotal=${sub} expected=${expected * 7}`);
r = await mk(OP, OR);
log("booking outside the period accepted at base rate", r.s < 300);
r = await save([period()], { minRentalDays: 4 });
r = await mk(OP, OR);
log("model minimum (4 days) applies outside the periods", r.s === 400 && /4 jour/.test(r.j.error || ""), r.j.error);

// Copy to other models
r = await A.req("/api/admin/vehicles/pricing", "PUT", { action: "copy", vehicleId: car._id, targetIds: [other._id], priceMode: "percent", includeMinRentalDays: true });
log("periods copied to another model", r.s === 200 && r.j.updated === 1, r.j.error || "");
const copied = (await pub(`/api/vehicles?pickupDate=${P}&returnDate=${R7}&limit=50`)).vehicles.find((v) => v._id === other._id);
const otherExpected = Math.max(100, Math.round(((expected / base) * other.pricing.daily) / 100) * 100);
log("copied period keeps the same % on the other model's own price", copied.periodPricing.dailyRate === otherExpected && copied.periodPricing.minDays === 5, `${other.pricing.daily} → ${copied.periodPricing.dailyRate} (expected ${otherExpected})`);
r = await (await fetch(B + "/api/admin/vehicles/pricing", { method: "PUT", headers: { "content-type": "application/json" }, body: JSON.stringify({ vehicleId: car._id, seasonalPrices: [] }) }));
log("anonymous visitor cannot change prices", r.status === 401 || r.status === 403, `status=${r.status}`);
// Back to normal for the next tests.
await save([], { minRentalDays: 1 });
await A.req("/api/admin/vehicles/pricing", "PUT", { vehicleId: other._id, seasonalPrices: [], minRentalDays: 1 });
c2 = (await pub(`/api/vehicles?pickupDate=${P}&returnDate=${R3}&limit=50`)).vehicles.find((v) => v._id === car._id);
log("periods removed: base rate back immediately", c2.periodPricing.dailyRate === base && c2.periodPricing.meetsMinimum === true);

// ── PDF upload ──
const pdf = Buffer.from("%PDF-1.4\n1 0 obj<<>>endobj\ntrailer<<>>\n%%EOF\n");
const up = async (buf, name, type, jar = A.jar()) => { const fd = new FormData(); fd.append("file", new Blob([buf], { type }), name); const res = await fetch(B + "/api/admin/documents", { method: "POST", body: fd, headers: { cookie: jar } }); return { s: res.status, j: await res.json().catch(() => ({})) }; };
r = await up(pdf, "contrat.pdf", "application/pdf");
log("PDF contract uploaded", r.s === 201 && /^\/api\/admin\/documents\//.test(r.j.url || ""), r.j.error || r.j.url);
const url = r.j.url;
let g = await fetch(B + url, { headers: { cookie: A.jar() } });
log("staff downloads it as application/pdf", g.status === 200 && g.headers.get("content-type") === "application/pdf" && Buffer.from(await g.arrayBuffer()).equals(pdf));
g = await fetch(B + url);
log("document not readable without login", g.status === 401 || g.status === 403, `status=${g.status}`);
r = await up(Buffer.from("<html><script>alert(1)</script></html>"), "evil.pdf", "application/pdf");
log("fake PDF (HTML inside) refused", r.s === 415, r.j.error);
r = await up(Buffer.alloc(9 * 1024 * 1024, 37), "big.pdf", "application/pdf");
log("9 MB file refused", r.s === 413 || r.s === 415, `status=${r.s}`);
r = await up(pdf, "x.pdf", "application/pdf", "");
log("upload refused without login", r.s === 401 || r.s === 403);
const gu = (await A.req("/api/admin/garage")).j.units[5];
const d = (n) => { const x = new Date(); x.setDate(x.getDate() + n); return x.toISOString().slice(0, 10); };
r = await A.req("/api/admin/insurance", "POST", { vehicleId: gu.vehicleId, unitId: gu.unitId, company: "STAR", policyNumber: `PDF-${tag}`, startDate: d(-10), endDate: d(300), costTND: 700, attachmentUrl: url });
log("policy saved with the PDF attached", r.s === 201, r.j.error || "");
await A.req(`/api/admin/insurance?id=${r.j.policy._id}`, "DELETE");
g = await fetch(B + url, { headers: { cookie: A.jar() } });
log("PDF removed when its policy is deleted", g.status === 404);

// ── same-day return → departure ──
const t1 = await mk("2028-11-02", "2028-11-05", { returnTime: "16:00" });
const t2 = await mk("2028-11-01", "2028-11-05"); const t3 = await mk("2028-11-01", "2028-11-05"); // fill the other cars
const t4 = await mk("2028-11-05", "2028-11-08", { pickupTime: "09:00" });
log("same-day booking accepted (return and departure on the 5th)", t4.s < 300, t4.j.error || "");
await new Promise((x) => setTimeout(x, 800));
const notes = (await A.req("/api/admin/notifications?limit=100")).j.notifications.filter((n) => n.type === "same_day_turnover");
const hit = notes.find((n) => n.data?.leaving === t4.j.bookingReference);
log("manager notified of the same-day hand-over", Boolean(hit), hit ? `${hit.title.fr} | ${hit.message.fr}` : `count=${notes.length}`);
const lateHit = notes.find((n) => n.data?.leaving === t4.j.bookingReference && n.data?.returning === t1.j.bookingReference);
if (lateHit) log("return 16:00 after departure 09:00 flagged critical", lateHit.severity === "critical", lateHit.severity);
const audit = (await A.req("/api/admin/fleet/integrity")).j.report;
log("integrity still clean", audit.conflicts.length + audit.orphanAssignments.length + audit.unassigned.length === 0);
console.log(fails ? `\n${fails} FAILED` : "\nALL PASS");
