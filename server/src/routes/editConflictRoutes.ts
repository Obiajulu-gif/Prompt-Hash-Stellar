/**
 * Concurrent-edit conflict resolution routes (#1170).
 *
 * Mounted separately from the legacy, unmounted `concurrencyRouter` so adding
 * conflict resolution does not expose its unauthenticated version-check
 * endpoint. The owner wallet comes from the body, but the wallet session must
 * belong to it.
 */

import express from "express";
import { ResolveEditConflict } from "../controllers/editConflictControllers";
import { requireWalletSession } from "../middleware/walletSession";

export const editConflictRouter = express.Router();

editConflictRouter.post(
  "/resolve",
  requireWalletSession((req) => req.body?.ownerWallet),
  ResolveEditConflict,
);
