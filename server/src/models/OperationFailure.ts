/**
 * Operation Failure Model
 * 
 * Tracks partially completed operations and external system failures.
 * Used by operations dashboard for monitoring and remediation.
 */

import mongoose, { Schema, Document } from 'mongoose';

export type OperationType = 
  | 'prompt_purchase'
  | 'prompt_unlock'
  | 'webhook_delivery'
  | 'payment_settlement'
  | 'contract_write'
  | 'ipfs_upload'
  | 'encryption_operation';

export type FailureSeverity = 'low' | 'medium' | 'high' | 'critical';

export type RetryStatus = 'pending' | 'retrying' | 'max_retries_exceeded' | 'manual_intervention_required';

export interface IOperationFailure extends Document {
  operationType: OperationType;
  operationId: string;
  relatedResource: string; // promptId, walletAddress, etc.
  externalReferenceId?: string; // Transaction hash, webhook ID, etc.
  
  failureReason: string;
  errorCode?: string;
  errorDetails?: Record<string, unknown>;
  
  severity: FailureSeverity;
  retryStatus: RetryStatus;
  retryCount: number;
  maxRetries: number;
  
  isRetryable: boolean;
  requiresManualIntervention: boolean;
  
  firstFailedAt: Date;
  lastAttemptAt: Date;
  resolvedAt?: Date;
  resolvedBy?: string;
  resolutionNotes?: string;
  
  metadata: Record<string, unknown>;
  
  createdAt: Date;
  updatedAt: Date;
}

const OperationFailureSchema = new Schema<IOperationFailure>(
  {
    operationType: {
      type: String,
      required: true,
      enum: [
        'prompt_purchase',
        'prompt_unlock',
        'webhook_delivery',
        'payment_settlement',
        'contract_write',
        'ipfs_upload',
        'encryption_operation',
      ],
      index: true,
    },
    operationId: {
      type: String,
      required: true,
      index: true,
    },
    relatedResource: {
      type: String,
      required: true,
      index: true,
    },
    externalReferenceId: {
      type: String,
      index: true,
    },
    
    failureReason: {
      type: String,
      required: true,
    },
    errorCode: {
      type: String,
      index: true,
    },
    errorDetails: {
      type: Schema.Types.Mixed,
    },
    
    severity: {
      type: String,
      required: true,
      enum: ['low', 'medium', 'high', 'critical'],
      default: 'medium',
      index: true,
    },
    retryStatus: {
      type: String,
      required: true,
      enum: ['pending', 'retrying', 'max_retries_exceeded', 'manual_intervention_required'],
      default: 'pending',
      index: true,
    },
    retryCount: {
      type: Number,
      required: true,
      default: 0,
    },
    maxRetries: {
      type: Number,
      required: true,
      default: 3,
    },
    
    isRetryable: {
      type: Boolean,
      required: true,
      default: true,
    },
    requiresManualIntervention: {
      type: Boolean,
      required: true,
      default: false,
      index: true,
    },
    
    firstFailedAt: {
      type: Date,
      required: true,
      default: Date.now,
      index: true,
    },
    lastAttemptAt: {
      type: Date,
      required: true,
      default: Date.now,
    },
    resolvedAt: {
      type: Date,
      index: true,
    },
    resolvedBy: {
      type: String,
    },
    resolutionNotes: {
      type: String,
    },
    
    metadata: {
      type: Schema.Types.Mixed,
      default: {},
    },
  },
  {
    timestamps: true,
  }
);

// Compound indexes for dashboard queries
OperationFailureSchema.index({ operationType: 1, severity: 1, resolvedAt: 1 });
OperationFailureSchema.index({ retryStatus: 1, firstFailedAt: 1 });
OperationFailureSchema.index({ requiresManualIntervention: 1, resolvedAt: 1 });

// Classify failure age
OperationFailureSchema.virtual('ageInHours').get(function() {
  const now = new Date();
  const diff = now.getTime() - this.firstFailedAt.getTime();
  return Math.floor(diff / (1000 * 60 * 60));
});

// Check if stale (older than 24 hours)
OperationFailureSchema.virtual('isStale').get(function() {
  return this.ageInHours > 24;
});

// Instance method: Record retry attempt
OperationFailureSchema.methods.recordRetryAttempt = function(success: boolean, notes?: string) {
  this.retryCount += 1;
  this.lastAttemptAt = new Date();
  
  if (success) {
    this.resolvedAt = new Date();
    this.resolutionNotes = notes || 'Resolved via automatic retry';
    this.retryStatus = 'pending'; // Mark as resolved
  } else {
    if (this.retryCount >= this.maxRetries) {
      this.retryStatus = 'max_retries_exceeded';
      this.requiresManualIntervention = true;
    } else {
      this.retryStatus = 'pending';
    }
  }
  
  return this.save();
};

// Instance method: Mark as requiring manual intervention
OperationFailureSchema.methods.requireManualIntervention = function(reason: string) {
  this.requiresManualIntervention = true;
  this.retryStatus = 'manual_intervention_required';
  this.isRetryable = false;
  this.metadata.manualInterventionReason = reason;
  return this.save();
};

// Instance method: Resolve failure
OperationFailureSchema.methods.resolve = function(resolvedBy: string, notes: string) {
  this.resolvedAt = new Date();
  this.resolvedBy = resolvedBy;
  this.resolutionNotes = notes;
  return this.save();
};

// Static method: Get dashboard summary
OperationFailureSchema.statics.getDashboardSummary = async function() {
  const unresolvedCount = await this.countDocuments({ resolvedAt: null });
  const criticalCount = await this.countDocuments({ 
    severity: 'critical', 
    resolvedAt: null 
  });
  const manualInterventionCount = await this.countDocuments({ 
    requiresManualIntervention: true,
    resolvedAt: null 
  });
  
  const staleThreshold = new Date();
  staleThreshold.setHours(staleThreshold.getHours() - 24);
  const staleCount = await this.countDocuments({
    firstFailedAt: { $lt: staleThreshold },
    resolvedAt: null,
  });
  
  const byType = await this.aggregate([
    { $match: { resolvedAt: null } },
    { $group: { _id: '$operationType', count: { $sum: 1 } } },
  ]);
  
  const bySeverity = await this.aggregate([
    { $match: { resolvedAt: null } },
    { $group: { _id: '$severity', count: { $sum: 1 } } },
  ]);
  
  return {
    unresolvedCount,
    criticalCount,
    manualInterventionCount,
    staleCount,
    byType: Object.fromEntries(byType.map(t => [t._id, t.count])),
    bySeverity: Object.fromEntries(bySeverity.map(s => [s._id, s.count])),
  };
};

export default mongoose.model<IOperationFailure>('OperationFailure', OperationFailureSchema);
