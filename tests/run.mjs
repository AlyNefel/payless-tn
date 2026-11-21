// Integration test runner.
//
//   npm test            → builds the app if needed, starts an in-memory MongoDB and the app,
//                         seeds demo data, runs every tests/*.test.mjs, then stops everything.
//   npm test -- ledger  → only the files whose name contains "ledger".
//
// Nothing here touches a real database: MongoDB runs in memory and is thrown away at the end.
import { spawn, spawnSync } from "node:child_process";
import { existsSync, readdirSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { MongoMemoryServer } from "mongodb-memory-server";

const root = join(dirname(fileURLToPath(import.meta.url)), "..");
const filter = process.argv[2] || "";
const PORT = Number(process.env.TEST_PORT || 3999);
const URL_ = `http://127.0.0.1:${PORT}`;
// Order matters a little: the repair test rewrites assignments made by the earlier files.
const ORDER = ["assignment", "availability", "pricing-rules", "price-lock", "worker", "rbac", "accounting", "additions", "vehicle-change", "legacy-repair"];
const files = readdirSync(join(root, "tests"))
  .filter((f) => f.endsWith(".test.mjs") && f.includes(filter))
  .sort((a, b) => {
    const i = (f) => {
      const k = ORDER.indexOf(f.replace(".test.mjs", ""));
      return k === -1 ? ORDER.length : k;
    };
    return i(a) - i(b) || a.localeCompare(b);
  });
if (!files.length) {
  console.error("No test file matches.");
  process.exit(1);
}

if (!existsSync(join(root, ".next", "BUILD_ID")) || process.env.TEST_BUILD === "1") {
  console.log("▶ building the app…");
  // The first build of a fresh checkout can fail once on a framework notice: retry once.
  const build = () => spawnSync("npx", ["next", "build", "--webpack"], { cwd: root, stdio: "inherit" }).status;
  if (build() !== 0 && build() !== 0) process.exit(1);
}

// A server left over from an interrupted run would answer instead of this one.
if (await fetch(`${URL_}/api/rental-rules`).then(() => true).catch(() => false)) {
  console.error(`Port ${PORT} is already in use: stop the process on it, or set TEST_PORT.`);
  process.exit(1);
}

const mongo = await MongoMemoryServer.create({ instance: { dbName: "payless" } });
const env = {
  ...process.env,
  MONGODB_URI: mongo.getUri("payless"),
  AUTH_SECRET: "test-secret-0123456789abcdef0123456789",
  AUTH_TRUST_HOST: "true",
  ALLOW_SEED: "true",
  SEED_TOKEN: "test-seed-token",
  ADMIN_INITIAL_PASSWORD: "TestPassword123!",
  TEST_URL: URL_,
  TEST_MONGO_URL: mongo.getUri(),
};
// Own process group, so stopping it also stops the Next.js server that npx starts.
const app = spawn("npx", ["next", "start", "-p", String(PORT)], { cwd: root, env, stdio: ["ignore", "pipe", "pipe"], detached: true });
let appLog = "";
app.stdout.on("data", (d) => (appLog += d));
app.stderr.on("data", (d) => (appLog += d));

const stop = async (code) => {
  try {
    process.kill(-app.pid, "SIGTERM");
  } catch {
    app.kill("SIGTERM");
  }
  await mongo.stop().catch(() => {});
  process.exit(code);
};
process.on("SIGINT", () => stop(130));

let up = false;
for (let i = 0; i < 90 && !up; i++) {
  await new Promise((r) => setTimeout(r, 1000));
  up = await fetch(`${URL_}/api/rental-rules`).then((r) => r.ok).catch(() => false);
}
if (!up) {
  console.error("The app did not start:\n" + appLog.slice(-2000));
  await stop(1);
}
const seed = await fetch(`${URL_}/api/seed`, { method: "POST", headers: { "x-seed-token": env.SEED_TOKEN } });
if (!seed.ok) {
  console.error("Seeding failed:", seed.status, await seed.text(), "\n" + appLog.slice(-1500));
  await stop(1);
}

let failedFiles = 0;
for (const f of files) {
  console.log(`\n━━ ${f} ━━`);
  const out = await new Promise((resolve) => {
    const child = spawn(process.execPath, [join(root, "tests", f)], { env, stdio: ["ignore", "pipe", "pipe"] });
    let text = "";
    child.stdout.on("data", (d) => (text += d));
    child.stderr.on("data", (d) => (text += d));
    child.on("close", (code) => resolve({ code, text }));
  });
  const lines = out.text.split("\n");
  const fails = lines.filter((l) => l.startsWith("FAIL"));
  const passes = lines.filter((l) => l.startsWith("PASS")).length;
  // Quiet on success, full detail on failure.
  if (process.env.VERBOSE) console.log(out.text.trim());
  if (out.code !== 0 || fails.length || passes === 0) {
    failedFiles++;
    if (!process.env.VERBOSE) console.log(out.text.trim());
    console.log(`✗ ${f}: ${fails.length} failed, ${passes} passed${out.code ? ` (exit ${out.code})` : ""}`);
  } else {
    console.log(`✓ ${passes} checks passed`);
  }
}
console.log(failedFiles ? `\n✗ ${failedFiles} test file(s) failed` : `\n✓ all ${files.length} test files passed`);
if (failedFiles) console.log("\n── app log (tail) ──\n" + appLog.slice(-1500));
await stop(failedFiles ? 1 : 0);
