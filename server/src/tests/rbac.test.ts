import { describe, it, expect } from 'vitest';
import { ROLE_PERMISSIONS, AuthContext } from '../middleware/rbac';
import { RBACService, UserPermissionConfig } from '../services/rbacService';

describe('RBAC System', () => {
  describe('Permission Resolution', () => {
    it('admin should have all permissions', () => {
      const adminPermissions = ROLE_PERMISSIONS['admin'];
      expect(adminPermissions.size).toBeGreaterThan(0);
      expect(adminPermissions.has('manage_users')).toBe(true);
      expect(adminPermissions.has('view_audit_logs')).toBe(true);
    });

    it('creator should have creator-specific permissions', () => {
      const creatorPermissions = ROLE_PERMISSIONS['creator'];
      expect(creatorPermissions.has('publish_prompts')).toBe(true);
      expect(creatorPermissions.has('view_own_analytics')).toBe(true);
      expect(creatorPermissions.has('manage_users')).toBe(false);
    });

    it('buyer should have buyer-specific permissions', () => {
      const buyerPermissions = ROLE_PERMISSIONS['buyer'];
      expect(buyerPermissions.has('purchase_prompts')).toBe(true);
      expect(buyerPermissions.has('view_purchases')).toBe(true);
      expect(buyerPermissions.has('publish_prompts')).toBe(false);
    });

    it('moderator should have moderation permissions', () => {
      const modPermissions = ROLE_PERMISSIONS['moderator'];
      expect(modPermissions.has('review_content')).toBe(true);
      expect(modPermissions.has('flag_violations')).toBe(true);
    });

    it('support should have support-specific permissions', () => {
      const supportPermissions = ROLE_PERMISSIONS['support'];
      expect(supportPermissions.has('view_tickets')).toBe(true);
      expect(supportPermissions.has('process_refunds')).toBe(true);
    });
  });

  describe('AuthContext Loading', async () => {
    it('should load permissions for a creator', async () => {
      const config: UserPermissionConfig = {
        userId: 'user123',
        walletAddress: 'GXXX...',
        role: 'creator',
      };

      const context = await RBACService.loadUserPermissions(config);
      expect(context.role).toBe('creator');
      expect(context.permissions.has('publish_prompts')).toBe(true);
    });

    it('should include custom permissions', async () => {
      const config: UserPermissionConfig = {
        userId: 'user456',
        walletAddress: 'GYYY...',
        role: 'buyer',
        customPermissions: ['special_access'],
      };

      const context = await RBACService.loadUserPermissions(config);
      expect(context.permissions.has('purchase_prompts')).toBe(true);
      expect(context.permissions.has('special_access')).toBe(true);
    });
  });

  describe('Permission Checking', async () => {
    let adminContext: AuthContext;
    let buyerContext: AuthContext;

    beforeEach(async () => {
      adminContext = await RBACService.loadUserPermissions({
        userId: 'admin1',
        walletAddress: 'G_admin',
        role: 'admin',
      });

      buyerContext = await RBACService.loadUserPermissions({
        userId: 'buyer1',
        walletAddress: 'G_buyer',
        role: 'buyer',
      });
    });

    it('should check single permission correctly', () => {
      expect(RBACService.hasPermission(adminContext, 'manage_users')).toBe(true);
      expect(RBACService.hasPermission(buyerContext, 'manage_users')).toBe(false);
      expect(RBACService.hasPermission(buyerContext, 'purchase_prompts')).toBe(true);
    });

    it('should check any permission correctly', () => {
      const permissions = ['publish_prompts', 'purchase_prompts'];
      expect(RBACService.hasAnyPermission(buyerContext, permissions)).toBe(true);
      expect(RBACService.hasAnyPermission(buyerContext, ['manage_users'])).toBe(false);
    });

    it('should check all permissions correctly', () => {
      const permissions = ['purchase_prompts', 'view_purchases'];
      expect(RBACService.hasAllPermissions(buyerContext, permissions)).toBe(true);
      expect(RBACService.hasAllPermissions(buyerContext, ['purchase_prompts', 'manage_users'])).toBe(
        false
      );
    });
  });

  describe('Resource Access Control', async () => {
    it('admin should access any resource', async () => {
      const adminContext = await RBACService.loadUserPermissions({
        userId: 'admin1',
        walletAddress: 'G_admin',
        role: 'admin',
      });

      expect(RBACService.canAccessResource(adminContext, 'user999')).toBe(true);
    });

    it('user should access their own resource', async () => {
      const userContext = await RBACService.loadUserPermissions({
        userId: 'user123',
        walletAddress: 'G_user',
        role: 'buyer',
      });

      expect(RBACService.canAccessResource(userContext, 'user123')).toBe(true);
    });

    it('user should not access other users resources', async () => {
      const userContext = await RBACService.loadUserPermissions({
        userId: 'user123',
        walletAddress: 'G_user',
        role: 'buyer',
      });

      expect(RBACService.canAccessResource(userContext, 'user456')).toBe(false);
    });

    it('should respect permission requirements', async () => {
      const buyerContext = await RBACService.loadUserPermissions({
        userId: 'buyer1',
        walletAddress: 'G_buyer',
        role: 'buyer',
      });

      expect(RBACService.canAccessResource(buyerContext, 'user456', 'manage_users')).toBe(false);
    });
  });

  describe('Permission Management', async () => {
    it('should grant permission', async () => {
      const context = await RBACService.loadUserPermissions({
        userId: 'user1',
        walletAddress: 'G_user',
        role: 'buyer',
      });

      expect(context.permissions.has('special_privilege')).toBe(false);
      RBACService.grantPermission(context, 'special_privilege');
      expect(context.permissions.has('special_privilege')).toBe(true);
    });

    it('should revoke permission', async () => {
      const context = await RBACService.loadUserPermissions({
        userId: 'user1',
        walletAddress: 'G_user',
        role: 'buyer',
        customPermissions: ['temp_access'],
      });

      expect(context.permissions.has('temp_access')).toBe(true);
      RBACService.revokePermission(context, 'temp_access');
      expect(context.permissions.has('temp_access')).toBe(false);
    });

    it('should change role and update permissions', async () => {
      const context = await RBACService.loadUserPermissions({
        userId: 'user1',
        walletAddress: 'G_user',
        role: 'buyer',
      });

      expect(context.role).toBe('buyer');
      expect(context.permissions.has('purchase_prompts')).toBe(true);
      expect(context.permissions.has('publish_prompts')).toBe(false);

      RBACService.changeRole(context, 'creator');
      expect(context.role).toBe('creator');
      expect(context.permissions.has('publish_prompts')).toBe(true);
      expect(context.permissions.has('purchase_prompts')).toBe(false);
    });
  });
});
