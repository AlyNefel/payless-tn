import mongoose, { Schema, Document, Model } from "mongoose";

/**
 * Private back-office document (insurance contract PDF, scan…). Stored in the database and served
 * only through an authenticated route — never on a public URL.
 */
export interface IStoredFile extends Document {
  _id: mongoose.Types.ObjectId;
  filename: string;
  contentType: string;
  size: number;
  data: Buffer;
  purpose: string;
  uploadedBy?: string;
  createdAt: Date;
}

const StoredFileSchema = new Schema<IStoredFile>(
  {
    filename: { type: String, required: true, trim: true, maxlength: 200 },
    contentType: { type: String, required: true },
    size: { type: Number, required: true },
    data: { type: Buffer, required: true, select: false },
    purpose: { type: String, default: "insurance", index: true },
    uploadedBy: { type: String },
  },
  { timestamps: true }
);

const StoredFile: Model<IStoredFile> = mongoose.models.StoredFile || mongoose.model<IStoredFile>("StoredFile", StoredFileSchema);
export default StoredFile;
