import express from "express";
import { ImproveProxy } from "./controllers/controllers";
import { proxyrouter } from "./routes/proxyRoutes";
import { promptRouter } from "./routes/promptRoutes";
import { userRouter } from "./routes/userRoutes";
import { chatRouter } from "./routes/chatRoutes";
import { webhookRouter } from "./routes/webhookRoutes";
import { versioningRouter } from "./routes/versioningRoutes";
import { governanceRouter } from "./routes/governanceRoutes"; // Issue #113

const app = express();

const port = 5000;

app.use(express.json());

app.use("/api/improve-proxy", proxyrouter);

app.use("/api/prompts", promptRouter);

app.use("/api/user", userRouter);

app.use("/api/chat", chatRouter);
app.use("/api/webhooks", webhookRouter);
app.use("/api/versions", versioningRouter);
app.use("/api/governance", governanceRouter); // Issue #113

app.get("/health", async (req, res) => {
  const state = await IndexerState.findOne({ key: "prompt_hash_contract" });
  res.json({
    status: "ok",
    indexer: {
      lastProcessedLedger: state?.lastIndexedLedger || 0,
      timestamp: new Date(),
    },
  });
});

app.listen(port, () => {
  console.log(`Listening on port ${port}`);

  // STARTS THE INDEXER HERE
  startIndexer().catch((err) => {
    console.error("Failed to start Soroban Indexer:", err);
  });
});
