import { AuthContext, ROLE_PERMISSIONS, UserRole } from '../middleware/rbac';
import { RBACService } from './rbacService';
import {
  assertReviewedDiff,
  diffDigest,
  diffSets,
  isPrivilegedPermission,
} from './permissionDiff';

export interface PermissionDiff {
  /** Role transition shown in the preview even when permission sets overlap. */
  previousRole: UserRole | null;
  newRole: UserRole | null;
  added: string[];
  removed: string[];
  isBroad: boolean;
  affectedActors: string[];
  scopes: string[];
  actions: string[];
  /** Granted permissions outside the self-service baseline (#1036). */
  privilegedGrants: string[];
  /** Binds the report to its before/after state; applyUpdate requires it (#1036). */
  digest: string;
}

export interface UpdateRequest {
  targetUserId?: string;
  targetRole?: UserRole; // If applying to all users of a role
  newRole?: UserRole; // If changing a specific user's role
  grantPermissions?: string[];
  revokePermissions?: string[];
  policyVersion?: string; // Used to check for stale input
  currentPolicyVersion?: string; 
  explicitConfirmation?: boolean; // Required if isBroad is true
  requestorRole?: UserRole; // Who is making the request
  expectedDiffDigest?: string; // Digest of the reviewed preview (#1036)
}

export class PermissionPreviewService {
  /**
   * Computes the before/after permission diff.
   */
  static computeDiff(
    currentPermissions: Set<string>,
    newPermissions: Set<string>,
    updateReq: UpdateRequest,
    currentRole?: UserRole,
  ): PermissionDiff {
    const { added, removed } = diffSets(currentPermissions, newPermissions);

    const affectedActors = updateReq.targetUserId
      ? [updateReq.targetUserId]
      : updateReq.targetRole
      ? [`All users with role: ${updateReq.targetRole}`]
      : ['Global'];

    // Define "broad change":
    // 1. Affects a whole role or global (not just a single user)
    // 2. Modifies more than 2 permissions at once
    const isBroad = (!updateReq.targetUserId) || (added.length + removed.length > 2);
    const scopes = updateReq.targetRole ? [updateReq.targetRole] : ['user-specific'];
    const previousRole = currentRole ?? null;
    const newRole = updateReq.newRole ?? currentRole ?? null;

    return {
      previousRole,
      newRole,
      added,
      removed,
      isBroad,
      affectedActors,
      scopes,
      actions: added.map((a) => `Grant ${a}`).concat(removed.map((r) => `Revoke ${r}`)),
      privilegedGrants: added.filter(isPrivilegedPermission),
      // Binds the full before/after state, not just the delta, so any
      // concurrent change to the target invalidates a reviewed report.
      digest: diffDigest({
        affectedActors,
        scopes,
        previousRole,
        newRole,
        before: [...currentPermissions].sort(),
        after: [...newPermissions].sort(),
      }),
    };
  }

  /**
   * Returns the permission-diff report for an update without applying it
   * (#1036). Apply with `expectedDiffDigest: report.digest`.
   */
  static previewUpdate(currentContext: AuthContext, updateReq: UpdateRequest): PermissionDiff {
    return this.plan(currentContext, updateReq).diff;
  }

  /**
   * Validates and applies the update if constraints are met.
   */
  static applyUpdate(
    currentContext: AuthContext,
    updateReq: UpdateRequest
  ): AuthContext {
    const { diff, newPermissions } = this.plan(currentContext, updateReq);

    // 4. Require explicit confirmation for broad changes and privilege escalation
    if (diff.isBroad && !updateReq.explicitConfirmation) {
      throw new Error('Explicit confirmation is required for broad changes.');
    }
    if (diff.privilegedGrants.length > 0 && !updateReq.explicitConfirmation) {
      throw new Error('Explicit confirmation is required for privileged grants.');
    }

    // 5. If it's a no-op, just return the current context
    if (diff.added.length === 0 && diff.removed.length === 0) {
      return currentContext;
    }

    // 6. The caller must have reviewed exactly this diff (#1036)
    assertReviewedDiff(updateReq.expectedDiffDigest, diff.digest);

    return {
      ...currentContext,
      role: updateReq.newRole || currentContext.role,
      permissions: newPermissions,
    };
  }

  /** Shared by preview and apply so both evaluate the identical change. */
  private static plan(
    currentContext: AuthContext,
    updateReq: UpdateRequest
  ): { diff: PermissionDiff; newPermissions: Set<string> } {
    // 1. Fail closed: only an identified admin may preview or change permissions
    if (updateReq.requestorRole !== 'admin') {
      throw new Error('Permission denied: Only admins can update permissions');
    }

    // 2. Check for stale policy input
    if (
      updateReq.policyVersion &&
      updateReq.currentPolicyVersion &&
      updateReq.policyVersion !== updateReq.currentPolicyVersion
    ) {
      throw new Error('Stale policy input: The policy has been modified by someone else.');
    }

    // 3. Compute current and new permissions
    const currentPermissions = new Set(currentContext.permissions);
    let newPermissions = new Set(currentContext.permissions);

    if (updateReq.newRole) {
      const rolePerms = ROLE_PERMISSIONS[updateReq.newRole];
      newPermissions = new Set(rolePerms);
    }

    if (updateReq.grantPermissions) {
      updateReq.grantPermissions.forEach((p) => newPermissions.add(p));
    }

    if (updateReq.revokePermissions) {
      updateReq.revokePermissions.forEach((p) => newPermissions.delete(p));
    }

    return {
      diff: this.computeDiff(currentPermissions, newPermissions, updateReq, currentContext.role),
      newPermissions,
    };
  }
}
