import { useCallback, useEffect, useRef } from "react";
import { useBlocker, type BlockerFunction } from "react-router-dom";

export interface UseUnsavedChangesWarningOptions {
  /** Whether the form currently has unsaved changes. */
  isDirty: boolean;
  /** Set to true to disable the warning (e.g. after a successful save). */
  disabled?: boolean;
  /** Custom message shown in the browser's native beforeunload dialog. */
  message?: string;
}

const DEFAULT_MESSAGE =
  "You have unsaved changes. Are you sure you want to leave?";

export function useUnsavedChangesWarning({
  isDirty,
  disabled = false,
  message = DEFAULT_MESSAGE,
}: UseUnsavedChangesWarningOptions) {
  const active = isDirty && !disabled;
  const messageRef = useRef(message);
  messageRef.current = message;

  // ── Block tab close / refresh (beforeunload) ──────────────────────────
  useEffect(() => {
    if (!active) return;

    const handler = (e: BeforeUnloadEvent) => {
      e.preventDefault();
      // Modern browsers ignore custom messages but require returnValue set.
      e.returnValue = "";
    };

    window.addEventListener("beforeunload", handler);
    return () => window.removeEventListener("beforeunload", handler);
  }, [active]);

  // ── Block react-router navigation ─────────────────────────────────────
  const blocker: BlockerFunction = useCallback(
    ({ nextLocation }) => {
      if (!active) return false;
      // Allow same-page link clicks (they don't actually navigate away)
      if (nextLocation.pathname === window.location.pathname) return false;
      return !window.confirm(messageRef.current);
    },
    [active],
  );

  const blockerResult = useBlocker(blocker);

  // If the user confirmed navigation, unblock so the navigation can proceed.
  useEffect(() => {
    if (blockerResult.state === "unblocked" && blockerResult.reset) {
      // Already unblocked — nothing to do.
    }
  }, [blockerResult]);

  return {
    /** True when the warning is active and will block navigation. */
    isActive: active,
    /**
     * Call after a successful save to programmatically unblock. This resets
     * the blocker so subsequent navigations are not intercepted.
     */
    resetBlocker: blockerResult.reset,
  };
}
