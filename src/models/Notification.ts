import mongoose, { Schema, Document, Model } from "mongoose";

export interface INotification extends Document {
  _id: mongoose.Types.ObjectId;
  /** Empty for notifications shared by the whole back-office team (audience "staff"). */
  recipientId?: mongoose.Types.ObjectId;
  recipientType: "user" | "customer" | "staff";
  type: string;
  category?: "booking" | "maintenance" | "payment" | "system" | "reminder";
  severity?: "info" | "success" | "warning" | "critical";
  priority?: "high" | "medium" | "low";
  /** Prevents the same alert from being raised twice (e.g. "vidange:<unit>:<km>:soon"). */
  dedupeKey?: string;
  /** Custom reminders: hidden until this date. */
  scheduledFor?: Date;
  createdBy?: string;
  /** Removed from the inbox (alerts are kept so their dedupe key stays effective). */
  hidden?: boolean;
  title: { fr: string; en: string; ar: string };
  message: { fr: string; en: string; ar: string };
  link?: string;
  isRead: boolean;
  readAt?: Date;
  data?: Record<string, unknown>;
  createdAt: Date;
}

const NotificationSchema = new Schema<INotification>(
  {
    recipientId: { type: Schema.Types.ObjectId, index: true },
    recipientType: { type: String, enum: ["user", "customer", "staff"], default: "staff" },
    type: { type: String, required: true },
    category: { type: String, enum: ["booking", "maintenance", "payment", "system", "reminder"], default: "system" },
    severity: { type: String, enum: ["info", "success", "warning", "critical"], default: "info" },
    priority: { type: String, enum: ["high", "medium", "low"], default: "medium" },
    dedupeKey: { type: String, unique: true, sparse: true },
    scheduledFor: { type: Date, index: true },
    createdBy: String,
    hidden: { type: Boolean, default: false },
    title: {
      fr: { type: String, required: true },
      en: { type: String, required: true },
      ar: { type: String, required: true },
    },
    message: {
      fr: { type: String, default: "" },
      en: { type: String, default: "" },
      ar: { type: String, default: "" },
    },
    link: String,
    isRead: { type: Boolean, default: false, index: true },
    readAt: Date,
    data: { type: Schema.Types.Mixed },
  },
  { timestamps: true }
);

NotificationSchema.index({ recipientId: 1, isRead: 1, createdAt: -1 });
NotificationSchema.index({ recipientType: 1, createdAt: -1 });

const Notification: Model<INotification> =
  mongoose.models.Notification ||
  mongoose.model<INotification>("Notification", NotificationSchema);

export default Notification;
