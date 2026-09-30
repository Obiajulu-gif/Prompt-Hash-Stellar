/**
 * Operations Dashboard API
 * 
 * Provides visibility into partial failures, stuck operations, and external system issues.
 * Requires admin authentication.
 */

import type { VercelRequest, VercelResponse } from '@vercel/node';
import connectDb from '../../server/src/db/connectDb';
import OperationFailure from '../../server/src/models/OperationFailure';
import { apiError, ErrorCode } from '../../src/lib/api/errorCodes';

interface DashboardFilters {
  operationType?: string;
  severity?: string;
  retryStatus?: string;
  requiresManualIntervention?: boolean;
  isStale?: boolean;
  limit?: number;
  offset?: number;
}

function requireAdmin(req: VercelRequest): boolean {
  const adminToken = process.env.ADMIN_OPERATIONS_TOKEN;
  if (!adminToken) {
    // If no token is configured, allow access (dev mode)
    console.warn('ADMIN_OPERATIONS_TOKEN not configured - operations dashboard is unprotected');
    return true;
  }
  
  const authHeader = req.headers.authorization;
  return authHeader === `Bearer ${adminToken}`;
}

function parseFilters(query: VercelRequest['query']): DashboardFilters {
  return {
    operationType: query.operationType ? String(query.operationType) : undefined,
    severity: query.severity ? String(query.severity) : undefined,
    retryStatus: query.retryStatus ? String(query.retryStatus) : undefined,
    requiresManualIntervention: query.requiresManualIntervention === 'true',
    isStale: query.isStale === 'true',
    limit: query.limit ? parseInt(String(query.limit), 10) : 50,
    offset: query.offset ? parseInt(String(query.offset), 10) : 0,
  };
}

function sanitizeFailureForResponse(failure: any) {
  const sanitized = failure.toObject();
  
  // Redact sensitive data from error details
  if (sanitized.errorDetails) {
    const redacted = { ...sanitized.errorDetails };
    
    // Remove common sensitive fields
    delete redacted.privateKey;
    delete redacted.secret;
    delete redacted.apiKey;
    delete redacted.password;
    delete redacted.token;
    
    // Truncate long values
    Object.keys(redacted).forEach(key => {
      if (typeof redacted[key] === 'string' && redacted[key].length > 500) {
        redacted[key] = redacted[key].substring(0, 500) + '... [truncated]';
      }
    });
    
    sanitized.errorDetails = redacted;
  }
  
  // Add computed fields
  sanitized.ageInHours = failure.ageInHours;
  sanitized.isStale = failure.isStale;
  
  return sanitized;
}

export default async function handler(req: VercelRequest, res: VercelResponse) {
  // Admin authentication
  if (!requireAdmin(req)) {
    return res.status(401).json(
      apiError(ErrorCode.UNAUTHORIZED, 'Admin authentication required')
    );
  }
  
  await connectDb();
  
  // GET: List failures with filters
  if (req.method === 'GET') {
    const filters = parseFilters(req.query);
    
    // Build query
    const query: any = { resolvedAt: null }; // Only show unresolved by default
    
    if (req.query.includeResolved === 'true') {
      delete query.resolvedAt;
    }
    
    if (filters.operationType) {
      query.operationType = filters.operationType;
    }
    
    if (filters.severity) {
      query.severity = filters.severity;
    }
    
    if (filters.retryStatus) {
      query.retryStatus = filters.retryStatus;
    }
    
    if (filters.requiresManualIntervention) {
      query.requiresManualIntervention = true;
    }
    
    if (filters.isStale) {
      const staleThreshold = new Date();
      staleThreshold.setHours(staleThreshold.getHours() - 24);
      query.firstFailedAt = { $lt: staleThreshold };
    }
    
    // Execute query
    const failures = await OperationFailure.find(query)
      .sort({ severity: -1, firstFailedAt: 1 })
      .limit(filters.limit || 50)
      .skip(filters.offset || 0)
      .lean();
    
    const total = await OperationFailure.countDocuments(query);
    
    // Get summary stats
    const summary = await OperationFailure.getDashboardSummary();
    
    return res.status(200).json({
      summary,
      failures: failures.map(f => sanitizeFailureForResponse({ toObject: () => f, ...f })),
      pagination: {
        total,
        limit: filters.limit,
        offset: filters.offset,
        hasMore: (filters.offset || 0) + failures.length < total,
      },
    });
  }
  
  // POST: Retry a specific failure
  if (req.method === 'POST' && req.query.action === 'retry') {
    const { failureId } = req.body;
    
    if (!failureId) {
      return res.status(400).json(
        apiError(ErrorCode.MISSING_FIELDS, 'failureId is required')
      );
    }
    
    const failure = await OperationFailure.findById(failureId);
    
    if (!failure) {
      return res.status(404).json(
        apiError(ErrorCode.NOT_FOUND, 'Failure record not found')
      );
    }
    
    if (!failure.isRetryable) {
      return res.status(400).json(
        apiError(ErrorCode.OPERATION_NOT_ALLOWED, 'This failure is not retryable')
      );
    }
    
    // Mark as retrying
    failure.retryStatus = 'retrying';
    await failure.save();
    
    // TODO: Trigger actual retry logic based on operationType
    // For now, just return the updated status
    
    return res.status(200).json({
      message: 'Retry initiated',
      failure: sanitizeFailureForResponse(failure),
    });
  }
  
  // POST: Mark failure as resolved
  if (req.method === 'POST' && req.query.action === 'resolve') {
    const { failureId, resolvedBy, notes } = req.body;
    
    if (!failureId || !resolvedBy || !notes) {
      return res.status(400).json(
        apiError(ErrorCode.MISSING_FIELDS, 'failureId, resolvedBy, and notes are required')
      );
    }
    
    const failure = await OperationFailure.findById(failureId);
    
    if (!failure) {
      return res.status(404).json(
        apiError(ErrorCode.NOT_FOUND, 'Failure record not found')
      );
    }
    
    await failure.resolve(resolvedBy, notes);
    
    return res.status(200).json({
      message: 'Failure marked as resolved',
      failure: sanitizeFailureForResponse(failure),
    });
  }
  
  // POST: Mark as requiring manual intervention
  if (req.method === 'POST' && req.query.action === 'manual-intervention') {
    const { failureId, reason } = req.body;
    
    if (!failureId || !reason) {
      return res.status(400).json(
        apiError(ErrorCode.MISSING_FIELDS, 'failureId and reason are required')
      );
    }
    
    const failure = await OperationFailure.findById(failureId);
    
    if (!failure) {
      return res.status(404).json(
        apiError(ErrorCode.NOT_FOUND, 'Failure record not found')
      );
    }
    
    await failure.requireManualIntervention(reason);
    
    return res.status(200).json({
      message: 'Marked as requiring manual intervention',
      failure: sanitizeFailureForResponse(failure),
    });
  }
  
  return res.status(405).json(
    apiError(ErrorCode.METHOD_NOT_ALLOWED, 'Method not allowed')
  );
}
