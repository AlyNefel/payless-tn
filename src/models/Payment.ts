import mongoose, { Schema, Document, Model } from "mongoose";

export type PaymentKind = "payment" | "deposit" | "refund" | "deposit_refund";
export type PaymentMethod = "cash" | "card" | "bank_transfer" | "cheque" | "online" | "other";

/**
 * One money movement on a booking. Amounts are in minor units (1 TND = 100) and always positive:
 * `kind` gives the direction (payment / deposit = money in, refund / deposit_refund = money out).
 * A movement is never edited or deleted: it is voided, with a reason, and stays in the ledger.
 */
export interface IPayment extends Document {
  _id: mongoose.Types.ObjectId;
  receiptNumber: string;
  bookingId: mongoose.Types.ObjectId;
  bookingReference: string;
  customerId?: mongoose.Types.ObjectId;
  customerName: string;
  kind: PaymentKind;
  amount: number;
  currency: string;
  method: PaymentMethod;
  status: "completed" | "voided";
  reference?: string;
  notes?: string;
  paidAt: Date;
  recordedBy: string;
  voidedAt?: Date;
  voidedBy?: string;
  voidReason?: string;
  /** Cash closing that counted this movement (cash only). */
  closingId?: mongoose.Types.ObjectId;
  createdAt: Date;
  updatedAt: Date;
}

const PaymentSchema = new Schema<IPayment>(
  {
    receiptNumber: { type: String, required: true, unique: true },
    bookingId: { type: Schema.Types.ObjectId, ref: "Booking", required: true, index: true },
    bookingReference: { type: String, default: "" },
    customerId: { type: Schema.Types.ObjectId, ref: "Customer" },
    customerName: { type: String, default: "" },
    kind: { type: String, enum: ["payment", "deposit", "refund", "deposit_refund"], default: "payment" },
    amount: { type: Number, required: true, min: 1 },
    currency: { type: String, default: "TND" },
    method: { type: String, enum: ["cash", "card", "bank_transfer", "cheque", "online", "other"], required: true },
    status: { type: String, enum: ["completed", "voided"], default: "completed", index: true },
    reference: String,
    notes: String,
    paidAt: { type: Date, required: true, index: true },
    recordedBy: { type: String, required: true, index: true },
    voidedAt: Date,
    voidedBy: String,
    voidReason: String,
    closingId: { type: Schema.Types.ObjectId, ref: "CashClosing", index: true },
  },
  { timestamps: true }
);

const Payment: Model<IPayment> = mongoose.models.Payment || mongoose.model<IPayment>("Payment", PaymentSchema);

export default Payment;
