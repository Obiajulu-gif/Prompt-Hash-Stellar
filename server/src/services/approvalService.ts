import connectDb from "../db/connectDb";
import Approval from "../models/Approval";

export interface ApprovalRecord {
  approval: IApproval;
  needsApproval: boolean;
  approvedBy: string | null;
}

export interface CreateApprovalParams {
  actionId: string;
  actionType: string;
  scope: "MAINTENANCE" | "TRANSFER" | "MODERATION" | "ADMIN";
  reason: string;
  actor: string;
  durationMinutes: number;
}

export interface EvaluateApprovalParams {
  approvalId: string;
  actor: string;
  scope: "MAINTENANCE" | "TRANSFER" | "MODERATION" | "ADMIN";
  actionPath: string;
}

export interface ApprovalEvaluation {
  approved: boolean;
  reason?: string;
  scopeMismatch: boolean;
  expired: boolean;
}

export class ApprovalService {
  /**
   * Create a new approval request for a maintainer action.
   */
  static async createApproval(params: CreateApprovalParams): Promise<IApproval> {
    await connectDb();

    const expiresAt = new Date();
    expiresAt.setMinutes(expiresAt.getMinutes() + params.durationMinutes);

    const approval = await Approval.create({
      actionId: params.actionId,
      actionType: params.actionType,
      scope: params.scope,
      reason: params.reason,
      actor: params.actor,
      expiresAt,
      status: "pending",
    });

    return approval;
  }

  /**
   * Evaluate whether an approval is valid for a given action.
   * Checks: scope match, expiry, status.
   */
  static async evaluateApproval(params: EvaluateApprovalParams): Promise<ApprovalEvaluation> {
    await connectDb();

    const approval = await Approval.findOne({
      actionId: params.approvalId,
      scope: params.scope,
    });

    if (!approval) {
      return {
        approved: false,
        reason: "No approval found for this action and scope",
        scopeMismatch: false,
        expired: false,
      };
    }

    // Check if already decided
    if (approval.status !== "pending") {
      const decision = approval.status;
      return {
        approved: decision === "approved",
        reason: `Approval was already ${decision}`,
        scopeMismatch: false,
        expired: new Date() > approval.expiresAt,
      };
    }

    // Check expiry
    if (new Date() > approval.expiresAt) {
      await Approval.updateOne(
        { _id: approval._id },
        {
          $set: {
            status: "rejected",
            rejectedAt: new Date(),
            rejectionReason: "Approval expired",
          },
        }
      );
      return {
        approved: false,
        reason: "Approval has expired",
        scopeMismatch: false,
        expired: true,
      };
    }

    // Check actor match (the actor who granted approval vs the actor trying to use it)
    if (approval.actor !== params.actor) {
      return {
        approved: false,
        reason: "Approval actor mismatch",
        scopeMismatch: true,
        expired: false,
      };
    }

    return {
      approved: true,
      reason: undefined,
      scopeMismatch: false,
      expired: false,
    };
  }

  /**
   * Approve a pending approval.
   */
  static async approve(params: { approvalId: string; actor: string }): Promise<IApproval> {
    await connectDb();

    const approval = await Approval.findOneAndUpdate(
      {
        _id: params.approvalId,
        status: "pending",
        actor: params.actor,
      },
      {
        $set: {
          status: "approved",
          approvedAt: new Date(),
        },
      },
      { new: true }
    );

    if (!approval) {
      throw new Error("Approval not found or cannot be approved (not pending or actor mismatch)");
    }

    return approval;
  }

  /**
   * Reject a pending approval.
   */
  static async reject(params: { approvalId: string; actor: string; reason: string }): Promise<IApproval> {
    await connectDb();

    const approval = await Approval.findOneAndUpdate(
      {
        _id: params.approvalId,
        status: "pending",
        actor: params.actor,
      },
      {
        $set: {
          status: "rejected",
          rejectedAt: new Date(),
          rejectionReason: params.reason,
        },
      },
      { new: true }
    );

    if (!approval) {
      throw new Error("Approval not found or cannot be rejected (not pending or actor mismatch)");
    }

    return approval;
  }

  /**
   * Get pending approvals for a given scope and action.
   */
  static async getPendingApprovals({
    scope,
    actionId,
  }: {
    scope: "MAINTENANCE" | "TRANSFER" | "MODERATION" | "ADMIN";
    actionId: string;
  }): Promise<IApproval[]> {
    await connectDb();

    return Approval.find({
      scope,
      actionId,
      status: "pending",
    })
      .sort({ approvedAt: -1 })
      .lean();
  }

  /**
   * Check if a protected action has valid approval.
   * Returns true if approval is valid, false otherwise.
   * Also returns the reason for rejection.
   */
  static async checkProtectedActionApproval({
    actionId,
    actionType,
    scope,
    actor,
    actionPath,
  }: {
    actionId: string;
    actionType: string;
    scope: "MAINTENANCE" | "TRANSFER" | "MODERATION" | "ADMIN";
    actor: string;
    actionPath: string;
  }): Promise<{
    requiresApproval: boolean;
    approved: boolean;
    reason?: string;
    scopeMismatch: boolean;
    expired: boolean;
  }> {
    await connectDb();

    // Check if there's a pending approval for this action and scope
    const pending = await Approval.findOne({
      actionId,
      scope,
      status: "pending",
      expiresAt: { $gt: new Date() },
    });

    if (!pending) {
      // No pending approval - check if there's an approved one
      const approved = await Approval.findOne({
        actionId,
        scope,
        status: "approved",
        expiresAt: { $gt: new Date() },
      });

      if (!approved) {
        return {
          requiresApproval: true,
          approved: false,
          reason: "No valid approval found for this protected action",
          scopeMismatch: false,
          expired: false,
        };
      }
    }

    // Evaluate the approval
    const evaluation = await this.evaluateApproval({
      approvalId: pending ? pending._id.toString() : "",
      actor,
      scope,
      actionPath,
    });

    return {
      requiresApproval: true,
      approved: evaluation.approved,
      reason: evaluation.reason,
      scopeMismatch: evaluation.scopeMismatch,
      expired: evaluation.expired,
    };
  }
}