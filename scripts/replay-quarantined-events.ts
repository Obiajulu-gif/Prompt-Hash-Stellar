#!/usr/bin/env ts-node
import mongoose from "mongoose";
import { replayQuarantinedEvents } from "../server/src/services/indexer";

async function main() {
  const mongoUri = process.env.MONGODB_URI || "mongodb://localhost:27017/prompt-hash";
  await mongoose.connect(mongoUri);

  console.log("Starting replay of quarantined events...");
  const result = await replayQuarantinedEvents({ maxEvents: 500 });
  console.log("Replay summary:", result);

  await mongoose.disconnect();
}

main().catch((err) => {
  console.error("Replay error:", err);
  process.exit(1);
});
