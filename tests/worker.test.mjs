// Worker Assistance role, legacy-conflict repair, insurance module.
const B = process.env.TEST_URL || "http://localhost:3456";
function session() {
  let c = {};
  const jar = () => Object.entries(c).map(([k, v]) => k + "=" + v).join("; ");
  const st = (r) => { for (const x of r.headers.getSetCookie()) { const [kv] = x.split(";"); const i = kv.indexOf("="); c[kv.slice(0, i)] = kv.slice(i + 1); } };
  return {
    async login(e, p) { const cs = await fetch(B + "/api/auth/csrf"); st(cs); const t = (await cs.json()).csrfToken; const r = await fetch(B + "/api/auth/callback/credentials", { method: "POST", redirect: "manual", body: new URLSearchParams({ csrfToken: t, email: e, password: p }), headers: { cookie: jar(), "content-type": "application/x-www-form-urlencoded" } }); st(r); },
    async req(path, method = "GET", body) { const r = await fetch(B + path, { method, headers: { cookie: jar(), "content-type": "application/json" }, body: body ? JSON.stringify(body) : undefined }); let j; try { j = await r.json(); } catch { j = {}; } return { s: r.status, j }; },
  };
}
const log = (n, ok, x = "") => console.log(`${ok ? "PASS" : "FAIL"}  ${n} ${x}`);
const day = (n) => { const d = new Date(); d.setDate(d.getDate() + n); return d.toISOString().slice(0, 10); };
const tag = Date.now().toString(36);
const A = session(); await A.login("admin@paylesscarrental.com", process.env.ADMIN_INITIAL_PASSWORD || "TestPassword123!");

// ── Worker Assistance role ──
let r = await A.req("/api/admin/roles");
const worker = r.j.roles.find((x) => x.key === "worker");
log("role Worker Assistance exists (system)", worker?.isSystem === true, worker?.permissions.join(","));
const wEmail = `worker_${tag}@ex.com`;
r = await A.req("/api/admin/users", "POST", { name: "Agent Livraison", email: wEmail, password: "workerpass1", role: "worker" });
log("admin creates a worker account", r.s === 201, r.j.error || "");
const wId = r.j.user?._id;
const W = session(); await W.login(wEmail, "workerpass1");
r = await W.req("/api/admin/me");
log("worker can sign in", r.j.user?.role === "worker", `counter=${r.j.access?.counter} bookings=${r.j.access?.bookings}`);
const list = await W.req("/api/admin/bookings?limit=50");
log("worker searches reservations", list.s === 200);
for (const [name, path, method, body] of [
  ["users", "/api/admin/users", "GET"],
  ["roles", "/api/admin/roles", "GET"],
  ["settings", "/api/admin/settings", "GET"],
  ["fleet delete", "/api/admin/vehicles?id=000000000000000000000000", "DELETE"],
  ["fleet list", "/api/admin/vehicles", "GET"],
  ["finance settings (rental rules)", "/api/admin/rental-rules", "PUT", { minRentalDaysGlobal: 2 }],
]) {
  const x = await W.req(path, method, body);
  log(`worker blocked: ${name}`, x.s === 403, `status=${x.s}`);
}
// worker runs a full delivery → return cycle on a fresh booking
const locs = (await (await fetch(B + "/api/locations")).json()).locations;
const vehicles = (await A.req("/api/admin/vehicles?limit=200")).j.vehicles;
const model = vehicles.filter((v) => (v.units?.length || v.totalUnits) === 3)[5];
const mk = async (p, q) => (await fetch(B + "/api/bookings", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ vehicleId: model._id, vehicles: [{ vehicleId: model._id, extras: [] }], pickupLocationId: locs[0]._id, returnLocationId: locs[0]._id, pickupDate: p, returnDate: q, pickupTime: "10:00", returnTime: "10:00", customer: { firstName: "Wk", lastName: tag, email: `wk_${tag}_${Math.random().toString(36).slice(2, 7)}@ex.com`, phone: "+21624000111", country: "Tunisie", preferredLanguage: "fr", drivingLicenceYear: 2015, licenceIssueYear: 2015, dateOfBirth: "1990-01-01" }, customerLanguage: "fr", accountOption: "guest", acceptTerms: true }) })).json();
const b = await mk(day(300), day(303));
const id = b.bookingId || (await A.req(`/api/admin/bookings?search=${b.bookingReference}`)).j.bookings[0]._id;
r = await W.req(`/api/admin/bookings/${id}`, "PATCH", { action: "record_pickup", mileage: 20000 });
log("worker confirms pickup + mileage", r.j.booking?.bookingStatus === "active", r.j.error || "");
r = await W.req(`/api/admin/bookings/${id}`, "PATCH", { action: "add_note", note: "clés remises" });
log("worker adds a note", r.s === 200);
r = await W.req(`/api/admin/bookings/${id}`, "PATCH", { action: "change_return", newReturnDate: day(305) });
log("worker extends", r.s === 200 && r.j.extraDays === 2, r.j.error || "");
r = await W.req(`/api/admin/bookings/${id}`, "PATCH", { action: "change_return", newReturnDate: day(302) });
log("worker reduces", r.s === 200 && r.j.extraDays === -3, r.j.error || "");
r = await W.req(`/api/admin/bookings/${id}`, "PATCH", { action: "record_return", mileage: 19000 });
log("return below departure mileage refused", r.s === 400);
r = await W.req(`/api/admin/bookings/${id}`, "PATCH", { action: "record_return", mileage: 20350, notes: "plein fait" });
log("worker confirms return (stored user/date/km/notes)", r.j.booking?.returnMileage === 20350 && r.j.booking?.returnRecordedBy === wEmail && !!r.j.booking?.returnRecordedAt && r.j.booking?.returnNotes === "plein fait");
r = await W.req(`/api/admin/bookings/${id}`, "DELETE");
log("worker cannot delete a booking", r.s === 403);
r = await W.req(`/api/admin/bookings/${id}`, "PATCH", { status: "cancelled" });
log("worker cannot cancel (no bookings.cancel)", r.s === 403);
// suspension is immediate
await A.req("/api/admin/users", "PATCH", { id: wId, isActive: false });
r = await W.req("/api/admin/bookings?limit=1");
log("suspended account loses access immediately", r.s === 401, `status=${r.s}`);
await A.req("/api/admin/users", "PATCH", { id: wId, isActive: true, password: "newworkerpass2" });
const W2 = session(); await W2.login(wEmail, "newworkerpass2");
log("reactivated + password reset works", (await W2.req("/api/admin/me")).s === 200);
r = await A.req(`/api/admin/users?id=${wId}`, "DELETE");
log("admin deletes the worker account", r.s === 200);

