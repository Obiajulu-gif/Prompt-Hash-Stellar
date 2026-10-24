import { transferRouter } from "./routes/transferRoutes";
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
import { staleCacheRouter } from "./routes/staleCacheRoutes.js";
import { trendAnalyticsRouter } from "./routes/trendAnalyticsRoutes.js";
import { dependencyHealthRouter } from "./routes/dependencyHealthRoutes.js";
import { drRouter } from "./routes/drRoutes.js";
import { exportRouter } from "./routes/exportRoutes";
import { policyLimitRouter } from "./routes/policyLimitRoutes";
import { operationRecoveryRouter } from "./routes/operationRecoveryRoutes";
import { receiptRouter } from "./routes/receiptRoutes";
import { maintenanceBannerRouter } from "./routes/maintenanceBannerRoutes";
import { externalIdentityRouter } from "./routes/externalIdentityRoutes";
import { externalEvidenceRouter } from "./routes/externalEvidenceRoutes"; // #1011
import { abuseRiskRouter } from "./routes/abuseRiskRoutes";
import { retentionHoldRouter } from "./routes/retentionHoldRoutes";
import { lifecycleCaptureRouter, lifecycleReportRouter } from "./routes/lifecycleAnalyticsRoutes";
import { adminRateLimitRouter } from "./routes/adminRateLimitRoutes";
import { supportAccessRouter } from "./routes/supportAccessRoutes";
import { maintainerAccessRouter } from "./routes/maintainerAccessRoutes"; // #912
import { recordMergeRouter } from "./routes/recordMergeRoutes"; // #902
import { maintainerNoteRouter } from "./routes/maintainerNoteRoutes"; // #903
import { failureEscalationRouter } from "./routes/failureEscalationRoutes"; // #904
import { payoutLedgerRouter } from "./routes/payoutLedgerRoutes";
import { entitlementRouter } from "./routes/entitlementRoutes";
import { bundleRouter } from "./routes/bundleRoutes";
import { healthRouter } from "./routes/healthRoutes";
import { jobRouter } from "./routes/jobRoutes";
import { allowListRouter } from "./routes/allowListRoutes";
import { projectionReplayRouter } from "./routes/projectionReplayRoutes";
import { ownershipDisputeAdminRouter } from "./routes/ownershipDisputeRoutes";
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

app.use("/api/health", healthRouter); // #1027 dependency-aware public health
app.use("/api/jobs", jobRouter); // #1009 queue observability + backpressure
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
app.use("/api/external-identities", externalIdentityRouter); // #921
app.use("/api/external-evidence", externalEvidenceRouter); // #1011
app.use("/api/library", libraryRouter); // #784
app.use("/api/provenance", provenanceRouter); // #753
app.use("/api/marketplace", marketplaceRouter);
app.use("/api/flags", featureFlagRouter);
app.use("/api/support-cases", supportCaseRouter);
app.use("/api/quality-checks", qualityCheckRouter);
app.use("/api/recommendations/feedback", recommendationFeedbackRouter);
app.use("/api/admin/operational-health", operationalHealthRouter);
app.use("/api/stale-cache", staleCacheRouter);
app.use("/api/admin/trend-analytics", trendAnalyticsRouter);
app.use("/api/admin/dependency-health", dependencyHealthRouter);
app.use("/api/maintenance", maintenanceBannerRouter); // Maintenance mode banners
// Export routes for user-owned data (requires authentication)
// Machine-readable API schema + interactive explorer (#713).
app.use("/api/transfers", transferRouter);
app.use("/api/exports", exportRouter)
app.get("/api/openapi.json", GetOpenApiSchema);
app.use("/api/admin/dr", drRouter);
app.use("/api/admin/policy-limits", policyLimitRouter);
app.use("/api/admin/allow-list", allowListRouter); // #1025
app.use("/api/admin/projections", projectionReplayRouter); // #1024
app.use("/api/admin/ownership-disputes", ownershipDisputeAdminRouter); // #907
app.use("/api/recovery", operationRecoveryRouter);
app.use("/api/receipts", receiptRouter);
app.use("/api/admin/abuse-risk", abuseRiskRouter);
app.use("/api/admin/retention-holds", retentionHoldRouter);
app.use("/api/admin/maintainer-grants", maintainerAccessRouter); // #912
app.use("/api/admin/record-merges", recordMergeRouter); // #902
app.use("/api/admin/maintainer-notes", maintainerNoteRouter); // #903
app.use("/api/admin/escalations", failureEscalationRouter); // #904
app.use("/api/analytics/lifecycle", lifecycleCaptureRouter);
app.use("/api/admin/lifecycle-analytics", lifecycleReportRouter);

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

import { validateStartupConfig } from "./config/startupValidation";

// Validate startup configuration and secrets (Issue #1095)
try {
  validateStartupConfig(process.env, {
    throwOnError: process.env.NODE_ENV === "production" || process.env.FAIL_ON_CONFIG_ERROR === "true",
  });
} catch (err) {
  console.error("Startup validation error:", err instanceof Error ? err.message : String(err));
  if (process.env.NODE_ENV === "production" || process.env.FAIL_ON_CONFIG_ERROR === "true") {
    process.exit(1);
  }
}

app.listen(port, () => {
  startIndexer().catch((err) => {
    console.error("Failed to start Soroban Indexer:", err);
  });
});

export default app;
