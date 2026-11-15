import mongoose, { Schema, Document, Model } from "mongoose";

/** RBAC role: a named set of granular permissions ("bookings.cancel", "fleet.create"…). */
export interface IRole extends Document {
  key: string;
  name: string;
  description?: string;
  permissions: string[];
  isSystem: boolean;
  color?: string;
  createdAt: Date;
  updatedAt: Date;
}

const RoleSchema = new Schema<IRole>(
  {
    key: { type: String, required: true, unique: true, trim: true, lowercase: true, maxlength: 40 },
    name: { type: String, required: true, trim: true, maxlength: 60 },
    description: { type: String, default: "", maxlength: 300 },
    permissions: { type: [String], default: [] },
    isSystem: { type: Boolean, default: false },
    color: { type: String, default: "slate" },
  },
  { timestamps: true }
);

const Role: Model<IRole> = mongoose.models.Role || mongoose.model<IRole>("Role", RoleSchema);
export default Role;
