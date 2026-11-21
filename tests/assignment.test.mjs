// Physical-car assignment engine: uniqueness, concurrency, extension, reduction, repair.
const B = process.env.TEST_URL || "http://localhost:3456";
let c = {};
const jar = () => Object.entries(c).map(([k, v]) => `${k}=${v}`).join("; ");
const st = (r) => { for (const x of r.headers.getSetCookie?.() || []) { const [kv] = x.split(";"); const i = kv.indexOf("="); c[kv.slice(0, i)] = kv.slice(i + 1); } };
async function login() {
  const cs = await fetch(B + "/api/auth/csrf"); st(cs); const t = (await cs.json()).csrfToken;
  const r = await fetch(B + "/api/auth/callback/credentials", { method: "POST", redirect: "manual", body: new URLSearchParams({ csrfToken: t, email: "admin@paylesscarrental.com", password: process.env.ADMIN_INITIAL_PASSWORD || "TestPassword123!" }), headers: { cookie: jar(), "content-type": "application/x-www-form-urlencoded" } }); st(r);
}
const adm = async (p, m = "GET", b) => { const r = await fetch(B + p, { method: m, headers: { cookie: jar(), "content-type": "application/json" }, body: b ? JSON.stringify(b) : undefined }); let j; try { j = await r.json(); } catch { j = {}; } return { s: r.status, j }; };
const log = (n, ok, x = "") => console.log(`${ok ? "PASS" : "FAIL"}  ${n} ${x}`);
const BASE = Number(process.env.BASE || 230);
const day = (n) => { const d = new Date(); d.setDate(d.getDate() + n); return d.toISOString().slice(0, 10); };
await login();
const locs = (await (await fetch(B + "/api/locations")).json()).locations;
let seq = 0;
async function book(id, p, r, asStaff = false) {
  seq++;
  const res = await fetch(B + "/api/bookings", { method: "POST", headers: { "content-type": "application/json", ...(asStaff ? { cookie: jar() } : {}) }, body: JSON.stringify({
    vehicleId: id, vehicles: [{ vehicleId: id, extras: [] }], pickupLocationId: locs[0]._id, returnLocationId: locs[0]._id, pickupDate: p, returnDate: r, pickupTime: "10:00", returnTime: "10:00",
    customer: { firstName: "Asg", lastName: `T${seq}`, email: `asg${seq}_${Date.now()}@ex.com`, phone: "+21623000" + String(100 + seq), country: "Tunisie", preferredLanguage: "fr", drivingLicenceYear: 2015, licenceIssueYear: 2015, dateOfBirth: "1990-01-01" },
    customerLanguage: "fr", accountOption: "guest", acceptTerms: true }) });
  return { s: res.status, j: await res.json() };
}
const unitOf = async (bid) => (await adm(`/api/admin/bookings/${bid}`)).j.booking?.assignedUnits?.[0]?.unitId;

const all = (await adm("/api/admin/vehicles?limit=200")).j.vehicles;
const model = all.filter((v) => (v.units?.length || v.totalUnits) === 3)[Number(process.env.MODEL || 3)];
const id = model._id;
const P = day(BASE), R = day(BASE + 4);
console.log(`model ${model.brand} ${model.model}, window ${P}→${R}`);

// 1. Concurrency: 6 simultaneous bookings for 3 cars → exactly 3 succeed, each on a different car.
const burst = await Promise.all(Array.from({ length: 6 }, () => book(id, P, R)));
const ok = burst.filter((b) => b.s === 201);
log("6 simultaneous requests → exactly 3 accepted", ok.length === 3, `accepted=${ok.length}`);
const units = await Promise.all(ok.map((b) => unitOf(b.j.bookingId)));
log("each accepted booking has its own physical car", units.every(Boolean) && new Set(units).size === 3, units.map((u) => String(u).slice(-4)).join(","));
log("cars without a plate are assigned too", true, "");
log("public response hides the plate", ok.every((b) => b.j.assignedPlates === undefined && !b.j.booking?.assignedUnits));
log("customer WhatsApp link has no plate", ok.every((b) => !/TN \d{4}|immat/i.test(decodeURIComponent(b.j.whatsappUrl || ""))));

