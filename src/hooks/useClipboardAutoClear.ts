import { useCallback, useEffect, useRef, useState } from "react";

const STORAGE_KEY = "prompt-hash:clipboard-autoclear";

function readAutoClearEnabled(): boolean {
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    return raw === null ? true : raw === "true";
  } catch {
    return true;
  }
}

function writeAutoClearEnabled(enabled: boolean): void {
  try {
    localStorage.setItem(STORAGE_KEY, String(enabled));
  } catch {
    // quota or private browsing
  }
}

export interface ClipboardAutoClearOptions {
  /** Delay in seconds before the clipboard is cleared. Default 30. */
  delaySeconds?: number;
}

export interface ClipboardAutoClearResult {
  /** Whether auto-clear is currently enabled by the user. */
  enabled: boolean;
  /** Toggle the auto-clear preference on or off. */
  toggle: () => void;
  /**
   * Copy text to the clipboard. If auto-clear is enabled the countdown starts
   * immediately after a successful write.
   */
  copy: (text: string) => Promise<boolean>;
  /** Manually cancel a running countdown without clearing the clipboard. */
  cancel: () => void;
  /** Seconds remaining before the clipboard is cleared (0 when idle). */
  remaining: number;
  /** True while the countdown is active. */
  isCountingDown: boolean;
  /** The content that was last copied (or null). */
  copiedContent: string | null;
}

export function useClipboardAutoClear(
  opts: ClipboardAutoClearOptions = {},
): ClipboardAutoClearResult {
  const { delaySeconds = 30 } = opts;

  const [enabled, setEnabled] = useState(readAutoClearEnabled);
  const [remaining, setRemaining] = useState(0);
  const [copiedContent, setCopiedContent] = useState<string | null>(null);

  const timerRef = useRef<ReturnType<typeof setInterval> | null>(null);
  const targetRef = useRef<string | null>(null);
  const endTimeRef = useRef<number>(0);

  // Persist the preference whenever it changes
  useEffect(() => {
    writeAutoClearEnabled(enabled);
  }, [enabled]);

  const clearTimer = useCallback(() => {
    if (timerRef.current !== null) {
      clearInterval(timerRef.current);
      timerRef.current = null;
    }
    endTimeRef.current = 0;
    setRemaining(0);
  }, []);

  const cancel = useCallback(() => {
    clearTimer();
    targetRef.current = null;
    setCopiedContent(null);
  }, [clearTimer]);

  const clearClipboardIfMatch = useCallback(async () => {
    const target = targetRef.current;
    if (!target) return;

    try {
      if (navigator?.clipboard) {
        const current = await navigator.clipboard.readText();
        // Only clear if the clipboard still contains what we copied
        if (current === target) {
          await navigator.clipboard.writeText("");
        }
      }
    } catch {
      // readText may throw in some browsers — silently ignore
    } finally {
      cancel();
    }
  }, [cancel]);

  // Tick every second while countdown is active
  useEffect(() => {
    if (remaining <= 0) {
      clearTimer();
      return;
    }

    timerRef.current = setInterval(() => {
      const now = Date.now();
      const secs = Math.max(0, Math.ceil((endTimeRef.current - now) / 1000));
      setRemaining(secs);

      if (secs <= 0) {
        clearTimer();
        clearClipboardIfMatch();
      }
    }, 500);

    return () => {
      if (timerRef.current !== null) {
        clearInterval(timerRef.current);
        timerRef.current = null;
      }
    };
  }, [remaining > 0, clearTimer, clearClipboardIfMatch]);

  const toggle = useCallback(() => {
    setEnabled((prev) => {
      if (prev) cancel();
      return !prev;
    });
  }, [cancel]);

  const copy = useCallback(
    async (text: string): Promise<boolean> => {
      if (!navigator?.clipboard) return false;

      try {
        await navigator.clipboard.writeText(text);
        setCopiedContent(text);
        targetRef.current = text;

        if (enabled) {
          endTimeRef.current = Date.now() + delaySeconds * 1000;
          setRemaining(delaySeconds);
        } else {
          clearTimer();
        }
        return true;
      } catch {
        return false;
      }
    },
    [enabled, delaySeconds, clearTimer],
  );

  // Cleanup on unmount
  useEffect(() => {
    return () => {
      if (timerRef.current !== null) {
        clearInterval(timerRef.current);
      }
    };
  }, []);

  return {
    enabled,
    toggle,
    copy,
    cancel,
    remaining,
    isCountingDown: remaining > 0,
    copiedContent,
  };
}
