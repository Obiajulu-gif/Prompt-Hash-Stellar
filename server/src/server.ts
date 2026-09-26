import express from "express";
import Sentry from "@sentry/node";
import { proxyrouter } from "./routes/proxyRoutes";
import { promptRouter } from "./routes/promptRoutes";
import { userRouter } from "./routes/userRoutes";
import { chatRouter } from "./routes/chatRoutes";
import { webhookRouter } from "./routes/webhookRoutes";
import { versioningRouter } from "./routes/versioningRoutes";
import { marketplaceRouter } from "./routes/marketplaceRoutes";
import { featureFlagRouter } from "./routes/featureFlagRoutes.js";
import { supportCaseRouter } from "./routes/supportCaseRoutes.js";
import { qualityCheckRouter } from "./routes/qualityCheckRoutes.js";
import { recommendationFeedbackRouter } from "./routes/recommendationFeedbackRoutes.js";
import { bundleRouter } from "./routes/bundleRoutes";
import { payoutLedgerRouter } from "./routes/payoutLedgerRoutes";
import { entitlementRouter } from "./routes/entitlementRoutes";
import { adminRateLimitRouter } from "./routes/adminRateLimitRoutes";
import { correlationMiddleware } from "./middleware/correlation";
import { publishLimiter, purchaseLimiter, reviewLimiter, reportLimiter } from "./middleware/rateLimiter";
import { IndexerState } from "./models/IndexerState";
import { startIndexer } from "./services/indexer";
import { getBackupHealth } from "./services/backupService";

const app = express();

const port = 5000;

// Sentry error handler should be registered after routes (#332).
app.use(express.json());
app.use(correlationMiddleware);

app.use("/api/improve-proxy", proxyrouter);
app.use("/api/prompts", publishLimiter, promptRouter);
app.use("/api/user", userRouter);
app.use("/api/chat", chatRouter);
app.use("/api/webhooks", webhookRouter);
app.use("/api/versions", versioningRouter);
app.use("/api/marketplace", marketplaceRouter);
app.use("/api/flags", featureFlagRouter);
app.use("/api/support-cases", supportCaseRouter);
app.use("/api/quality-checks", qualityCheckRouter);
app.use("/api/recommendations/feedback", recommendationFeedbackRouter);
app.use("/api/bundles", bundleRouter);
app.use("/api/payouts", payoutLedgerRouter);
app.use("/api/entitlements", entitlementRouter);
app.use("/api/admin/rate-limits", adminRateLimitRouter);

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
        setupExpressErrorHandler: (app: typeof app) => void;
      }
    ).setupExpressErrorHandler(app);
  } else if (
    typeof (Sentry as Record<string, unknown>).expressErrorHandler ===
    "function"
  ) {
    app.use(
      (
        Sentry as unknown as {
          expressErrorHandler: () => import("express").ErrorRequestHandler;
        }
      ).expressErrorHandler(),
    );
  }
}

startIndexer().catch((err) => {
  console.error("Failed to start Soroban Indexer:", err);
});
