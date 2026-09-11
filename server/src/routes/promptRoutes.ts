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
  GetPromptsByContentHash,
  CheckSimilarity,
} from "../controllers/controllers";
import {
  GetCreatorSalesAnalytics,
  GetCreatorSupportMetrics,
  GetPurchaseTransactions,
  GetCreatorPayoutStatement,
  GetIntegrityReport,
  TriggerIntegrityCheck,
} from "../controllers/purchaseControllers";
import {
  RequestOwnershipTransfer,
  GetOwnershipTransfers,
  RespondOwnershipTransfer,
  CancelOwnershipTransfer,
} from "../controllers/transferControllers";
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

// Content hash lookup for duplicate detection (#333)
promptRouter.get("/hash/:contentHash", GetPromptsByContentHash);

// Semantic similarity check for anti-plagiarism
promptRouter.post("/similarity/check", CheckSimilarity);

// Preview analytics (#257)
promptRouter.post("/preview", RecordPreview);
promptRouter.get("/preview/stats", GetPreviewStats);

// Report endpoints — off-chain moderation data, does not affect access control.
// Submission is public (anyone can flag a listing); reading the queue is a
// moderation action and requires an admin token (#542).
promptRouter.post("/reports", SubmitPromptReport);
promptRouter.get(
  "/reports",
  requireAdminScope("reports:read"),
  GetPromptReports,
);

// Price history — derived from indexed PromptPriceUpdated events
promptRouter.get("/:onChainId/price-history", GetPriceHistory);

// Content integrity rechecks (#460) — admin-only (#542)
promptRouter.get(
  "/admin/integrity-report",
  requireAdminScope("integrity:read"),
  GetIntegrityReport,
);
promptRouter.post("/admin/integrity-check", requireAdminScope("integrity:write"), TriggerIntegrityCheck);

// ── Ownership transfer (#708) — OFF-CHAIN two-phase handoff ───────────────────
// The Soroban contract's Prompt.creator is immutable, so handing a listing to
// a new operator is coordinated here: the current owner requests a transfer
// and the recipient approves or rejects it. Approval re-points the indexed
// Prompt.owner (affects analytics/payout attribution). Both actions require a
// wallet signature. See docs/architecture.md before extending this surface.
promptRouter.post("/transfers/request", RequestOwnershipTransfer);
promptRouter.get("/transfers/:walletAddress", GetOwnershipTransfers);
promptRouter.post("/transfers/:transferId/respond", RespondOwnershipTransfer);
promptRouter.post("/transfers/:transferId/cancel", CancelOwnershipTransfer);

// ── User Preference (non-authoritative, wallet-signature required) ────────────
promptRouter.post("/buyer/save", SavePrompt);
promptRouter.post("/buyer/unsave", UnsavePrompt);
