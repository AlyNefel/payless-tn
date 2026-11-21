import mongoose, { Schema, Document, Model } from "mongoose";

export type BookingStatus =
  | "pending"
  | "confirmed"
  | "awaiting_payment"
  | "paid"
  | "active"
  | "completed"
  | "cancelled"
  | "rejected";

export type PaymentStatus = "unpaid" | "partial" | "paid" | "refunded" | "failed";

export interface IPricingBreakdown {
  dailyRate: number;
  rentalDays: number;
  subtotal: number;
  extrasTotal: number;
  discountAmount: number;
  taxAmount: number;
  taxRate: number;
  timbreFiscal?: number;
  contributionLF2026?: number;
  outOfTownFee?: number;
  pickupLocationFee?: number;
  returnLocationFee?: number;
  differentLocationFee?: number;
  depositAmount: number;
  totalAmount: number;
  currency: string;
}

export interface IBookingExtra {
  extraId: mongoose.Types.ObjectId;
  name: string;
  price: number;
  quantity: number;
  /** Snapshot of the option's icon at booking time (Lucide name, emoji or image URL). */
  icon?: string;
  pricingType?: "per_day" | "per_rental" | "per_unit";
  /** Amount invoiced for this line, in minor units. */
  lineTotal?: number;
}

export interface IBookingVehicleItem {
  vehicleId: mongoose.Types.ObjectId;
  brand?: string;
  model?: string;
  dailyRate: number;
  subtotal: number;
  depositAmount?: number;
  extras?: IBookingExtra[];
}

export interface IBookingAudit {
  action: string;
  performedBy: mongoose.Types.ObjectId | string;
  performedByRole: string;
  previousValue?: unknown;
  newValue?: unknown;
  timestamp: Date;
  notes?: string;
}

export interface IModificationRequest {
  status: "pending" | "approved" | "rejected";
  requestedAt: Date;
  processedAt?: Date;
  processedBy?: string;
  pickupDate?: Date;
  returnDate?: Date;
  pickupTime?: string;
  returnTime?: string;
  pickupLocationId?: mongoose.Types.ObjectId;
  returnLocationId?: mongoose.Types.ObjectId;
  customerNotes?: string;
  reason?: string;
  decisionNotes?: string;
}

/** Physical car (license plate) assigned to a booked car model. */
export interface IAssignedUnit {
  vehicleId: mongoose.Types.ObjectId;
  unitId?: mongoose.Types.ObjectId;
  licensePlate: string;
  auto: boolean;
  assignedAt: Date;
  assignedBy?: string;
  /**
   * Segment of the rental this car covers. Empty = whole rental. After a car change the
   * replaced car keeps [pickup, to) and the new one covers [from, return).
   */
  from?: Date;
  to?: Date;
}

/** One car change during a rental (breakdown, upgrade, customer request…). */
export interface IVehicleChange {
  at: Date;
  by: string;
  lineIndex: number;
  effectiveDate: Date;
  fromVehicleId: mongoose.Types.ObjectId;
  fromModel: string;
  fromUnitId?: mongoose.Types.ObjectId;
  fromLabel?: string;
  toVehicleId: mongoose.Types.ObjectId;
  toModel: string;
  toUnitId?: mongoose.Types.ObjectId;
  toLabel?: string;
  priceMode: "recalculate" | "keep";
  oldDailyRate: number;
  newDailyRate: number;
  daysChanged: number;
  /** Change of the rental total (minor units, negative = cheaper for the customer). */
  amount: number;
  oldCarMileage?: number;
  newCarMileage?: number;
  reason: string;
  customerNotified?: boolean;
}

export interface IDriverIdentity {
  fullName?: string;
  birthDate?: string;
  birthPlace?: string;
  nationality?: string;
  address?: string;
  phone?: string;
  /** CIN or passport */
  idType?: "cin" | "passport";
  idNumber?: string;
  idIssuedAt?: string;
  licenceNumber?: string;
  licenceIssuedAt?: string;
  licenceIssuedIn?: string;
}

