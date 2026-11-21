// Admin reservations list: period filters, status counts, plate search, paging.
import { admin, book, check, finish, pub } from "./lib.mjs";

const A = await admin();
const loc = (await pub("/api/locations")).locations[0]._id;
const list = (await pub(`/api/vehicles?pickupDate=2033-01-10&returnDate=2033-02-10&limit=100`)).vehicles.filter((v) => !(v.pricing.seasonalPrices || []).length);
const car = list.find((v) => v.availableUnits >= 3);
const jan10 = await book(car._id, loc, "2033-01-10", "2033-01-13");
const jan28 = await book(car._id, loc, "2033-01-28", "2033-02-03"); // runs over two months
const feb05 = await book(car._id, loc, "2033-02-05", "2033-02-08");
check("fixture bookings", [jan10, jan28, feb05].every((b) => b.s < 300));
const refs = (r) => r.j.bookings.map((b) => b.bookingReference);
const q = (s) => A.req(`/api/admin/bookings?${s}`);

let r = await q("dateField=pickup&from=2033-01-01&to=2033-01-31&limit=200");
check("departures in January", refs(r).includes(jan10.j.bookingReference) && refs(r).includes(jan28.j.bookingReference) && !refs(r).includes(feb05.j.bookingReference));
r = await q("dateField=return&from=2033-02-01&to=2033-02-28&limit=200");
check("returns in February", refs(r).includes(jan28.j.bookingReference) && refs(r).includes(feb05.j.bookingReference) && !refs(r).includes(jan10.j.bookingReference));
r = await q("dateField=overlap&from=2033-02-01&to=2033-02-02&limit=200");
check("rentals running on 1-2 February (started in January)", refs(r).includes(jan28.j.bookingReference) && !refs(r).includes(feb05.j.bookingReference) && !refs(r).includes(jan10.j.bookingReference));
r = await q("dateField=pickup&from=2033-01-10&to=2033-01-10&limit=200");
check("one-day period is inclusive", refs(r).includes(jan10.j.bookingReference));
r = await q("dateField=pickup&from=2033-01-01&to=2033-02-28&limit=200");
check("counts per status follow the period", r.j.counts.All === r.j.total && r.j.counts.All >= 3 && typeof r.j.periodAmount === "number");
r = await q("dateField=pickup&from=2033-01-01&to=2033-02-28&status=pending&limit=200");
const pendingCount = r.j.total;
r = await q("dateField=pickup&from=2033-01-01&to=2033-02-28&limit=200");
check("status tab count = filtered total", r.j.counts.pending === pendingCount);
r = await q("dateField=pickup&from=2033-01-01&to=2033-02-28&sort=pickup_asc&limit=200");
const dates = r.j.bookings.map((b) => b.pickupDate);
check("sorted by departure", dates.every((d, i) => i === 0 || d >= dates[i - 1]));
const p1 = await q("dateField=pickup&from=2033-01-01&to=2033-02-28&sort=pickup_asc&limit=1&page=1");
const p2 = await q("dateField=pickup&from=2033-01-01&to=2033-02-28&sort=pickup_asc&limit=1&page=2");
check("paging returns the next booking", p1.j.bookings[0]?.bookingReference !== p2.j.bookings[0]?.bookingReference && p1.j.total >= 3);
// Plate search on the assigned physical car.
const units = (await A.req("/api/admin/fleet/units")).j.models.find((m) => (m._id || m.vehicleId) === car._id).units;
const full = (await A.req(`/api/admin/bookings/${(await q(`search=${jan10.j.bookingReference}`)).j.bookings[0]._id}`)).j.booking;
const unitId = String(full.assignedUnits[0].unitId);
const plate = `TST ${Date.now().toString().slice(-4)}`;
await A.req("/api/admin/fleet/units", "PATCH", { vehicleId: car._id, unitId, licensePlate: plate });
r = await q(`search=${encodeURIComponent(plate)}`);
check("search by plate of the assigned car", refs(r).includes(jan10.j.bookingReference), `${units.length} units`);
r = await q("dateField=pickup&from=bad&to=2033-01-31&limit=5");
check("invalid date ignored, no crash", r.s === 200);
finish();
