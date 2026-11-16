import mongoose, { Schema, Model } from "mongoose";

/** Insurance contract of one physical car (Garage → Assurance). */
export interface IInsurancePolicy {
  _id: mongoose.Types.ObjectId;
  vehicleId: mongoose.Types.ObjectId;
  unitId: mongoose.Types.ObjectId;
  company: string;
  policyNumber: string;
  startDate: Date;
  endDate: Date;
  /** Premium in minor units (1 TND = 100). */
  cost: number;
  /** Link to the contract scan (image / PDF). */
  attachmentUrl?: string;
  notes?: string;
  /** Set when a newer policy replaces this one. */
  renewedBy?: mongoose.Types.ObjectId;
  cancelled?: boolean;
  createdBy?: string;
  createdAt: Date;
  updatedAt: Date;
}

const InsurancePolicySchema = new Schema<IInsurancePolicy>(
  {
    vehicleId: { type: Schema.Types.ObjectId, ref: "Vehicle", required: true, index: true },
    unitId: { type: Schema.Types.ObjectId, required: true, index: true },
    company: { type: String, required: true, trim: true, maxlength: 120 },
    policyNumber: { type: String, required: true, trim: true, maxlength: 80 },
    startDate: { type: Date, required: true },
    endDate: { type: Date, required: true, index: true },
    cost: { type: Number, default: 0 },
    attachmentUrl: { type: String, default: "" },
    notes: { type: String, default: "" },
    renewedBy: { type: Schema.Types.ObjectId },
    cancelled: { type: Boolean, default: false },
    createdBy: String,
  },
  { timestamps: true }
);

const InsurancePolicy: Model<IInsurancePolicy> =
  mongoose.models.InsurancePolicy || mongoose.model<IInsurancePolicy>("InsurancePolicy", InsurancePolicySchema);
export default InsurancePolicy;
