// Availability engine end-to-end checks (public API + admin API).
const B = process.env.TEST_URL || "http://localhost:3456";
let c = {};
const jar = () => Object.entries(c).map(([k, v]) => `${k}=${v}`).join("; ");
const st = (r) => { for (const x of r.headers.getSetCookie?.() || []) { const [kv] = x.split(";"); const i = kv.indexOf("="); c[kv.slice(0, i)] = kv.slice(i + 1); } };
async function login() {
  const cs = await fetch(B + "/api/auth/csrf"); st(cs); const t = (await cs.json()).csrfToken;
  const r = await fetch(B + "/api/auth/callback/credentials", { method: "POST", redirect: "manual", body: new URLSearchParams({ csrfToken: t, email: "admin@paylesscarrental.com", password: process.env.ADMIN_INITIAL_PASSWORD || "TestPassword123!" }), headers: { cookie: jar(), "content-type": "application/x-www-form-urlencoded" } }); st(r);
}
const adm = async (p, m = "GET", b) => { const r = await fetch(B + p, { method: m, headers: { cookie: jar(), "content-type": "application/json" }, body: b ? JSON.stringify(b) : undefined }); let j; try { j = await r.json(); } catch { j = {}; } return { s: r.status, j }; };
const pub = async (p) => (await fetch(B + p)).json();
const log = (n, ok, x = "") => console.log(`${ok ? "PASS" : "FAIL"}  ${n} ${x}`);
const day = (n) => { const d = new Date(); d.setDate(d.getDate() + n); return d.toISOString().slice(0, 10); };

await login();
const locs = (await pub("/api/locations")).locations;
let seq = 0;
async function book(vehicleIds, p, r) {
  seq++;
  const res = await fetch(B + "/api/bookings", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({
    vehicleId: vehicleIds[0], vehicles: vehicleIds.map((id) => ({ vehicleId: id, extras: [] })),
    pickupLocationId: locs[0]._id, returnLocationId: locs[0]._id, pickupDate: p, returnDate: r, pickupTime: "10:00", returnTime: "10:00",
    customer: { firstName: "Avail", lastName: `T${seq}`, email: `avail${seq}_${Date.now()}@ex.com`, phone: "+21622000" + String(100 + seq), country: "Tunisie", preferredLanguage: "fr", drivingLicenceYear: 2015, licenceIssueYear: 2015, dateOfBirth: "1990-01-01" },
    customerLanguage: "fr", accountOption: "guest", acceptTerms: true }) });
  return { s: res.status, j: await res.json() };
}
const stockOf = async (id, p, r) => (await pub(`/api/vehicles/${id}?pickupDate=${p}&returnDate=${r}`)).vehicle?.availableUnits;
const listed = async (id, p, r) => ((await pub(`/api/vehicles?limit=100&pickupDate=${p}&returnDate=${r}`)).vehicles || []).find((v) => v._id === id);

// Pick a model with 3 rentable cars and no booking in the test window.
const all = (await adm("/api/admin/vehicles?limit=200")).j.vehicles;
const BASE = Number(process.env.BASE || 460);
const P = day(BASE), R = day(BASE + 4);
const target = all.find((v) => (v.units?.length || v.totalUnits) === 3);
const id = target._id;
console.log(`model: ${target.brand} ${target.model} (${target.units?.length || target.totalUnits} cars) window ${P}→${R}`);
log("initial stock = 3", (await stockOf(id, P, R)) === 3, await stockOf(id, P, R));

