import express from "express";
import {
  GetPrompts,
  GetOwnedPrompts,
  GetSavedPrompts,
  GetDraftPrompts,
  SubmitPromptReport,
  GetPromptReports,
  RecordPreview,
  GetPreviewStats,
  SavePrompt,
  UnsavePrompt,
  GetPriceHistory,
} from "../controllers/controllers";
import {
  GetCreatorSalesAnalytics,
  GetPurchaseTransactions,
  GetCreatorPayoutStatement,
  GetIntegrityReport,
  TriggerIntegrityCheck,
} from "../controllers/purchaseControllers";
import { requireAdminScope } from "../middleware/adminAuth";

export const promptRouter = express.Router();

/**
 * OFF-CHAIN INDEXING ONLY — READ-PROJECTION BOUNDARY
 *
 * The Soroban smart contract at contracts/prompt-hash is the single source of
 * truth for prompt ownership, listing state, and purchase records. This server
 * is strictly a read-through cache, event indexer, and user-preference store.
 * It must never originate authoritative state changes that should be governed
 * by the on-chain contract.
 *
 * ROUTE CATEGORIES:
 *   Projection Read   — GET endpoints that mirror indexed on-chain state.
 *   User Preference   — POST save/unsave (non-authoritative, wallet-signed).
 *   Analytics         — Aggregated read data derived from indexed events.
 *   Authoritative     — PROHIBITED. All state mutations go through the contract.
 *
 * PROHIBITED ROUTES (removed — do not restore without on-chain verification):
 *   POST /              → CreatePrompt  (duplicates contract create_prompt)
 *   POST /:id/publish   → PublishPrompt (duplicates set_prompt_sale_status)
 *   POST /:id/archive   → ArchivePrompt (duplicates set_prompt_sale_status)
 */

// ── Projection Read ──────────────────────────────────────────────────────────
promptRouter.route("/").get(GetPrompts);

promptRouter.get("/buyer/:walletAddress/owned", GetOwnedPrompts);
promptRouter.get("/buyer/:walletAddress/saved", GetSavedPrompts);
promptRouter.get("/buyer/:walletAddress/transactions", GetPurchaseTransactions);
promptRouter.get("/creator/:walletAddress/analytics", GetCreatorSalesAnalytics);
promptRouter.get("/creator/:walletAddress/payout-statement", GetCreatorPayoutStatement);
promptRouter.get("/creator/:walletAddress/drafts", GetDraftPrompts);

// Preview analytics (#257)
promptRouter.post("/preview", RecordPreview);
promptRouter.get("/preview/stats", GetPreviewStats);

// Report endpoints — off-chain moderation data, does not affect access control.
// Submission is public (anyone can flag a listing); reading the queue is a
// moderation action and requires an admin token (#542).
promptRouter.post("/reports", SubmitPromptReport);
promptRouter.get("/reports", requireAdminScope("reports:read"), GetPromptReports);

// Price history — derived from indexed PromptPriceUpdated events
promptRouter.get("/:onChainId/price-history", GetPriceHistory);

// Content integrity rechecks (#460) — admin-only (#542)
promptRouter.get(
  "/admin/integrity-report",
  requireAdminScope("integrity:read"),
  GetIntegrityReport,
);
promptRouter.post(
  "/admin/integrity-check",
  requireAdminScope("integrity:write"),
  TriggerIntegrityCheck,
);

// ── User Preference (non-authoritative, wallet-signature required) ────────────
promptRouter.post("/buyer/save", SavePrompt);
promptRouter.post("/buyer/unsave", UnsavePrompt);
