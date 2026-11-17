// Shared helpers for the integration tests. The suite talks to a running app over HTTP,
// exactly like a browser would (see tests/run.mjs for how the app and database are started).
export const B = process.env.TEST_URL || "http://localhost:3456";
export const ADMIN = { email: "admin@paylesscarrental.com", password: process.env.ADMIN_INITIAL_PASSWORD || "TestPassword123!" };

export function session() {
  const c = {};
  const jar = () => Object.entries(c).map(([k, v]) => `${k}=${v}`).join("; ");
  const store = (r) => {
    for (const x of r.headers.getSetCookie()) {
      const [kv] = x.split(";");
      const i = kv.indexOf("=");
      c[kv.slice(0, i)] = kv.slice(i + 1);
    }
  };
  return {
    jar,
    async login(email, password) {
      const cs = await fetch(`${B}/api/auth/csrf`);
      store(cs);
      const csrfToken = (await cs.json()).csrfToken;
      store(
        await fetch(`${B}/api/auth/callback/credentials`, {
          method: "POST",
          redirect: "manual",
          body: new URLSearchParams({ csrfToken, email, password }),
          headers: { cookie: jar(), "content-type": "application/x-www-form-urlencoded" },
        })
      );
      return this;
    },
    async req(path, method = "GET", body) {
      const r = await fetch(B + path, { method, headers: { cookie: jar(), "content-type": "application/json" }, body: body ? JSON.stringify(body) : undefined });
      let j = {};
      try {
        j = await r.json();
      } catch {
        /* not JSON */
      }
      return { s: r.status, j };
    },
    raw(path) {
      return fetch(B + path, { headers: { cookie: jar() } });
    },
    async upload(path, buf, name, type, fields = {}) {
      const fd = new FormData();
      fd.append("file", new Blob([buf], { type }), name);
      for (const [k, v] of Object.entries(fields)) fd.append(k, v);
      const r = await fetch(B + path, { method: "POST", body: fd, headers: { cookie: jar() } });
      return { s: r.status, j: await r.json().catch(() => ({})) };
    },
  };
}

export const admin = async () => session().login(ADMIN.email, ADMIN.password);
export const pub = async (path) => (await fetch(B + path)).json();
export const tag = Date.now().toString(36);
export const day = (n) => {
  const d = new Date();
  d.setDate(d.getDate() + n);
  return d.toISOString().slice(0, 10);
};

let failed = 0;
let passed = 0;
export function check(name, ok, detail = "") {
  if (ok) passed++;
  else failed++;
  console.log(`${ok ? "PASS" : "FAIL"}  ${name}${detail ? `  ${detail}` : ""}`);
}
export function finish() {
  console.log(`\n${passed} passed, ${failed} failed`);
  process.exit(failed ? 1 : 0);
}

/** Public booking of one car for a period. Each test file uses its own far-future window. */
export async function book(vehicleId, locationId, pickupDate, returnDate, extra = {}) {
  const res = await fetch(`${B}/api/bookings`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({
      vehicleId,
      vehicles: [{ vehicleId, extras: [] }],
      pickupLocationId: locationId,
      returnLocationId: locationId,
      pickupDate,
      returnDate,
      pickupTime: "10:00",
      returnTime: "10:00",
      customer: {
        firstName: "Test",
        lastName: tag,
        email: `t_${tag}_${Math.random().toString(36).slice(2, 8)}@example.com`,
        phone: "+21624000111",
        country: "Tunisie",
        preferredLanguage: "fr",
        drivingLicenceYear: 2015,
        licenceIssueYear: 2015,
        dateOfBirth: "1990-01-01",
      },
      customerLanguage: "fr",
      accountOption: "guest",
      acceptTerms: true,
      ...extra,
    }),
  });
  return { s: res.status, j: await res.json() };
}

export async function fixtures(pickup, ret) {
  const locations = (await pub("/api/locations")).locations;
  const vehicles = (await pub(`/api/vehicles?pickupDate=${pickup}&returnDate=${ret}&limit=50`)).vehicles;
  return { locationId: locations[0]._id, vehicles, car: vehicles.find((v) => v.availableUnits >= 3) || vehicles[0] };
}
