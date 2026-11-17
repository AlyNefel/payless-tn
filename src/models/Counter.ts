import mongoose, { Schema, Model } from "mongoose";

interface ICounter {
  _id: string;
  seq: number;
}

const CounterSchema = new Schema<ICounter>({ _id: { type: String }, seq: { type: Number, default: 0 } });
const Counter: Model<ICounter> = mongoose.models.Counter || mongoose.model<ICounter>("Counter", CounterSchema);

/**
 * Gap-free, race-free document numbering (contracts, invoices, receipts, expenses):
 * `nextNumber("CTR")` → "CTR-2026-00042". The sequence restarts every year.
 */
export async function nextNumber(prefix: string, date: Date = new Date()): Promise<string> {
  const year = date.getUTCFullYear();
  const row = await Counter.findOneAndUpdate({ _id: `${prefix}-${year}` }, { $inc: { seq: 1 } }, { upsert: true, new: true });
  return `${prefix}-${year}-${String(row.seq).padStart(5, "0")}`;
}

export default Counter;
