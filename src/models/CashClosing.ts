import mongoose, { Schema, Document, Model } from "mongoose";

/** End-of-shift cash count: what the ledger expects in the drawer vs what was counted. */
export interface ICashClosing extends Document {
  _id: mongoose.Types.ObjectId;
  number: string;
  closedAt: Date;
  closedBy: string;
  /** Agent whose cash is counted ("" = the whole agency). */
  agent: string;
  openingFloat: number;
  cashIn: number;
  cashOut: number;
  cashExpenses: number;
  expected: number;
  counted: number;
  difference: number;
  paymentCount: number;
  expenseCount: number;
  notes?: string;
  createdAt: Date;
}

const CashClosingSchema = new Schema<ICashClosing>(
  {
    number: { type: String, required: true, unique: true },
    closedAt: { type: Date, required: true, index: true },
    closedBy: { type: String, required: true },
    agent: { type: String, default: "" },
    openingFloat: { type: Number, default: 0 },
    cashIn: { type: Number, default: 0 },
    cashOut: { type: Number, default: 0 },
    cashExpenses: { type: Number, default: 0 },
    expected: { type: Number, default: 0 },
    counted: { type: Number, default: 0 },
    difference: { type: Number, default: 0 },
    paymentCount: { type: Number, default: 0 },
    expenseCount: { type: Number, default: 0 },
    notes: { type: String, maxlength: 1000 },
  },
  { timestamps: true }
);

const CashClosing: Model<ICashClosing> = mongoose.models.CashClosing || mongoose.model<ICashClosing>("CashClosing", CashClosingSchema);
export default CashClosing;