export interface IRentalContract {
  number: string;
  issuedAt: Date;
  issuedBy?: string;
  driver?: IDriverIdentity;
  secondDriver?: IDriverIdentity;
  notes?: string;
}

/** Invoice recipient, overriding the customer record (company name, tax ID…). */
export interface IBillingInfo {
  name?: string;
  address?: string;
  idNumber?: string;
  /** Matricule fiscal of a business customer. */
  taxId?: string;
  /** Free text printed on the invoice. */
  notes?: string;
}

export interface IInspectionDamage {
  zone: string;
  description: string;
  photoUrl?: string;
}

export interface IInspection {
  at: Date;
  by: string;
  mileage?: number;
  /** Fuel gauge in eighths: 0 (empty) … 8 (full). */
  fuelLevel?: number;
  cleanliness?: "clean" | "acceptable" | "dirty";
  damages: IInspectionDamage[];
  photos: string[];
  /** Equipment present: spare wheel, jack, triangle, vest, documents… */
  checklist?: Record<string, boolean>;
  signatureUrl?: string;
  customerName?: string;
  notes?: string;
}

export interface IBooking extends Document {
  _id: mongoose.Types.ObjectId;
  bookingReference: string;
  customerId: mongoose.Types.ObjectId;
  vehicleId: mongoose.Types.ObjectId;
  vehicles?: IBookingVehicleItem[];
  pickupLocationId: mongoose.Types.ObjectId;
  returnLocationId: mongoose.Types.ObjectId;
  pickupDate: Date;
  returnDate: Date;
  pickupTime?: string;
  returnTime?: string;
  rentalDuration: number; // days
  pricingBreakdown: IPricingBreakdown;
  extras: IBookingExtra[];
  couponCode?: string;
  promotionId?: mongoose.Types.ObjectId;
  bookingStatus: BookingStatus;
  paymentStatus: PaymentStatus;
  paymentMethod?: "cash" | "bank_transfer" | "credit_card" | string;
  customerLanguage: "fr" | "en" | "ar";
  internalNotes: string;
  customerNotes?: string;
  auditHistory: IBookingAudit[];
  modificationRequest?: IModificationRequest;
  assignedUnits?: IAssignedUnit[];
  pickupRecordedAt?: Date;
  returnRecordedAt?: Date;
  pickupMileage?: number;
  returnMileage?: number;
  /** Who recorded the return, and their comments. */
  returnRecordedBy?: string;
  returnNotes?: string;
  /** Ledger totals (minor units), recomputed from the payments collection after every movement. */
  amountPaid?: number;
  depositHeld?: number;
  /** Rental contract (numbered once, identity details of the drivers). */
  contract?: IRentalContract;
  invoiceNumber?: string;
  invoiceIssuedAt?: Date;
  billing?: IBillingInfo;
  /** Vehicle condition reports at departure and return. */
  pickupInspection?: IInspection;
  returnInspection?: IInspection;
  remindersSent?: string[];
  vehicleChanges?: IVehicleChange[];
  extensions?: { previousReturnDate: Date; newReturnDate: Date; extraDays: number; dailyRate: number; amount: number; at: Date; by?: string }[];
  cancellationReason?: string;
  rejectionReason?: string;
  isManualBooking: boolean;
  createdBy?: mongoose.Types.ObjectId;
  createdAt: Date;
  updatedAt: Date;
}

