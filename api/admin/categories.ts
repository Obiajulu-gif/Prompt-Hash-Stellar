/**
 * Admin Category Management API (#xyz)
 * 
 * Protected endpoints for category CRUD and lifecycle management.
 * Requires admin authorization.
 */

import type { VercelRequest, VercelResponse } from '@vercel/node';
import { withObservability } from '../../src/lib/observability/wrapper';
import connectDb from '../../server/src/db/connectDb';
import {
  createCategory,
  renameCategory,
  mergeCategories,
  deprecateCategory,
  listActiveCategories,
  updateCategoryCount,
} from '../../server/src/services/categoryTaxonomyService';
import { apiError, ErrorCode } from '../../src/lib/api/errorCodes';

const ADMIN_WALLETS = (process.env.ADMIN_WALLETS || '')
  .split(',')
  .map((w) => w.trim().toLowerCase());

function isAuthorizedAdmin(wallet: string): boolean {
  return ADMIN_WALLETS.includes(wallet.toLowerCase());
}

export interface CategoryManagementRequest {
  action: 'create' | 'rename' | 'merge' | 'deprecate' | 'list' | 'update-count';
  adminWallet: string;
  categoryId?: string;
  slug?: string;
  displayName?: string;
  description?: string;
  newSlug?: string;
  newDisplayName?: string;
  fromCategoryId?: string;
  toCategoryId?: string;
  redirectToId?: string;
  reason?: string;
}

async function handler(req: VercelRequest, res: VercelResponse): Promise<void> {
  if (req.method !== 'POST') {
    res.status(405).json(apiError(ErrorCode.METHOD_NOT_ALLOWED, 'Method not allowed.'));
    return;
  }

  await connectDb();

  const {
    action,
    adminWallet,
    categoryId,
    slug,
    displayName,
    description,
    newSlug,
    newDisplayName,
    fromCategoryId,
    toCategoryId,
    redirectToId,
    reason,
  }: CategoryManagementRequest = req.body || {};

  // Verify admin authorization
  if (!adminWallet || !isAuthorizedAdmin(adminWallet)) {
    res.status(403).json(
      apiError(ErrorCode.UNAUTHORIZED, 'You are not authorized to manage categories.')
    );
    return;
  }

  try {
    switch (action) {
      case 'create': {
        if (!categoryId || !slug || !displayName) {
          res.status(400).json(
            apiError(
              ErrorCode.MISSING_FIELDS,
              'categoryId, slug, and displayName are required for create'
            )
          );
          return;
        }

        const created = await createCategory({
          categoryId,
          slug,
          displayName,
          description,
          adminWallet,
        });

        res.status(201).json({
          success: true,
          action: 'create',
          category: created,
        });
        break;
      }

      case 'rename': {
        if (!categoryId || !newSlug || !newDisplayName) {
          res.status(400).json(
            apiError(
              ErrorCode.MISSING_FIELDS,
              'categoryId, newSlug, and newDisplayName are required for rename'
            )
          );
          return;
        }

        const renamed = await renameCategory({
          categoryId,
          newSlug,
          newDisplayName,
          reason,
          adminWallet,
        });

        res.status(200).json({
          success: true,
          action: 'rename',
          category: renamed,
        });
        break;
      }

      case 'merge': {
        if (!fromCategoryId || !toCategoryId) {
          res.status(400).json(
            apiError(
              ErrorCode.MISSING_FIELDS,
              'fromCategoryId and toCategoryId are required for merge'
            )
          );
          return;
        }

        const result = await mergeCategories({
          fromCategoryId,
          toCategoryId,
          reason,
          adminWallet,
        });

        res.status(200).json({
          success: true,
          action: 'merge',
          promptsMoved: result.movedCount,
          category: result.category,
        });
        break;
      }

      case 'deprecate': {
        if (!categoryId) {
          res.status(400).json(
            apiError(ErrorCode.MISSING_FIELDS, 'categoryId is required for deprecate')
          );
          return;
        }

        const deprecated = await deprecateCategory({
          categoryId,
          redirectToId,
          reason,
          adminWallet,
        });

        res.status(200).json({
          success: true,
          action: 'deprecate',
          category: deprecated,
        });
        break;
      }

      case 'list': {
        const categories = await listActiveCategories();

        res.status(200).json({
          success: true,
          action: 'list',
          categories,
        });
        break;
      }

      case 'update-count': {
        if (!categoryId) {
          res.status(400).json(
            apiError(ErrorCode.MISSING_FIELDS, 'categoryId is required for update-count')
          );
          return;
        }

        const count = await updateCategoryCount(categoryId);

        res.status(200).json({
          success: true,
          action: 'update-count',
          categoryId,
          promptCount: count,
        });
        break;
      }

      default: {
        res.status(400).json(
          apiError(
            ErrorCode.MISSING_FIELDS,
            `Unknown action: ${action}. Valid actions: create, rename, merge, deprecate, list, update-count`
          )
        );
      }
    }
  } catch (error) {
    const message = error instanceof Error ? error.message : 'Category management failed.';
    req.logger?.error({ action, error: message }, 'Category management error');

    res.status(400).json(
      apiError(ErrorCode.TEMPORARY_FAILURE, message)
    );
  }
}

export default withObservability(handler, 'admin/categories');
