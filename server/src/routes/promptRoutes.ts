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
} from "../controllers/controllers";

export const promptRouter = express.Router();

/**
 * OFF-CHAIN INDEXING ONLY
 *
 * The Soroban smart contract at contracts/prompt-hash is the single source of
 * truth for prompt ownership, listing state, and purchase records. This server
 * is strictly a read-through cache and event indexer — it must never originate
 * state changes that should be governed by the on-chain contract.
 *
 * Write operations (create, publish, archive, save) are DEPRECATED. The Stellar
 * contract's create_prompt, set_prompt_sale_status, set_prompt_max_supply, and
 * buy_prompt methods control all prompt lifecycle transitions.
 *
 * DEPRECATED ROUTES (removed — do not restore without on-chain verification):
 *   POST /              → CreatePrompt  (duplicates create_prompt)
 *   POST /buyer/save    → SavePrompt    (client-side preference, not authoritative)
 *   POST /buyer/unsave  → UnsavePrompt  (client-side preference)
 *   POST /:id/publish   → PublishPrompt (duplicates set_prompt_sale_status)
 *   POST /:id/archive   → ArchivePrompt (duplicates set_prompt_sale_status)
 */

promptRouter.route("/").get(GetPrompts);

promptRouter.get("/buyer/:walletAddress/owned", GetOwnedPrompts);
promptRouter.get("/buyer/:walletAddress/saved", GetSavedPrompts);
promptRouter.get("/creator/:walletAddress/drafts", GetDraftPrompts);

// Preview analytics (#257)
promptRouter.post("/preview", RecordPreview);
promptRouter.get("/preview/stats", GetPreviewStats);

// Report endpoints — off-chain moderation data, does not affect access control
promptRouter.post("/reports", SubmitPromptReport);
promptRouter.get("/reports", GetPromptReports);
