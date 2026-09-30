import { expect, describe, it } from 'vitest';
import { AuthContext, ROLE_PERMISSIONS } from '../middleware/rbac';
import { PermissionPreviewService, UpdateRequest } from '../services/permissionPreviewService';

describe('PermissionPreviewService', () => {
  const baseContext: AuthContext = {
    userId: 'user123',
    walletAddress: 'wallet123',
    role: 'creator',
    permissions: new Set(ROLE_PERMISSIONS['creator']),
  };

  it('computes before/after diff for a narrow change', () => {
    const updateReq: UpdateRequest = {
      targetUserId: 'user123',
      grantPermissions: ['special_access'],
    };

    const newPermissions = new Set(baseContext.permissions);
    newPermissions.add('special_access');

    const diff = PermissionPreviewService.computeDiff(baseContext.permissions, newPermissions, updateReq);
    
    expect(diff.added).toEqual(['special_access']);
    expect(diff.removed).toEqual([]);
    expect(diff.isBroad).toBe(false);
    expect(diff.affectedActors).toEqual(['user123']);
  });

  it('requires explicit confirmation for broad changes', () => {
    const updateReq: UpdateRequest = {
      targetRole: 'creator', // Affects all creators
      grantPermissions: ['new_global_permission'],
      requestorRole: 'admin',
    };

    expect(() => {
      PermissionPreviewService.applyUpdate(baseContext, updateReq);
    }).toThrow('Explicit confirmation is required for broad changes.');
  });

  it('allows broad change if explicit confirmation is provided', () => {
    const updateReq: UpdateRequest = {
      targetRole: 'creator', // Affects all creators
      grantPermissions: ['new_global_permission'],
      explicitConfirmation: true,
      requestorRole: 'admin',
    };

    const newContext = PermissionPreviewService.applyUpdate(baseContext, updateReq);
    expect(newContext.permissions.has('new_global_permission')).toBe(true);
  });

  it('handles no-op successfully', () => {
    const updateReq: UpdateRequest = {
      targetUserId: 'user123',
      requestorRole: 'admin',
    };

    const newContext = PermissionPreviewService.applyUpdate(baseContext, updateReq);
    expect(newContext.permissions.size).toBe(baseContext.permissions.size);
  });

  it('denies actor lacking admin privileges', () => {
    const updateReq: UpdateRequest = {
      targetUserId: 'user123',
      grantPermissions: ['special_access'],
      requestorRole: 'buyer',
    };

    expect(() => {
      PermissionPreviewService.applyUpdate(baseContext, updateReq);
    }).toThrow('Permission denied: Only admins can update permissions');
  });

  it('rejects stale policy input', () => {
    const updateReq: UpdateRequest = {
      targetUserId: 'user123',
      grantPermissions: ['special_access'],
      policyVersion: 'v1',
      currentPolicyVersion: 'v2',
      requestorRole: 'admin',
    };

    expect(() => {
      PermissionPreviewService.applyUpdate(baseContext, updateReq);
    }).toThrow('Stale policy input: The policy has been modified by someone else.');
  });
});
