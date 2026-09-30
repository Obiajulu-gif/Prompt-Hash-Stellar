/**
 * Invitation service — manages collaboration invitations (#835).
 *
 * Handles creation, acceptance, revocation, expiry, and abuse throttling.
 */

import Invitation, {
  type InvitationRole,
  type InvitationStatus,
  ROLE_HIERARCHY,
} from "../models/Invitation";
import { logger } from "./structuredLogger";

const DEFAULT_MAX_INVITES_PER_HOUR = 20;
const DEFAULT_INVITATION_TTL_HOURS = 72;

export class InvitationService {
  /**
   * Create a new invitation with rate-limit and role validation.
   */
  static async create(params: {
    inviterWallet: string;
    inviteeWallet: string;
    role: InvitationRole;
    promptId?: string;
    message?: string;
    ttlHours?: number;
  }): Promise<{ invitation: InstanceType<typeof Invitation>; error?: string }> {
    const { inviterWallet, inviteeWallet, role, promptId, message, ttlHours } =
      params;

    if (inviterWallet.toLowerCase() === inviteeWallet.toLowerCase()) {
      return { invitation: null as any, error: "Cannot invite yourself" };
    }

    if (!ROLE_HIERARCHY[role]) {
      return { invitation: null as any, error: "Invalid role" };
    }

    // Rate limit: check recent invitations from this inviter
    const oneHourAgo = new Date(Date.now() - 60 * 60 * 1000);
    const recentCount = await Invitation.countDocuments({
      inviterWallet: inviterWallet.toLowerCase(),
      createdAt: { $gte: oneHourAgo },
    });

    if (recentCount >= DEFAULT_MAX_INVITES_PER_HOUR) {
      logger.warn("Invitation rate limit exceeded", {
        action: "createInvitation",
        wallet: inviterWallet,
        count: recentCount,
      });
      return {
        invitation: null as any,
        error: "Rate limit exceeded. Try again later.",
      };
    }

    // Check for existing pending invitation to same invitee for same prompt
    const existing = await Invitation.findOne({
      inviterWallet: inviterWallet.toLowerCase(),
      inviteeWallet: inviteeWallet.toLowerCase(),
      promptId: promptId || null,
      status: "pending",
    });

    if (existing) {
      return {
        invitation: null as any,
        error: "Invitation already pending for this user",
      };
    }

    const expiresAt = new Date(
      Date.now() + (ttlHours || DEFAULT_INVITATION_TTL_HOURS) * 60 * 60 * 1000,
    );

    const invitation = new Invitation({
      inviterWallet: inviterWallet.toLowerCase(),
      inviteeWallet: inviteeWallet.toLowerCase(),
      promptId: promptId || null,
      role,
      status: "pending",
      message: message || "",
      expiresAt,
    });

    await invitation.save();

    logger.info("Invitation created", {
      action: "createInvitation",
      inviter: inviterWallet,
      invitee: inviteeWallet,
      role,
    });

    return { invitation };
  }

  /**
   * Accept an invitation. Rejects if expired, revoked, or role escalation.
   */
  static async accept(params: {
    invitationId: string;
    inviteeWallet: string;
    currentRole?: InvitationRole;
  }): Promise<{ success: boolean; error?: string }> {
    const { invitationId, inviteeWallet, currentRole } = params;

    const invitation = await Invitation.findById(invitationId);
    if (!invitation) {
      return { success: false, error: "Invitation not found" };
    }

    if (invitation.inviteeWallet !== inviteeWallet.toLowerCase()) {
      return { success: false, error: "Not your invitation" };
    }

    if (invitation.status !== "pending") {
      return { success: false, error: `Invitation is ${invitation.status}` };
    }

    if (new Date() > invitation.expiresAt) {
      invitation.status = "expired";
      await invitation.save();
      return { success: false, error: "Invitation has expired" };
    }

    // Role escalation check
    if (currentRole) {
      const currentLevel = ROLE_HIERARCHY[currentRole] ?? 0;
      const requestedLevel = ROLE_HIERARCHY[invitation.role] ?? 0;
      if (requestedLevel > currentLevel + 1) {
        return {
          success: false,
          error: "Role escalation rejected. Cannot skip roles.",
        };
      }
    }

    invitation.status = "accepted";
    invitation.acceptedAt = new Date();
    await invitation.save();

    logger.info("Invitation accepted", {
      action: "acceptInvitation",
      invitationId,
      invitee: inviteeWallet,
    });

    return { success: true };
  }

  /**
   * Revoke an invitation. Only the inviter can revoke.
   */
  static async revoke(params: {
    invitationId: string;
    revokerWallet: string;
  }): Promise<{ success: boolean; error?: string }> {
    const { invitationId, revokerWallet } = params;

    const invitation = await Invitation.findById(invitationId);
    if (!invitation) {
      return { success: false, error: "Invitation not found" };
    }

    if (invitation.inviterWallet !== revokerWallet.toLowerCase()) {
      return { success: false, error: "Only the inviter can revoke" };
    }

    if (invitation.status !== "pending") {
      return { success: false, error: `Invitation is already ${invitation.status}` };
    }

    invitation.status = "revoked";
    invitation.revokedAt = new Date();
    invitation.revokedBy = revokerWallet.toLowerCase();
    await invitation.save();

    logger.info("Invitation revoked", {
      action: "revokeInvitation",
      invitationId,
      revoker: revokerWallet,
    });

    return { success: true };
  }

  /**
   * List invitations for a wallet (incoming or outgoing).
   */
  static async list(params: {
    wallet: string;
    direction: "incoming" | "outgoing";
    status?: InvitationStatus;
    limit?: number;
    cursor?: string;
  }) {
    const { wallet, direction, status, limit = 20, cursor } = params;

    const query: any = {
      [direction === "incoming" ? "inviteeWallet" : "inviterWallet"]:
        wallet.toLowerCase(),
    };

    if (status) {
      query.status = status;
    }

    if (cursor) {
      query._id = { $lt: cursor };
    }

    const results = await Invitation.find(query)
      .sort({ createdAt: -1 })
      .limit(limit + 1);

    let hasNextPage = false;
    let nextCursor = null;

    if (results.length > limit) {
      hasNextPage = true;
      results.pop();
      nextCursor = results[results.length - 1]._id;
    }

    return { data: results, metadata: { hasNextPage, nextCursor } };
  }

  /**
   * Expire stale invitations (called by cron or middleware).
   */
  static async expireStale(): Promise<number> {
    const result = await Invitation.updateMany(
      { status: "pending", expiresAt: { $lte: new Date() } },
      { $set: { status: "expired" } },
    );

    return result.modifiedCount;
  }
}
