// Full backup of the database to JSON files (one per collection), readable without any tool.
//
//   npm run backup                     → backups/<date>/…  using MONGODB_URI from .env.local
//   MONGODB_URI="mongodb+srv://…" npm run backup
//
// Read-only: nothing is written to the database. Restore with `mongoimport --jsonArray`
// (Extended JSON, so dates and ids keep their type). Private documents (contracts, receipts,
// signatures) are included — keep the backup folder somewhere safe.
import nextEnv from "@next/env";
const { loadEnvConfig } = nextEnv;
import mongoose from "mongoose";
import { EJSON } from "bson";
import { createWriteStream, mkdirSync } from "node:fs";
import { join } from "node:path";

loadEnvConfig(process.cwd(), false);
const uri = process.env.MONGODB_URI;
if (!uri) {
  console.error("MONGODB_URI is not set (put it in .env.local or pass it on the command line).");
  process.exit(1);
}
const stamp = new Date().toISOString().replace(/[:.]/g, "-").slice(0, 19);
const dir = join(process.cwd(), "backups", stamp);
mkdirSync(dir, { recursive: true });

await mongoose.connect(uri, { serverSelectionTimeoutMS: 15000 });
const db = mongoose.connection.db;
console.log(`Database "${db.databaseName}" → ${dir}`);
let total = 0;
for (const { name } of await db.listCollections().toArray()) {
  if (name.startsWith("system.")) continue;
  const out = createWriteStream(join(dir, `${name}.json`));
  out.write("[\n");
  let n = 0;
  for await (const doc of db.collection(name).find({})) {
    out.write((n ? ",\n" : "") + EJSON.stringify(doc, { relaxed: false }));
    n++;
  }
  out.write("\n]\n");
  await new Promise((r) => out.end(r));
  total += n;
  console.log(`  ${name.padEnd(24)} ${n}`);
}
await mongoose.disconnect();
console.log(`Done: ${total} documents. Keep this folder private.`);
