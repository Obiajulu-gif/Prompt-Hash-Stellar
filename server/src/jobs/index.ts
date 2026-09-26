/**
 * Worker entry point — run with `yarn worker` or `node build/jobs/index.js`
 *
 * Starts the background job worker that processes marketplace and retention jobs
 * with retry/backoff/DLQ.
 */
import "dotenv/config";
import connectDb from "../db/connectDb";
import { startWorker } from "./worker";

async function main() {
  await connectDb();
  const worker = startWorker({ pollIntervalMs: parseInt(process.env.WORKER_POLL_INTERVAL_MS ?? "2000", 10) });

  const shutdown = () => {
    worker.stop();
    process.exit(0);
  };
  process.on("SIGINT", shutdown);
  process.on("SIGTERM", shutdown);
}

if (typeof require !== "undefined" && require.main === module) {
  main().catch((err) => {
    console.error("[worker] fatal:", err);
    process.exit(1);
  });
}

export { startWorker };
export * from "./jobQueue";
