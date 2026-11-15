import mongoose, { Schema, Document, Model } from "mongoose";

export interface IExtra extends Document {
  _id: mongoose.Types.ObjectId;
  name: { fr: string; en: string; ar: string };
  description: { fr: string; en: string; ar: string };
  /** Lucide icon name (e.g. "Baby"), an emoji, or an image URL (https://…, /…). */
  icon: string;
  /** Cloudinary public id when `icon` is an uploaded image (used for cleanup). */
  iconPublicId?: string;
  price: number; // per day in minor units
  pricingType: "per_day" | "per_rental" | "per_unit";
  maxQuantity: number;
  /**
   * "quantity": classic add-on (+/-). "amount": the customer chooses an amount on a slider
   * (e.g. prepaid fuel 50 / 100 / 150 DT). Amount bounds are in minor units.
   */
  selectionMode?: "quantity" | "amount";
  amountMin?: number;
  amountMax?: number;
  amountStep?: number;
  isActive: boolean;
  order: number;
  createdAt: Date;
  updatedAt: Date;
}

const ExtraSchema = new Schema<IExtra>(
  {
    name: {
      fr: { type: String, required: true },
      en: { type: String, required: true },
      ar: { type: String, required: true },
    },
    description: {
      fr: { type: String, default: "" },
      en: { type: String, default: "" },
      ar: { type: String, default: "" },
    },
    icon: { type: String, required: true, trim: true },
    iconPublicId: { type: String, default: "" },
    price: { type: Number, required: true },
    pricingType: {
      type: String,
      enum: ["per_day", "per_rental", "per_unit"],
      default: "per_day",
      // Legacy seed data used "fixed" for one-off fees: map it onto the schema enum.
      set: (v: string) => (v === "fixed" ? "per_rental" : v),
    },
    maxQuantity: { type: Number, default: 1 },
    selectionMode: { type: String, enum: ["quantity", "amount"], default: "quantity" },
    amountMin: { type: Number, default: 5000 },
    amountMax: { type: Number, default: 20000 },
    amountStep: { type: Number, default: 5000 },
    isActive: { type: Boolean, default: true },
    order: { type: Number, default: 0 },
  },
  { timestamps: true }
);

const Extra: Model<IExtra> =
  mongoose.models.Extra || mongoose.model<IExtra>("Extra", ExtraSchema);

export default Extra;
