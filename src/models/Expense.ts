import mongoose, { Schema, Document, Model } from "mongoose";

export const EXPENSE_CATEGORIES = [
  "fuel", "maintenance", "insurance", "taxes", "salaries", "rent", "cleaning",
  "fines", "leasing", "marketing", "utilities", "office", "bank", "other",
] as const;
export type ExpenseCategory = (typeof EXPENSE_CATEGORIES)[number];

/** Agency expense with its receipt (photo or PDF). Amounts in minor units, tax included. */
export interface IExpense extends Document {
  _id: mongoose.Types.ObjectId;
  number: string;
  date: Date;
  category: ExpenseCategory;
  label: string;
  supplier?: string;
  amount: number;
  /** VAT included in `amount` (recoverable VAT), minor units. */
  vatAmount: number;
  method: "cash" | "card" | "bank_transfer" | "cheque" | "other";
  invoiceNumber?: string;
  vehicleId?: mongoose.Types.ObjectId;
  unitId?: mongoose.Types.ObjectId;
  receiptUrl?: string;
  notes?: string;
  createdBy: string;
  closingId?: mongoose.Types.ObjectId;
  createdAt: Date;
  updatedAt: Date;
}

const ExpenseSchema = new Schema<IExpense>(
  {
    number: { type: String, required: true, unique: true },
    date: { type: Date, required: true, index: true },
    category: { type: String, enum: EXPENSE_CATEGORIES, required: true, index: true },
    label: { type: String, required: true, trim: true, maxlength: 200 },
    supplier: { type: String, trim: true, maxlength: 120 },
    amount: { type: Number, required: true, min: 1 },
    vatAmount: { type: Number, default: 0, min: 0 },
    method: { type: String, enum: ["cash", "card", "bank_transfer", "cheque", "other"], default: "cash" },
    invoiceNumber: { type: String, trim: true, maxlength: 80 },
    vehicleId: { type: Schema.Types.ObjectId, ref: "Vehicle", index: true },
    unitId: { type: Schema.Types.ObjectId },
    receiptUrl: { type: String, default: "" },
    notes: { type: String, maxlength: 1000 },
    createdBy: { type: String, required: true },
    closingId: { type: Schema.Types.ObjectId, ref: "CashClosing", index: true },
  },
  { timestamps: true }
);

const Expense: Model<IExpense> = mongoose.models.Expense || mongoose.model<IExpense>("Expense", ExpenseSchema);
export default Expense;
