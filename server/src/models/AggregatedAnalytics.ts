/**
 * Aggregated Analytics Model
 * 
 * Stores privacy-safe aggregated metrics without raw sensitive data.
 */

import mongoose, { Schema, Document } from 'mongoose';

export interface IAggregatedAnalytics extends Document {
  eventType: string;
  timeWindow: Date;
  granularity: 'hour' | 'day';
  
  dimensions: Record<string, string>;
  
  metricName: string;
  metricType: 'count' | 'sum' | 'avg' | 'min' | 'max' | 'p50' | 'p95' | 'p99';
  value: number;
  count: number;
  
  expiresAt: Date;
  createdAt: Date;
  updatedAt: Date;
}

const AggregatedAnalyticsSchema = new Schema<IAggregatedAnalytics>(
  {
    eventType: {
      type: String,
      required: true,
      index: true,
    },
    timeWindow: {
      type: Date,
      required: true,
      index: true,
    },
    granularity: {
      type: String,
      required: true,
      enum: ['hour', 'day'],
      default: 'hour',
    },
    
    dimensions: {
      type: Schema.Types.Mixed,
      required: true,
      default: {},
    },
    
    metricName: {
      type: String,
      required: true,
      index: true,
    },
    metricType: {
      type: String,
      required: true,
      enum: ['count', 'sum', 'avg', 'min', 'max', 'p50', 'p95', 'p99'],
      default: 'count',
    },
    value: {
      type: Number,
      required: true,
    },
    count: {
      type: Number,
      required: true,
      default: 1,
    },
    
    expiresAt: {
      type: Date,
      required: true,
      index: true,
    },
  },
  {
    timestamps: true,
  }
);

// Compound indexes for common queries
AggregatedAnalyticsSchema.index({ eventType: 1, timeWindow: 1, metricName: 1 });
AggregatedAnalyticsSchema.index({ eventType: 1, 'dimensions.category': 1, timeWindow: 1 });

// TTL index for automatic cleanup
AggregatedAnalyticsSchema.index({ expiresAt: 1 }, { expireAfterSeconds: 0 });

// Static method: Query metrics
AggregatedAnalyticsSchema.statics.queryMetrics = async function(
  eventType: string,
  metricName: string,
  startTime: Date,
  endTime: Date,
  dimensions?: Record<string, string>
) {
  const query: any = {
    eventType,
    metricName,
    timeWindow: { $gte: startTime, $lte: endTime },
  };
  
  if (dimensions) {
    for (const [key, value] of Object.entries(dimensions)) {
      query[`dimensions.${key}`] = value;
    }
  }
  
  return this.find(query).sort({ timeWindow: 1 }).lean();
};

// Static method: Get summary stats
AggregatedAnalyticsSchema.statics.getSummaryStats = async function(
  eventType: string,
  startTime: Date,
  endTime: Date
) {
  const metrics = await this.find({
    eventType,
    timeWindow: { $gte: startTime, $lte: endTime },
  }).lean();
  
  const byMetric: Record<string, { total: number; count: number; avg: number }> = {};
  
  for (const metric of metrics) {
    if (!byMetric[metric.metricName]) {
      byMetric[metric.metricName] = { total: 0, count: 0, avg: 0 };
    }
    
    byMetric[metric.metricName].total += metric.value;
    byMetric[metric.metricName].count += metric.count;
  }
  
  for (const name in byMetric) {
    byMetric[name].avg = byMetric[name].total / byMetric[name].count;
  }
  
  return byMetric;
};

export default mongoose.model<IAggregatedAnalytics>(
  'AggregatedAnalytics',
  AggregatedAnalyticsSchema
);
