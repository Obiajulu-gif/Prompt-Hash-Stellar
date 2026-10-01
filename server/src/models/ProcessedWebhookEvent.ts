/**
 * Processed Webhook Event Model
 * 
 * Tracks processed webhook event IDs for replay protection.
 * Records automatically expire after TTL.
 */

import mongoose, { Schema, Document } from 'mongoose';

export interface IProcessedWebhookEvent extends Document {
  eventId: string;
  processedAt: Date;
  expiresAt: Date;
  eventType?: string;
  source?: string;
}

const ProcessedWebhookEventSchema = new Schema<IProcessedWebhookEvent>(
  {
    eventId: {
      type: String,
      required: true,
      unique: true,
      index: true,
    },
    processedAt: {
      type: Date,
      required: true,
      default: Date.now,
    },
    expiresAt: {
      type: Date,
      required: true,
      index: true,
    },
    eventType: {
      type: String,
    },
    source: {
      type: String,
    },
  },
  {
    timestamps: false,
  }
);

// TTL index - MongoDB will automatically delete expired documents
ProcessedWebhookEventSchema.index({ expiresAt: 1 }, { expireAfterSeconds: 0 });

export default mongoose.model<IProcessedWebhookEvent>(
  'ProcessedWebhookEvent',
  ProcessedWebhookEventSchema
);
