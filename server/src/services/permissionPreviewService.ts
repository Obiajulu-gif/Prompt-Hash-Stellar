import { AuthContext, ROLE_PERMISSIONS, UserRole } from '../middleware/rbac';
import { RBACService } from './rbacService';

export interface PermissionDiff {
  added: string[];
  removed: string[];
  isBroad: boolean;
  affectedActors: string[];
  scopes: string[];
  actions: string[];
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
}

export class PermissionPreviewService {
  /**
   * Computes the before/after permission diff.
   */
  static computeDiff(
    currentPermissions: Set<string>,
    newPermissions: Set<string>,
    updateReq: UpdateRequest
  ): PermissionDiff {
    const added: string[] = [];
    const removed: string[] = [];

    newPermissions.forEach((p) => {
      if (!currentPermissions.has(p)) {
        added.push(p);
      }
    });

    currentPermissions.forEach((p) => {
      if (!newPermissions.has(p)) {
        removed.push(p);
      }
    });

    const affectedActors = updateReq.targetUserId
      ? [updateReq.targetUserId]
      : updateReq.targetRole
      ? [`All users with role: ${updateReq.targetRole}`]
      : ['Global'];

    // Define "broad change":
    // 1. Affects a whole role or global (not just a single user)
    // 2. Modifies more than 2 permissions at once
    const isBroad = (!updateReq.targetUserId) || (added.length + removed.length > 2);

    return {
      added,
      removed,
      isBroad,
      affectedActors,
      scopes: updateReq.targetRole ? [updateReq.targetRole] : ['user-specific'],
      actions: added.map((a) => `Grant ${a}`).concat(removed.map((r) => `Revoke ${r}`)),
    };
  }

  /**
   * Validates and applies the update if constraints are met.
   */
  static applyUpdate(
    currentContext: AuthContext,
    updateReq: UpdateRequest
  ): AuthContext {
    // 1. Check for denied actor (only admins can apply broad changes usually, but let's check requestorRole)
    if (updateReq.requestorRole && updateReq.requestorRole !== 'admin') {
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

    const diff = this.computeDiff(currentPermissions, newPermissions, updateReq);

    // 4. Require explicit confirmation for broad changes
    if (diff.isBroad && !updateReq.explicitConfirmation) {
      throw new Error('Explicit confirmation is required for broad changes.');
    }

    // 5. If it's a no-op, just return the current context
    if (diff.added.length === 0 && diff.removed.length === 0) {
      return currentContext;
    }

    return {
      ...currentContext,
      role: updateReq.newRole || currentContext.role,
      permissions: newPermissions,
    };
  }
}
