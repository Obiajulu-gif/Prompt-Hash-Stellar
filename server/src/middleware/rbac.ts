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

declare global {
  namespace Express {
    interface Request {
      auth?: AuthContext;
    }
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
      return res.status(403).json({ error: `Missing permission: ${permission}` });
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
      return res.status(403).json({ error: `Missing permission: ${requiredPermission}` });
    }

    if (!contextResolver(req)) {
      return res.status(403).json({ error: 'Access denied for this resource' });
    }

    next();
  };
};
