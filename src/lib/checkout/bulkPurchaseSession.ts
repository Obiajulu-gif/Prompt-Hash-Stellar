/**
 * Bulk purchase session tracking and recovery (#733)
 *
 * Provides deterministic recovery for bulk purchase operations that fail
 * mid-flight due to wallet signing interruptions or partial completions.
 */

export interface BulkPurchaseItem {
  promptId: number;
  paymentAmount: number;
  status: "pending" | "completed" | "failed";
  error?: string;
  transactionHash?: string;
}

export interface BulkPurchaseSession {
  /** Stable session ID for idempotent retry operations */
  sessionId: string;
  /** Buyer wallet address */
  buyer: string;
  /** Timestamp when session was created (ms since epoch) */
  createdAt: number;
  /** Individual prompt purchase attempts */
  items: BulkPurchaseItem[];
  /** Overall session status */
  status: "active" | "completed" | "partial" | "failed";
  /** Last updated timestamp */
  updatedAt: number;
}

const SESSION_STORAGE_KEY = "prompt-hash:bulk-purchase-sessions";
const SESSION_EXPIRY_MS = 24 * 60 * 60 * 1000; // 24 hours

/** Generate a stable session ID */
export function generateSessionId(buyer: string, promptIds: number[]): string {
  const timestamp = Date.now();
  const idsHash = promptIds.sort().join("-");
  return `bulk-${buyer.slice(0, 8)}-${idsHash.slice(0, 16)}-${timestamp}`;
}

/** Create a new bulk purchase session */
export function createBulkPurchaseSession(
  buyer: string,
  promptIds: number[],
  paymentAmounts: number[],
): BulkPurchaseSession {
  const now = Date.now();
  const sessionId = generateSessionId(buyer, promptIds);

  const items: BulkPurchaseItem[] = promptIds.map((promptId, index) => ({
    promptId,
    paymentAmount: paymentAmounts[index] ?? 0,
    status: "pending" as const,
  }));

  const session: BulkPurchaseSession = {
    sessionId,
    buyer,
    createdAt: now,
    items,
    status: "active",
    updatedAt: now,
  };

  saveBulkPurchaseSession(session);
  return session;
}

/** Save session to localStorage */
function saveBulkPurchaseSession(session: BulkPurchaseSession): void {
  try {
    const sessions = getAllSessions();
    sessions[session.sessionId] = session;
    localStorage.setItem(SESSION_STORAGE_KEY, JSON.stringify(sessions));
  } catch (error) {
    console.error("Failed to save bulk purchase session:", error);
  }
}

/** Get all active sessions */
function getAllSessions(): Record<string, BulkPurchaseSession> {
  try {
    const raw = localStorage.getItem(SESSION_STORAGE_KEY);
    if (!raw) return {};
    const sessions = JSON.parse(raw) as Record<string, BulkPurchaseSession>;

    // Clean up expired sessions
    const now = Date.now();
    const active: Record<string, BulkPurchaseSession> = {};
    Object.entries(sessions).forEach(([id, session]) => {
      if (now - session.createdAt < SESSION_EXPIRY_MS) {
        active[id] = session;
      }
    });

    return active;
  } catch {
    return {};
  }
}

/** Get a specific session by ID */
export function getBulkPurchaseSession(
  sessionId: string,
): BulkPurchaseSession | null {
  const sessions = getAllSessions();
  return sessions[sessionId] ?? null;
}

/** Get pending items from a session (for retry) */
export function getPendingItems(
  session: BulkPurchaseSession,
): BulkPurchaseItem[] {
  return session.items.filter((item) => item.status === "pending");
}

/** Get completed items from a session */
export function getCompletedItems(
  session: BulkPurchaseSession,
): BulkPurchaseItem[] {
  return session.items.filter((item) => item.status === "completed");
}

/** Get failed items from a session */
export function getFailedItems(
  session: BulkPurchaseSession,
): BulkPurchaseItem[] {
  return session.items.filter((item) => item.status === "failed");
}

/** Update a single item's status in the session */
export function updateBulkPurchaseItem(
  sessionId: string,
  promptId: number,
  updates: Partial<BulkPurchaseItem>,
): void {
  const session = getBulkPurchaseSession(sessionId);
  if (!session) return;

  const itemIndex = session.items.findIndex(
    (item) => item.promptId === promptId,
  );
  if (itemIndex === -1) return;

  session.items[itemIndex] = {
    ...session.items[itemIndex],
    ...updates,
  };

  // Update session status based on items
  const allCompleted = session.items.every(
    (item) => item.status === "completed",
  );
  const anyFailed = session.items.some((item) => item.status === "failed");
  const anyCompleted = session.items.some(
    (item) => item.status === "completed",
  );

  if (allCompleted) {
    session.status = "completed";
  } else if (anyFailed && anyCompleted) {
    session.status = "partial";
  } else if (session.items.every((item) => item.status === "failed")) {
    session.status = "failed";
  }

  session.updatedAt = Date.now();
  saveBulkPurchaseSession(session);
}

/** Mark session as completed */
export function completeBulkPurchaseSession(sessionId: string): void {
  const session = getBulkPurchaseSession(sessionId);
  if (!session) return;

  session.status = "completed";
  session.updatedAt = Date.now();
  saveBulkPurchaseSession(session);
}

/** Clear a session from storage */
export function clearBulkPurchaseSession(sessionId: string): void {
  try {
    const sessions = getAllSessions();
    delete sessions[sessionId];
    localStorage.setItem(SESSION_STORAGE_KEY, JSON.stringify(sessions));
  } catch (error) {
    console.error("Failed to clear bulk purchase session:", error);
  }
}

/** Get all active sessions for a buyer */
export function getActiveBuyerSessions(buyer: string): BulkPurchaseSession[] {
  const sessions = getAllSessions();
  return Object.values(sessions).filter(
    (session) =>
      session.buyer === buyer &&
      (session.status === "active" || session.status === "partial"),
  );
}

/** Check if a prompt was already purchased in any active session */
export function isPromptAlreadyPurchased(
  buyer: string,
  promptId: number,
): boolean {
  const sessions = getActiveBuyerSessions(buyer);
  return sessions.some((session) =>
    session.items.some(
      (item) => item.promptId === promptId && item.status === "completed",
    ),
  );
}
