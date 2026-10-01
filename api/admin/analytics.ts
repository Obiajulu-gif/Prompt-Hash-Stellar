/**
 * Analytics API
 * 
 * Provides privacy-safe aggregated analytics for maintainers.
 * No raw sensitive data is exposed.
 */

import type { VercelRequest, VercelResponse } from '@vercel/node';
import connectDb from '../../server/src/db/connectDb';
import AggregatedAnalytics from '../../server/src/models/AggregatedAnalytics';
import { apiError, ErrorCode } from '../../src/lib/api/errorCodes';

function requireAdmin(req: VercelRequest): boolean {
  const adminToken = process.env.ADMIN_ANALYTICS_TOKEN;
  if (!adminToken) {
    console.warn('ADMIN_ANALYTICS_TOKEN not configured - analytics API is unprotected');
    return true;
  }
  
  const authHeader = req.headers.authorization;
  return authHeader === `Bearer ${adminToken}`;
}

function parseTimeRange(req: VercelRequest): { startTime: Date; endTime: Date } {
  const now = new Date();
  const defaultStart = new Date(now.getTime() - 7 * 24 * 60 * 60 * 1000); // 7 days ago
  
  const startTime = req.query.startTime 
    ? new Date(String(req.query.startTime))
    : defaultStart;
  
  const endTime = req.query.endTime
    ? new Date(String(req.query.endTime))
    : now;
  
  return { startTime, endTime };
}

export default async function handler(req: VercelRequest, res: VercelResponse) {
  // Admin authentication
  if (!requireAdmin(req)) {
    return res.status(401).json(
      apiError(ErrorCode.UNAUTHORIZED, 'Admin authentication required')
    );
  }
  
  await connectDb();
  
  // GET: Query aggregated metrics
  if (req.method === 'GET') {
    const { startTime, endTime } = parseTimeRange(req);
    const eventType = req.query.eventType ? String(req.query.eventType) : undefined;
    const metricName = req.query.metricName ? String(req.query.metricName) : undefined;
    
    // Get summary if no specific metric requested
    if (!eventType && !metricName) {
      const unlockStats = await AggregatedAnalytics.getSummaryStats(
        'unlock_attempt',
        startTime,
        endTime
      );
      
      const purchaseStats = await AggregatedAnalytics.getSummaryStats(
        'purchase_attempt',
        startTime,
        endTime
      );
      
      const webhookStats = await AggregatedAnalytics.getSummaryStats(
        'webhook_delivery',
        startTime,
        endTime
      );
      
      return res.status(200).json({
        timeRange: { startTime, endTime },
        summary: {
          unlocks: unlockStats,
          purchases: purchaseStats,
          webhooks: webhookStats,
        },
      });
    }
    
    // Query specific metrics
    if (!eventType || !metricName) {
      return res.status(400).json(
        apiError(ErrorCode.MISSING_FIELDS, 'Both eventType and metricName are required for specific queries')
      );
    }
    
    const dimensions: Record<string, string> = {};
    if (req.query.category) dimensions.category = String(req.query.category);
    if (req.query.statusCode) dimensions.statusCode = String(req.query.statusCode);
    
    const metrics = await AggregatedAnalytics.queryMetrics(
      eventType,
      metricName,
      startTime,
      endTime,
      Object.keys(dimensions).length > 0 ? dimensions : undefined
    );
    
    return res.status(200).json({
      eventType,
      metricName,
      timeRange: { startTime, endTime },
      dimensions,
      data: metrics,
    });
  }
  
  // POST: Store aggregated metrics (from background job)
  if (req.method === 'POST') {
    const { metrics } = req.body;
    
    if (!Array.isArray(metrics) || metrics.length === 0) {
      return res.status(400).json(
        apiError(ErrorCode.VALIDATION_ERROR, 'metrics array is required')
      );
    }
    
    // Validate and store each metric
    const stored = [];
    
    for (const metric of metrics) {
      if (!metric.eventType || !metric.metricName || !metric.timeWindow) {
        continue;
      }
      
      // Set expiration based on retention policy (90 days)
      const expiresAt = new Date(metric.timeWindow);
      expiresAt.setDate(expiresAt.getDate() + 90);
      
      const doc = await AggregatedAnalytics.create({
        eventType: metric.eventType,
        timeWindow: new Date(metric.timeWindow),
        granularity: metric.granularity || 'hour',
        dimensions: metric.dimensions || {},
        metricName: metric.metricName,
        metricType: metric.metricType || 'count',
        value: metric.value,
        count: metric.count || 1,
        expiresAt,
      });
      
      stored.push(doc._id);
    }
    
    return res.status(201).json({
      message: `Stored ${stored.length} metrics`,
      storedIds: stored,
    });
  }
  
  return res.status(405).json(
    apiError(ErrorCode.METHOD_NOT_ALLOWED, 'Method not allowed')
  );
}
