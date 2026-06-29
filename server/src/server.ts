import "dotenv/config";
import * as Sentry from "@sentry/node";
import express from "express";
import { TestPromptProxy } from "./controllers/controllers";
import { proxyrouter } from "./routes/proxyRoutes";
import { promptRouter } from "./routes/promptRoutes";
import { userRouter } from "./routes/userRoutes";
import { chatRouter } from "./routes/chatRoutes";
import { webhookRouter } from "./routes/webhookRoutes";
import { versioningRouter } from "./routes/versioningRoutes";
import { governanceRouter } from "./routes/governanceRoutes"; // Issue #113
import searchRouter from "./routes/searchRoutes";
import { fulfillmentRouter } from "./routes/fulfillmentRoutes";
import { reviewRouter } from "./routes/reviewRoutes";
import { runBackup, getBackupHealth } from "./services/backupService";
import { IndexerState } from "./models/IndexerState";
// import { startIndexer } from "./services/indexerService"; // TODO: Update path when ready

// ── Sentry backend monitoring (#332) ─────────────────────────────────────────
// Set SENTRY_DSN in the server .env to enable exception capture.
if (process.env.SENTRY_DSN) {
  Sentry.init({
    dsn: process.env.SENTRY_DSN,
    environment: process.env.NODE_ENV ?? "development",
    tracesSampleRate: parseFloat(process.env.SENTRY_TRACES_SAMPLE_RATE ?? "0.1"),
  });
}

const app = express();

const port = 5000;

// Sentry error handler should be registered after routes (#332).
app.use(express.json());

app.use("/api/improve-proxy", proxyrouter);

app.use("/api/prompts", promptRouter);

app.use("/api/user", userRouter);

app.use("/api/chat", chatRouter);
app.use("/api/webhooks", webhookRouter);
app.use("/api/versions", versioningRouter);
app.use("/api/governance", governanceRouter); // Issue #113
app.use("/api/search", searchRouter);
app.use("/api/fulfillment", fulfillmentRouter);
app.use("/api/reviews", reviewRouter);

app.post("/api/test-prompt", TestPromptProxy);

app.get("/health", async (req, res) => {
  const [state, backupHealth] = await Promise.all([
    IndexerState.findOne({ key: "prompt_hash_contract" }),
    getBackupHealth(),
  ]);
  res.json({
    status: "ok",
    indexer: {
      lastProcessedLedger: state?.lastIndexedLedger || 0,
      timestamp: new Date(),
    },
    backup: backupHealth,
  });
});

// Sentry error handler must be registered after all routes (#332).
// expressErrorHandler is available in @sentry/node v7; v8+ uses setupExpressErrorHandler.
if (process.env.SENTRY_DSN) {
  if (typeof (Sentry as Record<string, unknown>).setupExpressErrorHandler === "function") {
    (Sentry as unknown as { setupExpressErrorHandler: (_app: typeof app) => void }).setupExpressErrorHandler(app);
  } else if (typeof (Sentry as Record<string, unknown>).expressErrorHandler === "function") {
    app.use((Sentry as unknown as { expressErrorHandler: () => import("express").ErrorRequestHandler }).expressErrorHandler());
  }
}

app.listen(port, () => {
  console.log(`Listening on port ${port}`);

  // STARTS THE INDEXER HERE
  // startIndexer().catch((err: any) => {
  //   console.error("Failed to start Soroban Indexer:", err);
  // });

  // DAILY AUTOMATED BACKUP — runs immediately on startup then every 24 h.
  // Use BACKUP_S3_BUCKET env var to enable; silently skips if not configured.
  if (process.env.BACKUP_S3_BUCKET) {
    const TWENTY_FOUR_HOURS = 24 * 60 * 60 * 1000;
    const triggerBackup = () => {
      runBackup().catch((err) => {
        console.error("[backup] Scheduled backup failed:", err?.message ?? err);
      });
    };
    // Run once on startup, then on a 24-hour interval.
    triggerBackup();
    setInterval(triggerBackup, TWENTY_FOUR_HOURS);
    console.log("[backup] Daily backup scheduler started.");
  }
});
