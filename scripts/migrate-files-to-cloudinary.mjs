/**
 * Moves private documents (inspection photos, signatures, receipts, insurance PDFs) still stored
 * in MongoDB to Cloudinary as authenticated assets, then frees their bytes in the database.
 *
 *   node scripts/migrate-files-to-cloudinary.mjs           → dry run: counts what would move
 *   node scripts/migrate-files-to-cloudinary.mjs --apply   → migrates
 *
 * Safe to re-run: already migrated files are skipped. A file's bytes are removed from MongoDB only
 * after the copy on Cloudinary has been downloaded back and compared byte for byte.
 * Internal URLs (/api/admin/documents/<id>) do not change, so nothing else needs updating.
 */
import nextEnv from "@next/env";
import mongoose from "mongoose";
import { v2 as cloudinary } from "cloudinary";

nextEnv.loadEnvConfig(process.cwd(), false);

const apply = process.argv.includes("--apply");
const cloudName = process.env.CLOUDINARY_CLOUD_NAME || process.env.NEXT_PUBLIC_CLOUDINARY_CLOUD_NAME;
if (!process.env.MONGODB_URI) throw new Error("MONGODB_URI is missing");
if (!cloudName || !process.env.CLOUDINARY_API_KEY || !process.env.CLOUDINARY_API_SECRET) throw new Error("Cloudinary credentials are missing");
cloudinary.config({ cloud_name: cloudName, api_key: process.env.CLOUDINARY_API_KEY, api_secret: process.env.CLOUDINARY_API_SECRET, secure: true });

const upload = (data, contentType, purpose) =>
  new Promise((resolve, reject) =>
    cloudinary.uploader
      .upload_stream(
        {
          folder: `payless-private/${purpose}`,
          type: "authenticated",
          resource_type: contentType.startsWith("image/") ? "image" : "raw",
          tags: ["payless-private", `payless-private-${purpose}`],
          unique_filename: true,
          overwrite: false,
        },
        (error, res) => (error || !res ? reject(error || new Error("Upload failed")) : resolve(res))
      )
      .end(data)
  );

async function downloadBack(res) {
  const url = cloudinary.utils.private_download_url(res.public_id, res.format || "", {
    resource_type: res.resource_type,
    type: "authenticated",
    expires_at: Math.floor(Date.now() / 1000) + 120,
  });
  const r = await fetch(url);
  if (!r.ok) throw new Error(`verification download failed (${r.status})`);
  return Buffer.from(await r.arrayBuffer());
}

await mongoose.connect(process.env.MONGODB_URI);
const files = mongoose.connection.db.collection("storedfiles");
const filter = { publicId: { $exists: false }, data: { $exists: true } };
const total = await files.countDocuments(filter);
const [{ bytes = 0 } = {}] = await files.aggregate([{ $match: filter }, { $group: { _id: null, bytes: { $sum: "$size" } } }]).toArray();
console.log(`${total} fichier(s) à migrer, ${(bytes / 1024 / 1024).toFixed(1)} Mo.`);

if (!apply) {
  console.log("Simulation uniquement. Relancez avec --apply pour migrer.");
} else {
  let moved = 0;
  let failed = 0;
  for await (const doc of files.find(filter)) {
    const data = Buffer.from(doc.data.buffer ?? doc.data);
    try {
      const res = await upload(data, doc.contentType, doc.purpose || "insurance");
      const back = await downloadBack(res);
      if (!back.equals(data)) {
        await cloudinary.uploader.destroy(res.public_id, { resource_type: res.resource_type, type: "authenticated" }).catch(() => {});
        throw new Error("copy differs from the original");
      }
      await files.updateOne(
        { _id: doc._id, publicId: { $exists: false } },
        { $set: { storage: "cloudinary", publicId: res.public_id, resourceType: res.resource_type, ...(res.format ? { format: res.format } : {}) }, $unset: { data: "" } }
      );
      moved++;
      console.log(`✓ ${doc._id} ${doc.purpose} ${doc.filename}`);
    } catch (err) {
      failed++;
      console.error(`✗ ${doc._id} ${doc.filename}: ${err.message || err} (conservé dans MongoDB)`);
    }
  }
  console.log(`Terminé : ${moved} migré(s), ${failed} échec(s).`);
}

await mongoose.disconnect();
