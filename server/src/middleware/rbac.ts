import { Request, Response, NextFunction } from 'express';

export type UserRole = 'admin' | 'creator' | 'buyer' | 'moderator' | 'support' | 'system';

export interface AuthContext {
  userId: string;
  walletAddress: string;
  role: UserRole;
  permissions: Set<string>;
}

export const ROLE_PERMISSIONS: Record<UserRole, Set<string>> = {
  admin: new Set([
    'manage_users',
    'manage_roles',
    'view_audit_logs',
    'approve_creators',
    'manage_disputes',
    'manage_payouts',
    'view_analytics',
    'manage_feature_flags',
    'moderate_content',
    'impersonate_user',
  ]),
  creator: new Set([
    'publish_prompts',
    'edit_own_prompts',
    'view_own_analytics',
    'manage_pricing',
    'view_sales',
    'request_payout',
    'access_notifications',
  ]),
  buyer: new Set([
    'purchase_prompts',
    'view_purchases',
    'access_unlocked_content',
    'manage_library',
    'leave_reviews',
    'access_notifications',
  ]),
  moderator: new Set([
    'review_content',
    'flag_violations',
    'view_flagged_content',
    'suggest_actions',
    'view_moderation_logs',
    'access_notifications',
  ]),
  support: new Set([
    'view_tickets',
    'respond_to_support',
    'access_user_data',
    'process_refunds',
    'view_audit_logs',
    'access_notifications',
  ]),
  system: new Set([
    'trigger_jobs',
    'manage_webhooks',
    'access_system_apis',
    'read_metrics',
  ]),
};

declare module 'express-serve-static-core' {
  interface Request {
    auth?: AuthContext;
  }
}

export const requireRole = (allowedRoles: UserRole[]) => {
  return (req: Request, res: Response, next: NextFunction) => {
    if (!req.auth) {
      return res.status(401).json({ error: 'Unauthorized' });
    }

    if (!allowedRoles.includes(req.auth.role)) {
      return res.status(403).json({ error: 'Insufficient permissions' });
    }

    next();
  };
};

export const requirePermission = (permission: string) => {
  return (req: Request, res: Response, next: NextFunction) => {
    if (!req.auth) {
      return res.status(401).json({ error: 'Unauthorized' });
    }

    if (!req.auth.permissions.has(permission)) {
      return res.status(403).json({ error: 'Insufficient permissions' });
    }

    next();
  };
};

export const requireAnyPermission = (permissions: string[]) => {
  return (req: Request, res: Response, next: NextFunction) => {
    if (!req.auth) {
      return res.status(401).json({ error: 'Unauthorized' });
    }

    const hasPermission = permissions.some(p => req.auth!.permissions.has(p));
    if (!hasPermission) {
      return res.status(403).json({ error: 'Insufficient permissions' });
    }

    next();
  };
};

export const requireAllPermissions = (permissions: string[]) => {
  return (req: Request, res: Response, next: NextFunction) => {
    if (!req.auth) {
      return res.status(401).json({ error: 'Unauthorized' });
    }

    const hasAllPermissions = permissions.every(p => req.auth!.permissions.has(p));
    if (!hasAllPermissions) {
      return res.status(403).json({ error: 'Insufficient permissions' });
    }

    next();
  };
};

export const contextAwarePermissionCheck = (
  requiredPermission: string,
  contextResolver: (req: Request) => boolean
) => {
  return (req: Request, res: Response, next: NextFunction) => {
    if (!req.auth) {
      return res.status(401).json({ error: 'Unauthorized' });
    }

    if (!req.auth.permissions.has(requiredPermission)) {
      return res.status(403).json({ error: 'Insufficient permissions' });
    }

    if (!contextResolver(req)) {
      return res.status(403).json({ error: 'Access denied for this resource' });
    }

    next();
  };
};

// Authorization matrix for prompt lifecycle operations.
// This is the single source of truth used by the executable matrix tests
// in server/src/middleware/__tests__/rbac.matrix.test.ts and by the routes.
export type PromptAction =
  | 'create_prompt'
  | 'purchase_prompt'
  | 'unlock_prompt'
  | 'update_prompt'
  | 'transfer_ownership'
  | 'admin_moderate_prompt'
  | 'admin_manage_roles';