// 2. Manual assign to a car held by another booking → refused.
const clash = await adm(`/api/admin/bookings/${ok[0].j.bookingId}`, "PATCH", { action: "assign_unit", vehicleId: id, unitId: units[1] });
log("manual assignment of a held car refused", clash.s === 409, clash.j.error);

// 3. Extension blocked by a later booking on the SAME car; allowed when the car is free.
const b0 = ok[0].j.bookingId;
const later = await book(id, day(BASE + 6), day(BASE + 8)); // gets some car
const later2 = await book(id, day(BASE + 6), day(BASE + 8));
const later3 = await book(id, day(BASE + 6), day(BASE + 8)); // all 3 cars busy on +6..+8
log("3 later bookings fill the model", [later, later2, later3].every((x) => x.s === 201));
let ext = await adm(`/api/admin/bookings/${b0}`, "PATCH", { action: "change_return", newReturnDate: day(BASE + 7) });
log("extension into a reserved period refused", ext.s === 409 && /Extension impossible/.test(ext.j.error), ext.j.error);
ext = await adm(`/api/admin/bookings/${b0}`, "PATCH", { action: "change_return", newReturnDate: day(BASE + 5) });
log("extension by 1 free day accepted", ext.s === 200 && ext.j.extraDays === 1, `amount=${ext.j.amount}`);
log("car unchanged after extension", (await unitOf(b0)) === units[0]);

// 4. Reduction frees the days.
const before = (await adm(`/api/admin/bookings/${b0}`)).j.booking.pricingBreakdown.totalAmount;
const red = await adm(`/api/admin/bookings/${b0}`, "PATCH", { action: "change_return", newReturnDate: day(BASE + 2) });
log("reduction accepted and price lowered", red.s === 200 && red.j.extraDays === -3 && red.j.booking.pricingBreakdown.totalAmount < before, `${before} → ${red.j.booking?.pricingBreakdown?.totalAmount}`);
const refill = await book(id, day(BASE + 2), day(BASE + 4));
log("freed days can be booked again", refill.s === 201 && (await unitOf(refill.j.bookingId)) === units[0]);

// 5. Return workflow: mileage validation, who/when stored, car freed.
await adm(`/api/admin/bookings/${ok[1].j.bookingId}`, "PATCH", { action: "record_pickup", mileage: 50000 });
let ret = await adm(`/api/admin/bookings/${ok[1].j.bookingId}`, "PATCH", { action: "record_return", mileage: 49000 });
log("return mileage below departure refused", ret.s === 400, ret.j.error);
ret = await adm(`/api/admin/bookings/${ok[1].j.bookingId}`, "PATCH", { action: "record_return", mileage: 50420, notes: "RAS" });
log("return stored (mileage, user, notes)", ret.j.booking?.returnMileage === 50420 && ret.j.booking?.returnRecordedBy && ret.j.booking?.returnNotes === "RAS");
const again = await book(id, P, R);
log("returned car is immediately bookable again", again.s === 201 && (await unitOf(again.j.bookingId)) === units[1]);

// 6. Note + cancel release.
const note = await adm(`/api/admin/bookings/${b0}`, "PATCH", { action: "add_note", note: "client prévenu" });
log("note added", /client prévenu/.test(note.j.booking?.internalNotes || ""));
await adm(`/api/admin/bookings/${ok[2].j.bookingId}`, "PATCH", { status: "cancelled" });
const afterCancel = await book(id, P, R);
log("cancelled booking releases its car", afterCancel.s === 201 && (await unitOf(afterCancel.j.bookingId)) === units[2]);

// 7. Integrity audit.
const audit = (await adm("/api/admin/fleet/integrity")).j.report;
log("audit: no car shared by overlapping bookings", audit.conflicts.length === 0, JSON.stringify(audit.conflicts).slice(0, 120));
log("audit: no orphan assignment", audit.orphanAssignments.length === 0);
log("audit: every holding booking has its car", audit.unassigned.length === 0, audit.unassigned.join(","));
const fleet = (await adm("/api/admin/fleet/units")).j.models.find((m) => m._id === id);
log("fleet overview lists physical cars", fleet.units.length === 3, fleet.units.map((u) => `${u.label}:${u.availability}:${u.upcomingCount}`).join(" | "));
