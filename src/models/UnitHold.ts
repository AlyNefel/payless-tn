import mongoose, { Schema, Model } from "mongoose";

/**
 * One document per (physical car, calendar day) held by a booking.
 * The UNIQUE index on { unitId, day } is the arbiter of vehicle assignment: the database itself
 * refuses to give the same physical car to two bookings on the same day, even when two requests
 * arrive at the same millisecond.
 */
export interface IUnitHold {
  unitId: mongoose.Types.ObjectId;
  day: string; // "YYYY-MM-DD" (UTC calendar day)
  bookingId: mongoose.Types.ObjectId;
  vehicleId: mongoose.Types.ObjectId;
}

const UnitHoldSchema = new Schema<IUnitHold>(
  {
    unitId: { type: Schema.Types.ObjectId, required: true },
    day: { type: String, required: true },
    bookingId: { type: Schema.Types.ObjectId, required: true, index: true },
    vehicleId: { type: Schema.Types.ObjectId, required: true },
  },
  { timestamps: true }
);

UnitHoldSchema.index({ unitId: 1, day: 1 }, { unique: true });

const UnitHold: Model<IUnitHold> = mongoose.models.UnitHold || mongoose.model<IUnitHold>("UnitHold", UnitHoldSchema);
export default UnitHold;