const b1 = await book([id], P, R);
log("booking 1 ok", b1.s === 201, b1.j.error || "");
log("stock 2 after one booking", (await stockOf(id, P, R)) === 2);
const b2 = await book([id, id], day(BASE + 1), day(BASE + 3)); // multi-car: same model twice, inside the window
log("multi-car booking (same model ×2) ok", b2.s === 201, b2.j.error || "");
log("multi-car counted as 2 → stock 0", (await stockOf(id, P, R)) === 0, await stockOf(id, P, R));
log("model hidden from listing for the window", !(await listed(id, P, R)));
// Public site: sold-out models stay listed (disabled) when asked, after the available ones.
{
  const lst = (await pub(`/api/vehicles?limit=100&includeSoldOut=1&pickupDate=${P}&returnDate=${R}`)).vehicles || [];
  const me = lst.find((v) => v._id === id);
  log("includeSoldOut=1 lists the sold-out model", !!me);
  log("…flagged isAvailable=false with 0 cars", me?.isAvailable === false && me?.availableUnits === 0, JSON.stringify({ a: me?.isAvailable, u: me?.availableUnits }));
  const firstOut = lst.findIndex((v) => v.isAvailable === false);
  log("…sold-out models listed after available ones", firstOut === -1 || lst.slice(firstOut).every((v) => v.isAvailable === false));
  const later = (await pub(`/api/vehicles?limit=100&includeSoldOut=1&pickupDate=${day(BASE + 10)}&returnDate=${day(BASE + 12)}`)).vehicles.find((v) => v._id === id);
  log("other dates → same model available again", later?.isAvailable === true && later?.availableUnits === 3, JSON.stringify({ a: later?.isAvailable, u: later?.availableUnits }));
}
const b3 = await book([id], day(BASE + 2), day(BASE + 3));
log("4th booking refused (409)", b3.s === 409, b3.j.error || "");
log("model visible for a later window", (await listed(id, day(BASE + 10), day(BASE + 12)))?.availableUnits === 3);
log("adjacent window (return day = next pickup) not blocked", (await stockOf(id, R, day(BASE + 6))) === 3, await stockOf(id, R, day(BASE + 6)));

// Cancelling frees the cars.
const r1 = await adm(`/api/admin/bookings/${b2.j.bookingId}`, "PATCH", { status: "cancelled" });
log("cancel multi-car booking", r1.s === 200, r1.j.error || "");
log("stock back to 2 after cancel", (await stockOf(id, P, R)) === 2);

// A car sent to the garage is not rentable.
const g = (await adm("/api/admin/garage")).j.units.filter((u) => u.vehicleId === id);
const free = g.find((u) => u.status === "active");
await adm("/api/admin/garage", "PATCH", { action: "update", vehicleId: id, unitId: free.unitId, status: "maintenance" });
log("car in garage reduces stock (2 → 1)", (await stockOf(id, P, R)) === 1, await stockOf(id, P, R));
await adm("/api/admin/garage", "PATCH", { action: "update", vehicleId: id, unitId: free.unitId, status: "active" });
log("back in service (→ 2)", (await stockOf(id, P, R)) === 2);

// Overdue rental: active, return date yesterday, car not returned → still blocks today.
const other = all.find((v) => v._id !== id && (v.units?.length || v.totalUnits) === 3);
const ob = await book([other._id], day(1), day(3));
await adm(`/api/admin/bookings/${ob.j.bookingId}`, "PATCH", { status: "active", pickupDate: day(-4), returnDate: day(-1) });
log("overdue active rental still holds its car today", (await stockOf(other._id, day(0), day(1))) === 2, await stockOf(other._id, day(0), day(1)));
log("…but not next week", (await stockOf(other._id, day(7), day(9))) === 3);
await adm(`/api/admin/bookings/${ob.j.bookingId}`, "PATCH", { action: "record_return", mileage: 999999 });
log("after return recorded → car free today", (await stockOf(other._id, day(0), day(1))) === 3);

// Listing without valid dates still works and never shows a stale counter.
const noDates = (await pub("/api/vehicles?limit=100")).vehicles.find((v) => v._id === id);
log("no dates → stock = cars in service", noDates?.availableUnits === 3, noDates?.availableUnits);
console.log("refs:", b1.j.bookingReference);
