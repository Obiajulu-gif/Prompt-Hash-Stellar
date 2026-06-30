import { useCallback, useEffect, useRef } from "react";
import {
  startAudit,
  type AuditEntry,
  type AuditScope,
} from "@/lib/observability/performanceAudit";

interface UsePerformanceAuditOptions {
  scope: AuditScope;
  metadata?: Record<string, string | number | boolean>;
  autoStart?: boolean;
}

interface UsePerformanceAuditResult {
  markDone: (
    _extraMetadata?: Record<string, string | number | boolean>
  ) => AuditEntry | null;
  restart: () => void;
}

export function usePerformanceAudit({
  scope,
  metadata,
  autoStart = true,
}: UsePerformanceAuditOptions): UsePerformanceAuditResult {
  const stopRef = useRef<((_?: Record<string, string | number | boolean>) => AuditEntry) | null>(
    null
  );

  const start = useCallback(() => {
    stopRef.current = startAudit(scope);
  }, [scope]);

  useEffect(() => {
    if (autoStart) {
      start();
    }
    return () => {
      // If the component unmounts before markDone is called, record with whatever was set.
      stopRef.current?.(metadata);
      stopRef.current = null;
    };
    // eslint-disable-next-line
  }, [scope, autoStart]);

  const markDone = useCallback(
    (extraMetadata?: Record<string, string | number | boolean>): AuditEntry | null => {
      if (!stopRef.current) return null;
      const entry = stopRef.current({ ...metadata, ...extraMetadata });
      stopRef.current = null;
      return entry;
    },
    [metadata]
  );

  const restart = useCallback(() => {
    stopRef.current = null;
    start();
  }, [start]);

  return { markDone, restart };
}
