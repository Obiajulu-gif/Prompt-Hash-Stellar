/**
 * Hook for managing bulk purchase recovery UI (#733)
 *
 * Provides deterministic recovery for interrupted bulk purchases,
 * showing which items completed, failed, or are pending retry.
 */

import { useEffect, useState } from "react";
import {
  type BulkPurchaseSession,
  getActiveBuyerSessions,
  getBulkPurchaseSession,
  clearBulkPurchaseSession,
  getPendingItems,
  getCompletedItems,
  getFailedItems,
} from "@/lib/checkout/bulkPurchaseSession";

export interface UseBulkPurchaseRecoveryResult {
  /** Active or partial sessions for the current buyer */
  recoverableSessions: BulkPurchaseSession[];
  /** Whether any recoverable sessions exist */
  hasRecoverableSessions: boolean;
  /** Refresh session list */
  refresh: () => void;
  /** Dismiss a session from recovery UI */
  dismissSession: (sessionId: string) => void;
  /** Get details for recovery UI */
  getSessionSummary: (sessionId: string) => {
    completed: number;
    pending: number;
    failed: number;
    canRetry: boolean;
  } | null;
}

export function useBulkPurchaseRecovery(
  buyer: string | undefined,
): UseBulkPurchaseRecoveryResult {
  const [recoverableSessions, setRecoverableSessions] = useState<
    BulkPurchaseSession[]
  >([]);

  const refresh = () => {
    if (!buyer) {
      setRecoverableSessions([]);
      return;
    }
    const sessions = getActiveBuyerSessions(buyer);
    setRecoverableSessions(sessions);
  };

  useEffect(() => {
    refresh();
  }, [buyer]);

  const dismissSession = (sessionId: string) => {
    clearBulkPurchaseSession(sessionId);
    refresh();
  };

  const getSessionSummary = (sessionId: string) => {
    const session = getBulkPurchaseSession(sessionId);
    if (!session) return null;

    const completed = getCompletedItems(session).length;
    const pending = getPendingItems(session).length;
    const failed = getFailedItems(session).length;
    const canRetry = pending > 0 || failed > 0;

    return { completed, pending, failed, canRetry };
  };

  return {
    recoverableSessions,
    hasRecoverableSessions: recoverableSessions.length > 0,
    refresh,
    dismissSession,
    getSessionSummary,
  };
}
