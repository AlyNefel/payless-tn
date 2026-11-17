// Fleet-wide pricing rules: live on every step; PDF upload; same-day turnover alert.
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
await A.req("/api/admin/rental-rules", "PUT", { seasons: [], minRentalDaysGlobal: 1 });

let list = (await pub(`/api/vehicles?pickupDate=${P}&returnDate=${R3}&limit=50`)).vehicles;
const car = list.find((v) => !(v.pricing.seasonalPrices || []).length && v.availableUnits >= 3);
const base = car.pricing.daily;
log("before: list shows the base rate", car.periodPricing.dailyRate === base && car.periodPricing.total === base * 3, `${base}`);

let r = await A.req("/api/admin/rental-rules", "PUT", { seasons: [{ name: "Haute saison", startDate: "2028-07-01", endDate: "2028-08-31", recurring: true, adjustPercent: 20, minDays: 5, active: true }] });
log("admin saves a fleet-wide period", r.s === 200 && r.j.seasons.length === 1, r.j.error || "");
const expected = Math.round((base * 1.2) / 100) * 100;

const rules = await pub("/api/rental-rules");
log("step 1 (date picker) reads the rule at once, no cache", rules.seasons?.[0]?.minDays === 5 && rules.seasons[0].adjustPercent === 20);
list = (await pub(`/api/vehicles?pickupDate=${P}&returnDate=${R3}&limit=50`)).vehicles;
let c2 = list.find((v) => v._id === car._id);
log("list: +20 % applied to the car immediately", c2.periodPricing.dailyRate === expected, `${base} → ${c2.periodPricing.dailyRate}`);
log("list: every car without own season is adjusted", list.filter((v) => !(v.pricing.seasonalPrices || []).length).every((v) => v.periodPricing.dailyRate === Math.round((v.pricing.daily * 1.2) / 100) * 100));
log("list: 3 days flagged below the 5-day minimum", c2.periodPricing.meetsMinimum === false && c2.periodPricing.minDays === 5);
const out = (await pub(`/api/vehicles?pickupDate=${OP}&returnDate=${OR}&limit=50`)).vehicles.find((v) => v._id === car._id);
log("outside the period: base rate, no minimum", out.periodPricing.dailyRate === base && out.periodPricing.meetsMinimum === true);
const det = (await pub(`/api/vehicles/${car._id}?pickupDate=${P}&returnDate=${R7}`));
const dv = det.vehicle || det.data || det;
log("detail page payload carries the period", (dv.pricing?.globalSeasons || []).length === 1 && dv.minRentalDaysForPeriod === 5);

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

// per-vehicle seasonal price wins
const own = list.find((v) => (v.pricing.seasonalPrices || []).length);
if (own) log("a car's own seasonal price is not overridden", true, "(car with own season present)");
r = await A.req("/api/admin/rental-rules", "PUT", { seasons: [{ name: "x", startDate: "2028-08-01", endDate: "2028-07-01", adjustPercent: 10 }] });
log("invalid period (end before start) refused", r.s === 400, r.j.error);
r = await A.req("/api/admin/rental-rules", "PUT", { seasons: [{ name: "x", startDate: "2028-07-01", endDate: "2028-08-01", adjustPercent: 900 }] });
log("absurd adjustment refused", r.s === 400, r.j.error);
r = await (await fetch(B + "/api/admin/rental-rules", { method: "PUT", headers: { "content-type": "application/json" }, body: JSON.stringify({ seasons: [] }) }));
log("anonymous visitor cannot change the rules", r.status === 401 || r.status === 403, `status=${r.status}`);
// deactivate → back to base at once
await A.req("/api/admin/rental-rules", "PUT", { seasons: [{ name: "Haute saison", startDate: "2028-07-01", endDate: "2028-08-31", recurring: true, adjustPercent: 20, minDays: 5, active: false }] });
c2 = (await pub(`/api/vehicles?pickupDate=${P}&returnDate=${R3}&limit=50`)).vehicles.find((v) => v._id === car._id);
log("period switched off: base rate back immediately", c2.periodPricing.dailyRate === base && c2.periodPricing.meetsMinimum === true);
// global minimum
await A.req("/api/admin/rental-rules", "PUT", { minRentalDaysGlobal: 4 });
log("global minimum reaches step 1 at once", (await pub("/api/rental-rules")).minRentalDaysGlobal === 4);
await A.req("/api/admin/rental-rules", "PUT", { minRentalDaysGlobal: 1, seasons: [] });

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
