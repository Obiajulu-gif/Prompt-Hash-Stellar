/**
 * Activity Timeline service — privacy-aware event filtering (#838).
 *
 * Provides paginated, visibility-filtered timeline queries.
 */

import TimelineEvent, {
  type TimelineEventType,
  type TimelineVisibility,
} from "../models/TimelineEvent";

export class TimelineService {
  /**
   * Record a timeline event.
   */
  static async record(params: {
    eventType: TimelineEventType;
    visibility: TimelineVisibility;
    actorWallet?: string;
    recipientWallet: string;
    resourceType: string;
    resourceId?: string;
    summary: string;
    metadata?: Record<string, unknown>;
  }) {
    const event = new TimelineEvent(params);
    await event.save();
    return event;
  }

  /**
   * Get a user's timeline with privacy-aware filtering.
   * Maintainer-only events are excluded unless `includeMaintainer` is true.
   */
  static async getTimeline(params: {
    wallet: string;
    limit?: number;
    cursor?: string;
    includeMaintainer?: boolean;
    eventTypes?: TimelineEventType[];
  }) {
    const {
      wallet,
      limit = 20,
      cursor,
      includeMaintainer = false,
      eventTypes,
    } = params;

    const visibilityFilter: TimelineVisibility[] = ["public"];
    if (includeMaintainer) {
      visibilityFilter.push("maintainer");
    }

    const query: any = {
      recipientWallet: wallet.toLowerCase(),
      visibility: { $in: visibilityFilter },
    };

    if (eventTypes?.length) {
      query.eventType = { $in: eventTypes };
    }

    if (cursor) {
      query._id = { $lt: cursor };
    }

    const results = await TimelineEvent.find(query)
      .sort({ createdAt: -1 })
      .limit(limit + 1);

    let hasNextPage = false;
    let nextCursor = null;

    if (results.length > limit) {
      hasNextPage = true;
      results.pop();
      nextCursor = results[results.length - 1]._id;
    }

    return { data: results, metadata: { hasNextPage, nextCursor } };
  }

  /**
   * Get timeline for a specific resource (e.g., all events for a prompt).
   */
  static async getResourceTimeline(params: {
    resourceType: string;
    resourceId: string;
    limit?: number;
    cursor?: string;
  }) {
    const { resourceType, resourceId, limit = 20, cursor } = params;

    const query: any = {
      resourceType,
      resourceId,
      visibility: { $in: ["public"] },
    };

    if (cursor) {
      query._id = { $lt: cursor };
    }

    const results = await TimelineEvent.find(query)
      .sort({ createdAt: -1 })
      .limit(limit + 1);

    let hasNextPage = false;
    let nextCursor = null;

    if (results.length > limit) {
      hasNextPage = true;
      results.pop();
      nextCursor = results[results.length - 1]._id;
    }

    return { data: results, metadata: { hasNextPage, nextCursor } };
  }
}
