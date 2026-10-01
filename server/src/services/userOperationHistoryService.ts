export interface OperationEventInput {
  id: string;
  userId: string;
  eventType: string;
  timestamp: string;
  status: "success" | "pending" | "failed";
  summary: string;
  metadata?: Record<string, unknown>;
  isInternalOnly?: boolean;
  isDeleted?: boolean;
}

export interface UserOperationRecord {
  id: string;
  eventType: string;
  timestamp: string;
  status: "success" | "pending" | "failed";
  summary: string;
  metadata?: Record<string, unknown>;
}

export interface HistoryQueryOptions {
  userId: string;
  callingUserId: string;
  page?: number;
  limit?: number;
  eventType?: string;
  status?: string;
}

export interface PaginatedOperationHistory {
  operations: UserOperationRecord[];
  pagination: {
    total: number;
    page: number;
    limit: number;
    totalPages: number;
  };
}

const INTERNAL_EVENT_TYPES = new Set([
  "MAINTAINER_FLAG",
  "SYSTEM_HEALTH_CHECK",
  "ADMIN_OVERRIDE",
  "INTERNAL_AUDIT",
]);

const INTERNAL_METADATA_KEYS = new Set([
  "internalFlagReason",
  "maintainerNote",
  "internalNodeIp",
  "encryptionIv",
  "masterSeed",
  "adminToken",
  "databaseId",
  "rawQuery",
  "stackTrace",
]);

export function redactInternalMetadata(metadata?: Record<string, unknown>): Record<string, unknown> | undefined {
  if (!metadata) return undefined;
  const sanitized: Record<string, unknown> = {};

  for (const [key, value] of Object.entries(metadata)) {
    if (INTERNAL_METADATA_KEYS.has(key)) {
      continue; // Strip internal-only fields completely
    }
    if (typeof value === "object" && value !== null && !Array.isArray(value)) {
      sanitized[key] = redactInternalMetadata(value as Record<string, unknown>);
    } else {
      sanitized[key] = value;
    }
  }

  return sanitized;
}

export class UserOperationHistoryService {
  private static eventsStore: OperationEventInput[] = [];

  public static seedEvents(events: OperationEventInput[]): void {
    this.eventsStore = [...events];
  }

  public static clearEvents(): void {
    this.eventsStore = [];
  }

  public static addEvent(event: OperationEventInput): void {
    this.eventsStore.push(event);
  }

  public static getUserOperationHistory(options: HistoryQueryOptions): PaginatedOperationHistory {
    const { userId, callingUserId, page = 1, limit = 10, eventType, status } = options;

    // 1. Authorization check: Users see ONLY their own authorized operation history
    if (userId !== callingUserId) {
      throw new Error("Unauthorized: Users can only view their own operation history.");
    }

    // 2. Filter events
    const filtered = this.eventsStore.filter((event) => {
      // Must match target user
      if (event.userId !== userId) return false;

      // Filter out internal-only events
      if (event.isInternalOnly || INTERNAL_EVENT_TYPES.has(event.eventType)) {
        return false;
      }

      // Filter out deleted records
      if (event.isDeleted) {
        return false;
      }

      // Event type filter if specified
      if (eventType && event.eventType !== eventType) {
        return false;
      }

      // Status filter if specified
      if (status && event.status !== status) {
        return false;
      }

      return true;
    });

    // Sort by timestamp descending
    filtered.sort((a, b) => new Date(b.timestamp).getTime() - new Date(a.timestamp).getTime());

    // 3. Stable Pagination
    const total = filtered.length;
    const totalPages = Math.ceil(total / limit) || 1;
    const currentPage = Math.max(1, Math.min(page, totalPages));
    const startIndex = (currentPage - 1) * limit;
    const paginatedEvents = filtered.slice(startIndex, startIndex + limit);

    // 4. Redact internal metadata
    const operations: UserOperationRecord[] = paginatedEvents.map((e) => ({
      id: e.id,
      eventType: e.eventType,
      timestamp: e.timestamp,
      status: e.status,
      summary: e.summary,
      metadata: redactInternalMetadata(e.metadata),
    }));

    return {
      operations,
      pagination: {
        total,
        page: currentPage,
        limit,
        totalPages,
      },
    };
  }
}
