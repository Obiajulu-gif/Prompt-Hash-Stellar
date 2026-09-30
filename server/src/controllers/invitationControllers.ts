/**
 * Invitation controllers — CRUD + acceptance/revocation endpoints (#835).
 */

import { Request, Response } from "express";
import { InvitationService } from "../services/invitationService";
import { logger } from "../services/structuredLogger";

export const CreateInvitation = async (
  req: Request,
  res: Response,
): Promise<Response<any>> => {
  try {
    const { inviterWallet, inviteeWallet, role, promptId, message, ttlHours } =
      req.body;

    if (!inviterWallet || !inviteeWallet || !role) {
      return res.status(400).json({
        error: "Missing required fields: inviterWallet, inviteeWallet, role",
      });
    }

    const { invitation, error } = await InvitationService.create({
      inviterWallet,
      inviteeWallet,
      role,
      promptId,
      message,
      ttlHours,
    });

    if (error) {
      return res.status(400).json({ error });
    }

    return res.status(201).json({ invitation });
  } catch (err) {
    logger.error("Create invitation error", {
      action: "createInvitation",
      error: err,
    });
    return res.status(500).json({
      error: (err as Error).message || "Failed to create invitation",
    });
  }
};

export const AcceptInvitation = async (
  req: Request,
  res: Response,
): Promise<Response<any>> => {
  try {
    const { invitationId } = req.params;
    const { inviteeWallet, currentRole } = req.body;

    if (!inviteeWallet) {
      return res.status(400).json({ error: "inviteeWallet is required" });
    }

    const { success, error } = await InvitationService.accept({
      invitationId,
      inviteeWallet,
      currentRole,
    });

    if (!success) {
      return res.status(400).json({ error });
    }

    return res.json({ success: true, message: "Invitation accepted" });
  } catch (err) {
    logger.error("Accept invitation error", {
      action: "acceptInvitation",
      error: err,
    });
    return res.status(500).json({
      error: (err as Error).message || "Failed to accept invitation",
    });
  }
};

export const RevokeInvitation = async (
  req: Request,
  res: Response,
): Promise<Response<any>> => {
  try {
    const { invitationId } = req.params;
    const { revokerWallet } = req.body;

    if (!revokerWallet) {
      return res.status(400).json({ error: "revokerWallet is required" });
    }

    const { success, error } = await InvitationService.revoke({
      invitationId,
      revokerWallet,
    });

    if (!success) {
      return res.status(400).json({ error });
    }

    return res.json({ success: true, message: "Invitation revoked" });
  } catch (err) {
    logger.error("Revoke invitation error", {
      action: "revokeInvitation",
      error: err,
    });
    return res.status(500).json({
      error: (err as Error).message || "Failed to revoke invitation",
    });
  }
};

export const ListInvitations = async (
  req: Request,
  res: Response,
): Promise<Response<any>> => {
  try {
    const { walletAddress } = req.params;
    const { direction, status, limit, cursor } = req.query;

    if (!walletAddress) {
      return res.status(400).json({ error: "walletAddress is required" });
    }

    const result = await InvitationService.list({
      wallet: walletAddress,
      direction: (direction as "incoming" | "outgoing") || "incoming",
      status: status as any,
      limit: parseInt(limit as string) || 20,
      cursor: cursor as string,
    });

    return res.json(result);
  } catch (err) {
    logger.error("List invitations error", {
      action: "listInvitations",
      error: err,
    });
    return res.status(500).json({
      error: (err as Error).message || "Failed to list invitations",
    });
  }
};
