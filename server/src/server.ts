import express, { type Application, type ErrorRequestHandler } from "express";
import * as Sentry from "@sentry/node";
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
import { notificationRouter } from "./routes/notificationRoutes";
import { auditRouter } from "./routes/auditRoutes";
import { libraryRouter } from "./routes/libraryRoutes";
import { provenanceRouter } from "./routes/provenanceRoutes";
import { walletSessionRouter } from "./routes/walletSessionRoutes";
import { marketplaceRouter } from "./routes/marketplaceRoutes";
import { featureFlagRouter } from "./routes/featureFlagRoutes.js";
import { supportCaseRouter } from "./routes/supportCaseRoutes.js";
import { qualityCheckRouter } from "./routes/qualityCheckRoutes.js";
import { recommendationFeedbackRouter } from "./routes/recommendationFeedbackRoutes.js";
import { operationalHealthRouter } from "./routes/operationalHealthRoutes.js";
import { drRouter } from "./routes/drRoutes.js";
import { exportRouter } from "./routes/exportRoutes";
import { policyLimitRouter } from "./routes/policyLimitRoutes";
import { operationRecoveryRouter } from "./routes/operationRecoveryRoutes";
import { receiptRouter } from "./routes/receiptRoutes";
import { maintenanceBannerRouter } from "./routes/maintenanceBannerRoutes";
import {
  GetOpenApiSchema,
  GetOpenApiExplorer,
} from "./controllers/docsControllers";
import { runBackup, getBackupHealth } from "./services/backupService.js";
import { IndexerState } from "./models/IndexerState";
import { startIndexer } from "./services/indexer";
import { correlationMiddleware } from "./middleware/correlation";
import { errorHandlerMiddleware } from "./middleware/errorHandler";
import { runDataIntegrityCheck } from "./services/dataIntegrityMonitor";
import {
  runUserExport,
  listUserExports,
  cleanupExpiredExports,
  verifyExportChecksum,
  EXPORT_SCOPES,
  EXPORT_RETENTION_MS,
} from "./services/exportService";

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
app.use("/api/notifications", notificationRouter);
app.use("/api/audit", auditRouter); // #783
app.use("/api/wallet-session", walletSessionRouter); // #753, #784
app.use("/api/library", libraryRouter); // #784
app.use("/api/provenance", provenanceRouter); // #753
app.use("/api/marketplace", marketplaceRouter);
app.use("/api/flags", featureFlagRouter);
app.use("/api/support-cases", supportCaseRouter);
app.use("/api/quality-checks", qualityCheckRouter);
app.use("/api/recommendations/feedback", recommendationFeedbackRouter);
app.use("/api/admin/operational-health", operationalHealthRouter);
app.use("/api/maintenance", maintenanceBannerRouter); // Maintenance mode banners
// Export routes for user-owned data (requires authentication)
// Machine-readable API schema + interactive explorer (#713).
app.use("/api/exports", exportRouter)
app.get("/api/openapi.json", GetOpenApiSchema);
app.use("/api/admin/dr", drRouter);
app.use("/api/admin/policy-limits", policyLimitRouter);
app.use("/api/recovery", operationRecoveryRouter);
app.use("/api/receipts", receiptRouter);

// Apply correlation ID middleware to all routes
app.use(correlationMiddleware);

// Apply standardized error handler middleware
app.use(errorHandlerMiddleware);

// Machine-readable API schema + interactive explorer (#713).
app.get("/api/openapi.json", GetOpenApiSchema);
app.get("/api/docs", GetOpenApiExplorer);

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

// Run data integrity check endpoint (admin only)
app.post("/api/admin/integrity-check", async (req, res) => {
  try {
    const report = await runDataIntegrityCheck();
    res.json({ success: true, data: report });
  } catch (err) {
    res.status(500).json({ error: "Failed to run integrity check" });
  }
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
  startIndexer().catch((err) => {
    console.error("Failed to start Soroban Indexer:", err);
  });
});

export default app;