// ── privilege: an administrator manages workers but cannot create a super admin ──
const aEmail = `adm_${tag}@ex.com`;
await A.req("/api/admin/users", "POST", { name: "Admin Agence", email: aEmail, password: "adminpass12", role: "admin" });
const D = session(); await D.login(aEmail, "adminpass12");
r = await D.req("/api/admin/users", "POST", { name: "W2", email: `w2_${tag}@ex.com`, password: "workerpass1", role: "worker" });
log("administrator can create a worker", r.s === 201, r.j.error || "");
r = await D.req("/api/admin/users", "POST", { name: "Evil", email: `evil_${tag}@ex.com`, password: "evilpass123", role: "superadmin" });
log("administrator cannot create a super admin", r.s === 403);

// ── Insurance ──
const g = (await A.req("/api/admin/garage")).j.units[3];
const mkPol = (start, end, extra = {}) => A.req("/api/admin/insurance", "POST", { vehicleId: g.vehicleId, unitId: g.unitId, company: "STAR", policyNumber: `POL-${tag}`, startDate: start, endDate: end, costTND: 850, ...extra });
r = await mkPol(day(-340), day(25));
log("insurance created", r.s === 201, r.j.error || "");
const polId = r.j.policy?._id;
r = await mkPol(day(10), day(5));
log("insurance with end before start refused", r.s === 400, r.j.error);
let ins = (await A.req("/api/admin/insurance")).j;
log("status 'expiring' at 25 days", ins.policies.find((p) => p._id === polId)?.status === "expiring");
await new Promise((x) => setTimeout(x, 1500));
let notes = (await A.req("/api/admin/notifications?limit=100")).j.notifications.filter((n) => n.data?.unitId === g.unitId && /insurance/.test(n.type));
log("30-day insurance alert raised", notes.some((n) => /dans 25 j/.test(n.title.fr)), notes.map((n) => n.title.fr).join(" | "));
r = await mkPol(day(25), day(390), { renewFrom: polId });
ins = (await A.req("/api/admin/insurance")).j;
log("renewal closes the old policy, new one active/upcoming", r.s === 201 && ins.policies.find((p) => p._id === polId)?.status === "renewed");
r = await A.req("/api/admin/insurance", "PUT", { id: r.j.policy._id, vehicleId: g.vehicleId, unitId: g.unitId, company: "COMAR", policyNumber: `POL-${tag}-B`, startDate: day(25), endDate: day(390), costTND: 900, attachmentUrl: "https://example.com/contrat.pdf" });
log("insurance edited (company + attachment)", r.s === 200, r.j.error || "");
r = await A.req(`/api/admin/insurance?id=${polId}`, "DELETE");
log("insurance deleted", r.s === 200);
r = await W2.req("/api/admin/insurance");
log("worker cannot see insurance (no garage access)", r.s === 403 || r.s === 401);

// ── Integrity after everything ──
const audit = (await A.req("/api/admin/fleet/integrity")).j.report;
log("integrity: 0 shared car, 0 orphan, 0 unassigned", audit.conflicts.length + audit.orphanAssignments.length + audit.unassigned.length === 0, JSON.stringify({ c: audit.conflicts.length, o: audit.orphanAssignments.length, u: audit.unassigned }));
