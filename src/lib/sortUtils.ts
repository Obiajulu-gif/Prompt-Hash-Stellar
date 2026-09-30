export const STATUS_PRECEDENCE: Record<string, number> = {
  Active: 1,
  Draft: 2,
  Paused: 3,
  Restricted: 4,
  Retired: 5,
};

export interface SortableRecord {
  status?: string;
  createdAt?: string | number | Date;
  id?: string | number | bigint;
}

/**
 * Deterministically sorts a list of records containing mixed statuses.
 * Precedence:
 * 1. Status Precedence (Active > Draft > Paused > Restricted > Retired)
 * 2. Timestamp (Newest first)
 * 3. Tie-breaker (Lexicographical ID comparison)
 */
export function deterministicSortComparator<T extends SortableRecord>(a: T, b: T): number {
  // 1. Status Precedence
  const aStatus = a.status || "Unknown";
  const bStatus = b.status || "Unknown";
  
  const aRank = STATUS_PRECEDENCE[aStatus] ?? 99;
  const bRank = STATUS_PRECEDENCE[bStatus] ?? 99;

  if (aRank !== bRank) {
    return aRank - bRank;
  }

  // 2. Timestamp (Newest first)
  const aTime = a.createdAt ? new Date(a.createdAt).getTime() : 0;
  const bTime = b.createdAt ? new Date(b.createdAt).getTime() : 0;

  if (aTime !== bTime) {
    return bTime - aTime;
  }

  // 3. Tie-breaker
  const aId = String(a.id ?? "");
  const bId = String(b.id ?? "");
  return aId.localeCompare(bId);
}

export function sortDeterministically<T extends SortableRecord>(records: T[]): T[] {
  return [...records].sort(deterministicSortComparator);
}
