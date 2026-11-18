import mongoose, { Schema, Document, Model } from "mongoose";

/**
 * Private back-office document (insurance PDF, receipt, inspection photo, signature). The bytes live
 * on Cloudinary as an authenticated asset (`publicId`) or, for older files and as a fallback, in
 * `data`. Always served through an authenticated route — never on a public URL. See lib/privateFiles.
 */
export interface IStoredFile extends Document {
  _id: mongoose.Types.ObjectId;
  filename: string;
  contentType: string;
  size: number;
  data?: Buffer;
  storage?: "db" | "cloudinary";
  publicId?: string;
  resourceType?: string;
  format?: string;
  purpose: string;
  uploadedBy?: string;
  createdAt: Date;
}

const StoredFileSchema = new Schema<IStoredFile>(
  {
    filename: { type: String, required: true, trim: true, maxlength: 200 },
    contentType: { type: String, required: true },
    size: { type: Number, required: true },
    data: { type: Buffer, select: false },
    storage: { type: String, enum: ["db", "cloudinary"], default: "db" },
    publicId: { type: String },
    resourceType: { type: String },
    format: { type: String },
    purpose: { type: String, default: "insurance", index: true },
    uploadedBy: { type: String },
  },
  { timestamps: true }
);

const StoredFile: Model<IStoredFile> = mongoose.models.StoredFile || mongoose.model<IStoredFile>("StoredFile", StoredFileSchema);
export default StoredFile;
