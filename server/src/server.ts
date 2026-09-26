import express, { type Application, type ErrorRequestHandler } from "express";
import * as Sentry from "@sentry/node";
import { proxyrouter } from "./routes/proxyRoutes";
import { promptRouter } from "./routes/promptRoutes";
import { userRouter } from "./routes/userRoutes";
import { chatRouter } from "./routes/chatRoutes";
import { webhookRouter } from "./routes/webhookRoutes";
import { versioningRouter } from "./routes/versioningRoutes";
import { marketplaceRouter } from "./routes/marketplaceRoutes";
import { IndexerState } from "./models/IndexerState";
import { startIndexer } from "./services/indexer";
import { correlationMiddleware } from "./middleware/correlation";
import { getBackupHealth } from "./services/backupService";

const app = express();

const port = 5000;

// Sentry error handler should be registered after routes (#332).
app.use(express.json());
app.use(correlationMiddleware);

app.use("/api/improve-proxy", proxyrouter);
app.use("/api/prompts", promptRouter);
app.use("/api/user", userRouter);
app.use("/api/chat", chatRouter);
app.use("/api/webhooks", webhookRouter);
app.use("/api/versions", versioningRouter);
app.use("/api/marketplace", marketplaceRouter);

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
  if (
    typeof (Sentry as Record<string, unknown>).setupExpressErrorHandler ===
    "function"
  ) {
    (
      Sentry as unknown as {
        setupExpressErrorHandler: (app: Application) => void;
      }
    ).setupExpressErrorHandler(app);
  } else if (
    typeof (Sentry as Record<string, unknown>).expressErrorHandler ===
    "function"
  ) {
    app.use(
      (
        Sentry as unknown as {
          expressErrorHandler: () => ErrorRequestHandler;
        }
      ).expressErrorHandler(),
    );
  }
}

app.listen(port, () => {
  startIndexer().catch((err) => {
    console.error("Failed to start Soroban Indexer:", err);
  });
});
