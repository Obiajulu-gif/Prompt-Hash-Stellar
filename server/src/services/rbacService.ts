import { UserRole, ROLE_PERMISSIONS, AuthContext } from '../middleware/rbac';

export interface UserPermissionConfig {
  userId: string;
  walletAddress: string;
  role: UserRole;
  customPermissions?: string[];
}

export class RBACService {
  static async resolveUserRole(userId: string): Promise<UserRole> {
    // TODO: Fetch from database based on user record
    // This is a placeholder that should query the user collection
    return 'buyer';
  }

  static async loadUserPermissions(config: UserPermissionConfig): Promise<AuthContext> {
    const rolePermissions = ROLE_PERMISSIONS[config.role];
    const permissions = new Set(rolePermissions);

    // Add custom permissions if any
    if (config.customPermissions) {
      config.customPermissions.forEach(p => permissions.add(p));
    }

    return {
      userId: config.userId,
      walletAddress: config.walletAddress,
      role: config.role,
      permissions,
    };
  }

  static hasPermission(context: AuthContext, permission: string): boolean {
    return context.permissions.has(permission);
  }

  static hasAnyPermission(context: AuthContext, permissions: string[]): boolean {
    return permissions.some(p => context.permissions.has(p));
  }

  static hasAllPermissions(context: AuthContext, permissions: string[]): boolean {
    return permissions.every(p => context.permissions.has(p));
  }

  static canAccessResource(
    context: AuthContext,
    resourceOwnerId: string,
    requiredPermission?: string
  ): boolean {
    // Admins can access everything
    if (context.role === 'admin') {
      return true;
    }

    // Users can access their own resources
    if (context.userId === resourceOwnerId) {
      return true;
    }

    // Check specific permission if provided
    if (requiredPermission) {
      return this.hasPermission(context, requiredPermission);
    }

    return false;
  }

  static grantPermission(context: AuthContext, permission: string): void {
    context.permissions.add(permission);
  }

  static revokePermission(context: AuthContext, permission: string): void {
    context.permissions.delete(permission);
  }

  static changeRole(context: AuthContext, newRole: UserRole): void {
    context.role = newRole;
    const rolePermissions = ROLE_PERMISSIONS[newRole];
    context.permissions.clear();
    rolePermissions.forEach(p => context.permissions.add(p));
  }
}