export interface PromptAuthorizationRule {
  action: PromptAction;
  // Roles that may perform the action at all.
  allowedRoles: UserRole[];
  // Permissions that must all be present for the action.
  requiredPermissions: string[];
  // Whether the actor must be the resource owner (cross-user denial).
  requiresOwner?: boolean;
  // Whether administrators bypass ownership checks.
  adminOverride?: boolean;
}

export const PROMPT_AUTHORIZATION_MATRIX: Record<PromptAction, PromptAuthorizationRule> = {
  create_prompt: {
    action: 'create_prompt',
    allowedRoles: ['creator', 'admin'],
    requiredPermissions: ['publish_prompts'],
  },
  purchase_prompt: {
    action: 'purchase_prompt',
    allowedRoles: ['buyer', 'admin'],
    requiredPermissions: ['purchase_prompts'],
  },
  unlock_prompt: {
    action: 'unlock_prompt',
    allowedRoles: ['buyer', 'admin'],
    requiredPermissions: ['access_unlocked_content'],
    requiresOwner: true,
  },
  update_prompt: {
    action: 'update_prompt',
    allowedRoles: ['creator', 'admin'],
    requiredPermissions: ['edit_own_prompts'],
    requiresOwner: true,
    adminOverride: true,
  },
  transfer_ownership: {
    action: 'transfer_ownership',
    allowedRoles: ['creator', 'admin'],
    requiredPermissions: ['edit_own_prompts'],
    requiresOwner: true,
    adminOverride: true,
  },
  admin_moderate_prompt: {
    action: 'admin_moderate_prompt',
    allowedRoles: ['admin', 'moderator'],
    requiredPermissions: ['moderate_content'],
  },
  admin_manage_roles: {
    action: 'admin_manage_roles',
    allowedRoles: ['admin'],
    requiredPermissions: ['manage_roles'],
  },
};

export interface PromptAuthorizationInput {
  actor: AuthContext | null;
  action: PromptAction;
  // Owner of the prompt being acted on. Omit for actions that have no owner.
  resourceOwnerId?: string;
  // Optional role from the database to detect stale-role sessions.
  persistedRole?: UserRole;
}

export type PromptAuthorizationResult =
  | { allowed: true }
  | {
      allowed: false;
      status: 401 | 403;
      // Stable code for clients and tests; never leaks roles or permissions.
      reason:
        | 'unauthenticated'
        | 'role_not_allowed'
        | 'missing_permission'
        | 'not_resource_owner'
        | 'stale_role';
    };

export const authorizePromptAction = (
  input: PromptAuthorizationInput
): PromptAuthorizationResult => {
  const { actor, action, resourceOwnerId, persistedRole } = input;
  const rule = PROMPT_AUTHORIZATION_MATRIX[action];

  if (!rule) {
    return { allowed: false, status: 403, reason: 'role_not_allowed' };
  }

  if (!actor) {
    return { allowed: false, status: 401, reason: 'unauthenticated' };
  }

  // Stale-role detection: the session role must match the persisted role.
  if (persistedRole && persistedRole !== actor.role) {
    return { allowed: false, status: 403, reason: 'stale_role' };
  }

  if (!rule.allowedRoles.includes(actor.role)) {
    return { allowed: false, status: 403, reason: 'role_not_allowed' };
  }

  const hasAllPermissions = rule.requiredPermissions.every(p => actor.permissions.has(p));
  if (!hasAllPermissions) {
    return { allowed: false, status: 403, reason: 'missing_permission' };
  }

  if (rule.requiresOwner) {
    const isAdminOverride = rule.adminOverride && actor.role === 'admin';
    const isOwner = !!resourceOwnerId && resourceOwnerId === actor.userId;
    if (!isAdminOverride && !isOwner) {
      return { allowed: false, status: 403, reason: 'not_resource_owner' };
    }
  }

  return { allowed: true };
};

export const requirePromptAuthorization = (
  action: PromptAction,
  ownerResolver?: (req: Request) => string | undefined,
  persistedRoleResolver?: (req: Request) => UserRole | undefined
) => {
  return (req: Request, res: Response, next: NextFunction) => {
    const result = authorizePromptAction({
      actor: req.auth ?? null,
      action,
      resourceOwnerId: ownerResolver ? ownerResolver(req) : undefined,
      persistedRole: persistedRoleResolver ? persistedRoleResolver(req) : undefined,
    });

    if (!result.allowed) {
      return res.status(result.status).json({ error: 'Forbidden' });
    }

    next();
  };
};
