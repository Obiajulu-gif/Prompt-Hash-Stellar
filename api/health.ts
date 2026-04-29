import { withObservability } from "../src/lib/observability/wrapper";
import { IndexerState } from "../server/src/models/IndexerState";
import connectDb from "../server/src/db/connectDb";

async function handler(req: any, res: any) {
  await connectDb();
  const state = await IndexerState.findOne({ key: "prompt_hash_contract" });

  const status = {
    status: "ok",
    timestamp: new Date().toISOString(),
    uptime: process.uptime(),
    indexer: {
      lastProcessedLedger: state?.lastIndexedLedger || 0,
    },
  };

  res.status(200).json(status);
}

export default withObservability(handler, "health");
