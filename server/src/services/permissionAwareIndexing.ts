/**
 * Permission-Aware Search Indexing
 *
 * Ensures search and discovery indexes respect record visibility
 * and repair stale entries when records are hidden, deleted, or permission-scoped.
 */

export enum VisibilityScope {
  /** Visible to everyone in search results */
  PUBLIC = "public",
  /** Visible only to authenticated users */
  AUTHENTICATED = "authenticated",
  /** Visible only to the owner */
  PRIVATE = "private",
  /** Hidden from search (record exists but not discoverable) */
  HIDDEN = "hidden",
  /** Record is deleted */
  DELETED = "deleted",
}

export interface IndexedRecord {
  id: string;
  title: string;
  description: string;
  visibilityScope: VisibilityScope;
  ownerId: string;
  createdAt: Date;
  updatedAt: Date;
  tags: string[];
  indexed: boolean;
  indexedAt?: Date;
}

export interface PermissionContext {
  userId?: string;
  isAuthenticated: boolean;
  isAdmin: boolean;
}

/**
 * Determine if a record should be visible to a user based on visibility scope and ownership.
 */
export function canViewRecord(
  record: IndexedRecord,
  context: PermissionContext
): boolean {
  switch (record.visibilityScope) {
    case VisibilityScope.PUBLIC:
      return true;

    case VisibilityScope.AUTHENTICATED:
      return context.isAuthenticated;

    case VisibilityScope.PRIVATE:
      return context.userId === record.ownerId || context.isAdmin;

    case VisibilityScope.HIDDEN:
    case VisibilityScope.DELETED:
      // Only owner or admin can see hidden/deleted records (for audit)
      return context.userId === record.ownerId || context.isAdmin;

    default:
      return false;
  }
}

/**
 * Filter search results based on user permissions.
 */
export function filterByPermissions(
  records: IndexedRecord[],
  context: PermissionContext
): IndexedRecord[] {
  return records.filter((record) => canViewRecord(record, context));
}

/**
 * Identify stale or broken index entries.
 */
export interface IndexRepairIssue {
  recordId: string;
  issue: string;
  severity: "low" | "medium" | "high";
  action: string;
}

export function detectStaleness(
  record: IndexedRecord,
  options?: {
    maxStaleDays?: number;
    requireLatestUpdate?: boolean;
  }
): IndexRepairIssue | null {
  const maxStaleDays = options?.maxStaleDays ?? 30;
  const now = new Date();
  const staleDays =
    (now.getTime() - (record.indexedAt?.getTime() ?? 0)) / (1000 * 60 * 60 * 24);

  if (staleDays > maxStaleDays) {
    return {
      recordId: record.id,
      issue: `Index record is ${staleDays.toFixed(1)} days stale`,
      severity: "medium",
      action: "re-index",
    };
  }

  if (record.visibilityScope === VisibilityScope.DELETED && record.indexed) {
    return {
      recordId: record.id,
      issue: "Deleted record still in index",
      severity: "high",
      action: "remove-from-index",
    };
  }

  if (record.visibilityScope === VisibilityScope.HIDDEN && record.indexed) {
    return {
      recordId: record.id,
      issue: "Hidden record still in index",
      severity: "high",
      action: "remove-from-index",
    };
  }

  if (!record.indexed && record.visibilityScope === VisibilityScope.PUBLIC) {
    return {
      recordId: record.id,
      issue: "Public record missing from index",
      severity: "high",
      action: "re-index",
    };
  }

  return null;
}

/**
 * Repair a stale or broken index entry.
 */
export function repairIndexEntry(
  record: IndexedRecord,
  issue: IndexRepairIssue
): IndexedRecord {
  if (issue.action === "remove-from-index") {
    return {
      ...record,
      indexed: false,
      indexedAt: undefined,
    };
  }

  if (issue.action === "re-index") {
    return {
      ...record,
      indexed: true,
      indexedAt: new Date(),
    };
  }

  return record;
}

/**
 * Batch repair multiple records.
 */
export interface RepairReport {
  totalScanned: number;
  issuesFound: number;
  issuesFixed: number;
  details: IndexRepairIssue[];
}

export function batchRepairIndex(
  records: IndexedRecord[],
  options?: {
    maxStaleDays?: number;
    autoFix?: boolean;
  }
): { repairedRecords: IndexedRecord[]; report: RepairReport } {
  const issues: IndexRepairIssue[] = [];
  const repairedRecords: IndexedRecord[] = [];

  for (const record of records) {
    const issue = detectStaleness(record, {
      maxStaleDays: options?.maxStaleDays,
    });

    if (issue) {
      issues.push(issue);
      if (options?.autoFix) {
        repairedRecords.push(repairIndexEntry(record, issue));
      } else {
        repairedRecords.push(record);
      }
    } else {
      repairedRecords.push(record);
    }
  }

  return {
    repairedRecords,
    report: {
      totalScanned: records.length,
      issuesFound: issues.length,
      issuesFixed: options?.autoFix ? issues.length : 0,
      details: issues,
    },
  };
}

/**
 * Hook to run when visibility changes (e.g., record hidden or deleted).
 * Call this to update index when record state changes.
 */
export function onVisibilityChange(
  record: IndexedRecord,
  newVisibility: VisibilityScope
): IndexedRecord {
  const updated = { ...record, visibilityScope: newVisibility };

  // Auto-remove from index if hidden or deleted
  if (
    newVisibility === VisibilityScope.HIDDEN ||
    newVisibility === VisibilityScope.DELETED
  ) {
    updated.indexed = false;
  }

  // Auto-index if now public and was previously indexed
  if (newVisibility === VisibilityScope.PUBLIC) {
    updated.indexed = true;
    updated.indexedAt = new Date();
  }

  return updated;
}
