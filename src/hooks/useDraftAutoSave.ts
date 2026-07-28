import { useCallback, useEffect, useRef, useState } from "react";

const DRAFT_PREFIX = "prompt-hash:create-draft:";

/** Fields that are safe to persist — never include secret prompt content. */
const SENSITIVE_FIELDS = new Set(["fullPrompt"]);

export interface DraftMeta {
  savedAt: string;
  formData: Record<string, unknown>;
}

/** The localStorage key a wallet's create-listing draft is stored under. */
export function getDraftStorageKey(address: string): string {
  return `${DRAFT_PREFIX}${address}`;
}

function readJson<T>(key: string): T | null {
  try {
    const raw = window.localStorage.getItem(key);
    return raw ? (JSON.parse(raw) as T) : null;
  } catch {
    return null;
  }
}

function writeJson(key: string, value: unknown): void {
  try {
    window.localStorage.setItem(key, JSON.stringify(value));
  } catch {
    // quota or private browsing
  }
}

function stripSensitive(data: Record<string, unknown>): Record<string, unknown> {
  const out: Record<string, unknown> = {};
  for (const key of Object.keys(data)) {
    if (!SENSITIVE_FIELDS.has(key)) {
      out[key] = data[key];
    }
  }
  return out;
}

export interface UseDraftAutoSaveOptions {
  /** Wallet address — drives the storage key. */
  address: string | undefined;
  /** Current form values (from react-hook-form watch()). */
  values: Record<string, unknown>;
  /** react-hook-form setValue function. */
  setValue: (name: string, value: unknown) => void;
  /** Debounce delay in ms. Default 1500. */
  debounceMs?: number;
}

export interface UseDraftAutoSaveResult {
  /** Whether a draft was restored from a previous session. */
  draftRestored: boolean;
  /** ISO timestamp of last save, or null. */
  lastSavedAt: string | null;
  /** Discard the saved draft and reset form fields to defaults. */
  discardDraft: () => void;
  /** Manually trigger an immediate save. */
  saveNow: () => void;
}

export function useDraftAutoSave({
  address,
  values,
  setValue,
  debounceMs = 1500,
}: UseDraftAutoSaveOptions): UseDraftAutoSaveResult {
  const storageKey = address ? getDraftStorageKey(address) : null;
  const [draftRestored, setDraftRestored] = useState(false);
  const [lastSavedAt, setLastSavedAt] = useState<string | null>(null);
  const loadedKeyRef = useRef<string | null>(null);
  const timerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const skipNextSaveRef = useRef(false);

  // ── Load draft on mount / key change ──────────────────────────────────
  useEffect(() => {
    loadedKeyRef.current = null;
    setDraftRestored(false);
    setLastSavedAt(null);

    if (!storageKey) return;

    const draft = readJson<DraftMeta>(storageKey);
    if (draft?.formData) {
      const safe = stripSensitive(draft.formData);
      Object.keys(safe).forEach((key) => {
        setValue(key, safe[key]);
      });
      setDraftRestored(true);
      setLastSavedAt(draft.savedAt ?? null);
    }

    loadedKeyRef.current = storageKey;
  }, [storageKey, setValue]);

  // ── Debounced auto-save ───────────────────────────────────────────────
  const persist = useCallback(
    (data: Record<string, unknown>) => {
      if (!storageKey) return;
      const safe = stripSensitive(data);
      const hasContent = Object.values(safe).some(
        (v) => v !== "" && v !== undefined && v !== null,
      );
      if (!hasContent) return;

      const meta: DraftMeta = {
        savedAt: new Date().toISOString(),
        formData: safe,
      };
      writeJson(storageKey, meta);
      setLastSavedAt(meta.savedAt);
    },
    [storageKey],
  );

  useEffect(() => {
    if (loadedKeyRef.current !== storageKey) return;
    if (skipNextSaveRef.current) {
      skipNextSaveRef.current = false;
      return;
    }

    if (timerRef.current !== null) clearTimeout(timerRef.current);
    timerRef.current = setTimeout(() => persist(values), debounceMs);

    return () => {
      if (timerRef.current !== null) clearTimeout(timerRef.current);
    };
  }, [values, debounceMs, persist, storageKey]);

  // ── Discard ───────────────────────────────────────────────────────────
  const discardDraft = useCallback(() => {
    if (storageKey) {
      window.localStorage.removeItem(storageKey);
    }
    skipNextSaveRef.current = true;
    setDraftRestored(false);
    setLastSavedAt(null);
    // Reset the form fields to defaults
    setValue("imageUrl", "");
    setValue("title", "");
    setValue("category", "");
    setValue("previewText", "");
    setValue("description", "");
    setValue("fullPrompt", "");
    setValue("priceXlm", "2");
    setValue("coCreators", []);
  }, [storageKey, setValue]);

  // ── Manual save ───────────────────────────────────────────────────────
  const saveNow = useCallback(() => {
    if (timerRef.current !== null) clearTimeout(timerRef.current);
    persist(values);
  }, [persist, values]);

  // Cleanup
  useEffect(() => {
    return () => {
      if (timerRef.current !== null) clearTimeout(timerRef.current);
    };
  }, []);

  return { draftRestored, lastSavedAt, discardDraft, saveNow };
}
