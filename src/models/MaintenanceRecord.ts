import mongoose, { Schema, Document, Model } from "mongoose";

export interface IMaintenanceRecord extends Document {
  _id: mongoose.Types.ObjectId;
  vehicleId: mongoose.Types.ObjectId;
  /** Physical car concerned (Vehicle.units._id) and its plate snapshot. */
  unitId?: mongoose.Types.ObjectId;
  licensePlate?: string;
  type: "scheduled" | "unscheduled" | "inspection" | "repair" | "vidange" | "technical_inspection" | "tyres" | "bodywork";
  mileage?: number;
  description: string;
  startDate: Date;
  endDate?: Date;
  cost?: number;
  provider?: string;
  notes?: string;
  status: "scheduled" | "in_progress" | "completed" | "cancelled";
  recordedBy?: mongoose.Types.ObjectId;
  createdAt: Date;
  updatedAt: Date;
}

const MaintenanceRecordSchema = new Schema<IMaintenanceRecord>(
  {
    vehicleId: { type: Schema.Types.ObjectId, ref: "Vehicle", required: true, index: true },
    type: {
      type: String,
      enum: ["scheduled", "unscheduled", "inspection", "repair", "vidange", "technical_inspection", "tyres", "bodywork"],
      required: true,
    },
    unitId: { type: Schema.Types.ObjectId, index: true },
    licensePlate: { type: String, default: "" },
    mileage: Number,
    description: { type: String, required: true },
    startDate: { type: Date, required: true },
    endDate: Date,
    cost: Number,
    provider: String,
    notes: String,
    status: {
      type: String,
      enum: ["scheduled", "in_progress", "completed", "cancelled"],
      default: "scheduled",
    },
    recordedBy: { type: Schema.Types.ObjectId, ref: "User" },
  },
  { timestamps: true }
);

const MaintenanceRecord: Model<IMaintenanceRecord> =
  mongoose.models.MaintenanceRecord ||
  mongoose.model<IMaintenanceRecord>("MaintenanceRecord", MaintenanceRecordSchema);

export default MaintenanceRecord;
