import { MongoClient } from "mongodb";
const B = process.env.TEST_URL || "http://localhost:3456";
let c = {}; const jar = () => Object.entries(c).map(([k, v]) => k + "=" + v).join("; ");
const st = (r) => { for (const x of r.headers.getSetCookie()) { const [kv] = x.split(";"); const i = kv.indexOf("="); c[kv.slice(0, i)] = kv.slice(i + 1); } };
const cs = await fetch(B + "/api/auth/csrf"); st(cs); const t = (await cs.json()).csrfToken;
st(await fetch(B + "/api/auth/callback/credentials", { method: "POST", redirect: "manual", body: new URLSearchParams({ csrfToken: t, email: "admin@paylesscarrental.com", password: process.env.ADMIN_INITIAL_PASSWORD || "TestPassword123!" }), headers: { cookie: jar(), "content-type": "application/x-www-form-urlencoded" } }));
const adm = async (p, m = "GET") => (await fetch(B + p, { method: m, headers: { cookie: jar() } })).json();
const log = (n, ok, x = "") => console.log(`${ok ? "PASS" : "FAIL"}  ${n} ${x}`);
const cli = await MongoClient.connect(process.env.TEST_MONGO_URL || "mongodb://127.0.0.1:27999"); const db = cli.db("payless");
// Recreate the old bug: two overlapping bookings of the same model forced onto the SAME physical car.
const all = await db.collection("bookings").find({ bookingStatus: "confirmed", "assignedUnits.0": { $exists: true } }).toArray();
let pair = null;
for (const a of all) { const b = all.find((x) => String(x._id) !== String(a._id) && String(x.vehicleId) === String(a.vehicleId) && x.pickupDate < a.returnDate && x.returnDate > a.pickupDate && String(x.assignedUnits[0].unitId) !== String(a.assignedUnits[0].unitId)); if (b) { pair = [a, b]; break; } }
const [a, b] = pair;
await db.collection("bookings").updateOne({ _id: b._id }, { $set: { assignedUnits: a.assignedUnits } });
await db.collection("unitholds").deleteMany({ bookingId: b._id });
let rep = (await adm("/api/admin/fleet/integrity")).report;
log("audit detects the shared car", rep.conflicts.length === 1 && rep.conflicts[0].bookings.includes(a.bookingReference) && rep.conflicts[0].bookings.includes(b.bookingReference), JSON.stringify(rep.conflicts));
const fix = await adm("/api/admin/fleet/integrity", "POST");
log("repair re-assigns the later booking", fix.report.fixed.reassigned.length >= 1 && fix.after.conflicts.length === 0, `reassigned=${fix.report.fixed.reassigned}`);
const a2 = await db.collection("bookings").findOne({ _id: a._id }); const b2 = await db.collection("bookings").findOne({ _id: b._id });
log("both bookings now have different physical cars", String(a2.assignedUnits[0].unitId) !== String(b2.assignedUnits[0].unitId));
log("oldest booking kept its car", String(a2.assignedUnits[0].unitId) === String(a.assignedUnits[0].unitId) || a.createdAt > b.createdAt);
// Database-level guarantee: a duplicate (car, day) hold is rejected by the unique index.
const h = await db.collection("unitholds").findOne({});
let dup = false; try { await db.collection("unitholds").insertOne({ unitId: h.unitId, day: h.day, bookingId: b._id, vehicleId: h.vehicleId }); } catch { dup = true; }
log("unique index refuses the same car on the same day twice", dup);
await cli.close();
