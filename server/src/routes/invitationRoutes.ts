/**
 * Invitation routes — abuse-resistant collaboration workflow (#835).
 */

import express from "express";
import {
  CreateInvitation,
  AcceptInvitation,
  RevokeInvitation,
  ListInvitations,
} from "../controllers/invitationControllers";
import { requireIdempotency } from "../middleware/idempotency";

export const invitationRouter = express.Router();

// Create invitation
invitationRouter.post("/", requireIdempotency, CreateInvitation);

// Accept invitation
invitationRouter.post("/:invitationId/accept", requireIdempotency, AcceptInvitation);

// Revoke invitation
invitationRouter.post("/:invitationId/revoke", requireIdempotency, RevokeInvitation);

// List invitations for a wallet
invitationRouter.get("/:walletAddress", ListInvitations);
