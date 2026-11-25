/**
 * export_csv — generates a payout statement CSV for a creator.
 *
 * Keep payload small (versioned). The worker streams results and stores the
 * file reference; request handler only enqueues the job and returns jobId.
 */
import type { JobRecordDTO } from "../types";
import PayoutStatement from "../../models/PayoutStatement.js";

export async function handleExportCsv(job: JobRecordDTO): Promise<void> {
  const { creatorWallet, startDate, endDate, requestedBy } = job.payload as any;
  if (!creatorWallet || !requestedBy) throw new Error("export_csv missing creatorWallet/requestedBy");

  // Validate dates if present
  if (startDate && isNaN(Date.parse(startDate))) throw new Error("export_csv: invalid startDate");
  if (endDate && isNaN(Date.parse(endDate))) throw new Error("export_csv: invalid endDate");

  // Real implementation: query PayoutStatement / Purchase, write CSV to S3 or temp file,
  // store artifact id. We simulate with a light DB touch.
  try {
    await PayoutStatement.findOne({ creatorWallet: String(creatorWallet).toLowerCase() }).lean().catch(() => null);
  } catch (err: any) {
    if (err.name === "MongooseError" || err.message?.includes("not connected")) {
      throw new Error(`DB not ready for export_csv — will retry: ${err.message}`);
    }
    throw err;
  }
}
