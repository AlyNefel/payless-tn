import mongoose from "mongoose";
import connectDB from "./db";
import AuditLog from "@/models/AuditLog";

interface SessionLike {
  user?: { id?: string | null; email?: string | null } | null;
}

/**
 * Writes one line in the audit journal (who did what, on which record). Never throws: the
 * journal must not break the action it describes.
 */
export async function logAudit(
  session: SessionLike | null | undefined,
  action: string,
  resource: string,
  resourceId?: string,
  details?: { before?: unknown; after?: unknown }
): Promise<void> {
  try {
    await connectDB();
    const id = session?.user?.id;
    await AuditLog.create({
      userId: id && mongoose.Types.ObjectId.isValid(id) ? id : new mongoose.Types.ObjectId("000000000000000000000000"),
      userEmail: session?.user?.email || "système",
      action,
      resource,
      resourceId,
      previousValue: details?.before,
      newValue: details?.after,
    });
  } catch (err) {
    console.error("logAudit failed:", err);
  }
}
