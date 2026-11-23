import mongoose, { Schema, Model } from "mongoose";
import { NextResponse } from "next/server";
import connectDB from "./db";

/**
 * Request counter per client IP and time window, stored in MongoDB so it holds across the
 * serverless instances (an in-memory counter would reset on every cold start).
 * Rows expire on their own (TTL index).
 */
interface IRateHit {
  _id: string;
  count: number;
  expiresAt: Date;
}
const RateHitSchema = new Schema<IRateHit>({ _id: String, count: { type: Number, default: 0 }, expiresAt: { type: Date, index: { expires: 0 } } }, { versionKey: false });
const RateHit: Model<IRateHit> = mongoose.models.RateHit || mongoose.model<IRateHit>("RateHit", RateHitSchema);

/** Client IP as seen by the hosting proxy (Vercel sets x-real-ip / x-forwarded-for). */
export function clientIp(headers: Headers): string {
  return headers.get("x-real-ip")?.trim() || headers.get("x-forwarded-for")?.split(",")[0]?.trim() || "local";
}

/**
 * Counts one hit for `bucket` (e.g. "booking") and this IP. Returns a 429 response once more than
 * `limit` hits happened in the current `windowSec` window, null otherwise.
 * `extraKey` narrows the bucket (e.g. an email for login attempts).
 */
export async function rateLimit(
  headers: Headers,
  bucket: string,
  limit: number,
  windowSec: number,
  extraKey = ""
): Promise<NextResponse | null> {
  if (process.env.RATE_LIMIT_DISABLED === "1") return null;
  const count = await hit(headers, bucket, windowSec, extraKey);
  if (count <= limit) return null;
  return NextResponse.json(
    { success: false, error: "Trop de demandes en peu de temps. Merci de réessayer dans quelques minutes.", code: "RATE_LIMITED" },
    { status: 429, headers: { "Retry-After": String(windowSec) } }
  );
}

/** Same counter, returning true when the limit is exceeded (for code that cannot return a response). */
export async function isRateLimited(headers: Headers, bucket: string, limit: number, windowSec: number, extraKey = ""): Promise<boolean> {
  if (process.env.RATE_LIMIT_DISABLED === "1") return false;
  return (await hit(headers, bucket, windowSec, extraKey)) > limit;
}

async function hit(headers: Headers, bucket: string, windowSec: number, extraKey: string): Promise<number> {
  try {
    await connectDB();
    const now = Date.now();
    const slot = Math.floor(now / (windowSec * 1000));
    const key = `${bucket}:${clientIp(headers)}${extraKey ? `:${extraKey.toLowerCase()}` : ""}:${slot}`;
    const row = await RateHit.findOneAndUpdate(
      { _id: key },
      { $inc: { count: 1 }, $setOnInsert: { expiresAt: new Date((slot + 1) * windowSec * 1000 + 60_000) } },
      { upsert: true, new: true }
    ).lean();
    return row?.count ?? 0;
  } catch (err) {
    // Never block a customer because the counter is unavailable.
    console.error("rateLimit:", err);
    return 0;
  }
}
