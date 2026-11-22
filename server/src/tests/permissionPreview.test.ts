import { expect, describe, it } from 'vitest';
import { AuthContext, ROLE_PERMISSIONS } from '../middleware/rbac';
import { PermissionPreviewService, UpdateRequest } from '../services/permissionPreviewService';
import { PermissionDiffError } from '../services/permissionDiff';

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
    const { digest } = PermissionPreviewService.previewUpdate(baseContext, updateReq);

    const newContext = PermissionPreviewService.applyUpdate(baseContext, {
      ...updateReq,
      expectedDiffDigest: digest,
    });
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

describe('PermissionPreviewService permission-diff report (#1036)', () => {
  const creator = (): AuthContext => ({
    userId: 'user123',
    walletAddress: 'wallet123',
    role: 'creator',
    permissions: new Set(ROLE_PERMISSIONS['creator']),
  });
  const promoteToModerator: UpdateRequest = {
    targetUserId: 'user123',
    newRole: 'moderator',
    explicitConfirmation: true,
    requestorRole: 'admin',
  };

  it('reports added, removed, and privileged permissions before a role change', () => {
    const report = PermissionPreviewService.previewUpdate(creator(), promoteToModerator);

    expect(report.added).toEqual([...ROLE_PERMISSIONS['moderator']].filter((p) => p !== 'access_notifications').sort());
    expect(report.removed).toEqual([...ROLE_PERMISSIONS['creator']].filter((p) => p !== 'access_notifications').sort());
    // Moderator powers are outside the buyer/creator baseline.
    expect(report.privilegedGrants).toEqual(report.added);
    expect(report.digest).toMatch(/^[0-9a-f]{64}$/);
  });

  it('applies a change whose reviewed digest matches the current state', () => {
    const report = PermissionPreviewService.previewUpdate(creator(), promoteToModerator);
    expect(report.previousRole).toBe('creator');
    expect(report.newRole).toBe('moderator');
    const next = PermissionPreviewService.applyUpdate(creator(), {
      ...promoteToModerator,
      expectedDiffDigest: report.digest,
    });
    expect(next.role).toBe('moderator');
    expect(next.permissions).toEqual(new Set(ROLE_PERMISSIONS['moderator']));
  });

  it('refuses to apply a change without a reviewed report', () => {
    try {
      PermissionPreviewService.applyUpdate(creator(), promoteToModerator);
      throw new Error('Expected missing-review rejection');
    } catch (error) {
      expect(error).toBeInstanceOf(PermissionDiffError);
      expect((error as PermissionDiffError).apiCode).toBe('PERMISSION_DIFF_REQUIRED');
    }
  });

  it('rejects a stale report when the target changed after review', () => {
    const report = PermissionPreviewService.previewUpdate(creator(), promoteToModerator);
    const changed = creator();
    changed.permissions.add('view_flagged_content'); // concurrent grant by another admin

    try {
      PermissionPreviewService.applyUpdate(changed, {
        ...promoteToModerator,
        expectedDiffDigest: report.digest,
      });
      throw new Error('Expected stale-review rejection');
    } catch (error) {
      expect(error).toBeInstanceOf(PermissionDiffError);
      expect((error as PermissionDiffError).apiCode).toBe('STALE_PERMISSION_DIFF');
    }
  });

  it('rejects a report reused for a different change', () => {
    const report = PermissionPreviewService.previewUpdate(creator(), {
      targetUserId: 'user123',
      grantPermissions: ['view_sales'],
      requestorRole: 'admin',
    });
    expect(() =>
      PermissionPreviewService.applyUpdate(creator(), {
        targetUserId: 'user123',
        grantPermissions: ['impersonate_user'],
        explicitConfirmation: true,
        requestorRole: 'admin',
        expectedDiffDigest: report.digest,
      }),
    ).toThrow('Stale permission diff');
  });

  it('requires explicit confirmation for a narrow privileged grant', () => {
    const grant: UpdateRequest = {
      targetUserId: 'user123',
      grantPermissions: ['impersonate_user'],
      requestorRole: 'admin',
    };
    const report = PermissionPreviewService.previewUpdate(creator(), grant);
    expect(report.isBroad).toBe(false);
    expect(report.privilegedGrants).toEqual(['impersonate_user']);

    expect(() =>
      PermissionPreviewService.applyUpdate(creator(), { ...grant, expectedDiffDigest: report.digest }),
    ).toThrow('Explicit confirmation is required for privileged grants.');
  });

  it('denies preview and apply when the requestor role is missing', () => {
    const anonymous: UpdateRequest = { targetUserId: 'user123', grantPermissions: ['view_sales'] };
    expect(() => PermissionPreviewService.previewUpdate(creator(), anonymous)).toThrow('Permission denied');
    expect(() => PermissionPreviewService.applyUpdate(creator(), anonymous)).toThrow('Permission denied');
  });

  it('produces the same digest regardless of permission insertion order', () => {
    const reordered = creator();
    reordered.permissions = new Set([...ROLE_PERMISSIONS['creator']].reverse());
    expect(PermissionPreviewService.previewUpdate(reordered, promoteToModerator).digest).toBe(
      PermissionPreviewService.previewUpdate(creator(), promoteToModerator).digest,
    );
  });
});