const BookingSchema = new Schema<IBooking>(
  {
    bookingReference: {
      type: String,
      required: true,
      unique: true,
      uppercase: true,
      index: true,
    },
    customerId: {
      type: Schema.Types.ObjectId,
      ref: "Customer",
      required: true,
      index: true,
    },
    vehicleId: {
      type: Schema.Types.ObjectId,
      ref: "Vehicle",
      required: true,
      index: true,
    },
    vehicles: [
      {
        vehicleId: { type: Schema.Types.ObjectId, ref: "Vehicle" },
        brand: String,
        model: String,
        dailyRate: Number,
        subtotal: Number,
        depositAmount: Number,
        extras: [
          {
            extraId: { type: Schema.Types.ObjectId, ref: "Extra" },
            name: String,
            price: Number,
            quantity: { type: Number, default: 1 },
            icon: String,
            pricingType: { type: String, enum: ["per_day", "per_rental", "per_unit"] },
            lineTotal: Number,
          },
        ],
      },
    ],
    pickupLocationId: {
      type: Schema.Types.ObjectId,
      ref: "Location",
      required: true,
    },
    returnLocationId: {
      type: Schema.Types.ObjectId,
      ref: "Location",
      required: true,
    },
    pickupDate: { type: Date, required: true, index: true },
    returnDate: { type: Date, required: true, index: true },
    pickupTime: { type: String, match: /^([01]\d|2[0-3]):[0-5]\d$/ },
    returnTime: { type: String, match: /^([01]\d|2[0-3]):[0-5]\d$/ },
    rentalDuration: { type: Number, required: true },
    pricingBreakdown: {
      dailyRate: { type: Number, required: true },
      rentalDays: { type: Number, required: true },
      subtotal: { type: Number, required: true },
      extrasTotal: { type: Number, default: 0 },
      discountAmount: { type: Number, default: 0 },
      taxAmount: { type: Number, default: 0 },
      taxRate: { type: Number, default: 0 },
      timbreFiscal: { type: Number, default: 100 },
      contributionLF2026: { type: Number, default: 0 },
      outOfTownFee: { type: Number, default: 0 },
      pickupLocationFee: { type: Number, default: 0 },
      returnLocationFee: { type: Number, default: 0 },
      differentLocationFee: { type: Number, default: 0 },
      depositAmount: { type: Number, default: 0 },
      totalAmount: { type: Number, required: true },
      currency: { type: String, default: "TND" },
    },
    extras: [
      {
        extraId: { type: Schema.Types.ObjectId, ref: "Extra" },
        name: String,
        price: Number,
        quantity: { type: Number, default: 1 },
        icon: String,
        pricingType: { type: String, enum: ["per_day", "per_rental", "per_unit"] },
        lineTotal: Number,
      },
    ],
    couponCode: String,
    promotionId: { type: Schema.Types.ObjectId, ref: "Promotion" },
    bookingStatus: {
      type: String,
      enum: ["pending", "confirmed", "awaiting_payment", "paid", "active", "completed", "cancelled", "rejected"],
      default: "pending",
      index: true,
    },
    paymentStatus: {
      type: String,
      enum: ["unpaid", "partial", "paid", "refunded", "failed"],
      default: "unpaid",
    },
    paymentMethod: {
      type: String,
      default: "cash",
    },
    customerLanguage: {
      type: String,
      enum: ["fr", "en", "ar"],
      default: "fr",
    },
    internalNotes: { type: String, default: "" },
    customerNotes: String,
    auditHistory: [
      {
        action: { type: String, required: true },
        performedBy: Schema.Types.Mixed,
        performedByRole: String,
        previousValue: Schema.Types.Mixed,
        newValue: Schema.Types.Mixed,
        timestamp: { type: Date, default: Date.now },
        notes: String,
      },
    ],
    modificationRequest: {
      status: {
        type: String,
        enum: ["pending", "approved", "rejected"],
      },
      requestedAt: { type: Date, default: Date.now },
      processedAt: Date,
      processedBy: String,
      pickupDate: Date,
      returnDate: Date,
      pickupTime: String,
      returnTime: String,
      pickupLocationId: { type: Schema.Types.ObjectId, ref: "Location" },
      returnLocationId: { type: Schema.Types.ObjectId, ref: "Location" },
      customerNotes: String,
      reason: String,
      decisionNotes: String,
    },
    assignedUnits: [
      {
        vehicleId: { type: Schema.Types.ObjectId, ref: "Vehicle" },
        unitId: { type: Schema.Types.ObjectId },
        licensePlate: { type: String, default: "" },
        auto: { type: Boolean, default: true },
        assignedAt: { type: Date, default: Date.now },
        assignedBy: String,
        from: Date,
        to: Date,
      },
    ],
    vehicleChanges: [
      {
        at: Date,
        by: String,
        lineIndex: Number,
        effectiveDate: Date,
        fromVehicleId: { type: Schema.Types.ObjectId, ref: "Vehicle" },
        fromModel: String,
        fromUnitId: Schema.Types.ObjectId,
        fromLabel: String,
        toVehicleId: { type: Schema.Types.ObjectId, ref: "Vehicle" },
        toModel: String,
        toUnitId: Schema.Types.ObjectId,
        toLabel: String,
        priceMode: { type: String, enum: ["recalculate", "keep"] },
        oldDailyRate: Number,
        newDailyRate: Number,
        daysChanged: Number,
        amount: Number,
        oldCarMileage: Number,
        newCarMileage: Number,
        reason: String,
        customerNotified: Boolean,
      },
    ],
    pickupRecordedAt: Date,
    returnRecordedAt: Date,
    pickupMileage: Number,
    returnMileage: Number,
    returnRecordedBy: String,
    returnNotes: String,
    amountPaid: { type: Number, default: 0 },
    depositHeld: { type: Number, default: 0 },
    contract: {
      number: String,
      issuedAt: Date,
      issuedBy: String,
      driver: {
        fullName: String, birthDate: String, birthPlace: String, nationality: String, address: String, phone: String,
        idType: { type: String, enum: ["cin", "passport"] }, idNumber: String, idIssuedAt: String,
        licenceNumber: String, licenceIssuedAt: String, licenceIssuedIn: String,
      },
      secondDriver: {
        fullName: String, birthDate: String, birthPlace: String, nationality: String, address: String, phone: String,
        idType: { type: String, enum: ["cin", "passport"] }, idNumber: String, idIssuedAt: String,
        licenceNumber: String, licenceIssuedAt: String, licenceIssuedIn: String,
      },
      notes: String,
    },
    invoiceNumber: String,
    invoiceIssuedAt: Date,
    billing: { name: String, address: String, idNumber: String, taxId: String, notes: String },
    pickupInspection: {
      at: Date, by: String, mileage: Number, fuelLevel: { type: Number, min: 0, max: 8 },
      cleanliness: { type: String, enum: ["clean", "acceptable", "dirty"] },
      damages: [{ zone: String, description: String, photoUrl: String }],
      photos: [String], checklist: Schema.Types.Mixed, signatureUrl: String, customerName: String, notes: String,
    },
    returnInspection: {
      at: Date, by: String, mileage: Number, fuelLevel: { type: Number, min: 0, max: 8 },
      cleanliness: { type: String, enum: ["clean", "acceptable", "dirty"] },
      damages: [{ zone: String, description: String, photoUrl: String }],
      photos: [String], checklist: Schema.Types.Mixed, signatureUrl: String, customerName: String, notes: String,
    },
    remindersSent: [String],
    extensions: [
      {
        previousReturnDate: Date,
        newReturnDate: Date,
        extraDays: Number,
        dailyRate: Number,
        amount: Number,
        at: { type: Date, default: Date.now },
        by: String,
      },
    ],
    cancellationReason: String,
    rejectionReason: String,
    isManualBooking: { type: Boolean, default: false },
    createdBy: { type: Schema.Types.ObjectId, ref: "User" },
  },
  { timestamps: true }
);

BookingSchema.index({ pickupDate: 1, returnDate: 1, vehicleId: 1 });
BookingSchema.index({ customerId: 1, createdAt: -1 });
BookingSchema.index({ bookingStatus: 1, pickupDate: 1 });

const Booking: Model<IBooking> =
  mongoose.models.Booking || mongoose.model<IBooking>("Booking", BookingSchema);

export default Booking;
