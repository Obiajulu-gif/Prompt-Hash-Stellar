import { useCallback, useEffect, useRef, useState } from "react";

const DRAFT_PREFIX = "prompt-hash:create-draft:";

/** Fields that are safe to persist — never include secret prompt content. */
const SENSITIVE_FIELDS = new Set(["fullPrompt"]);

/** Recorded audit trail entry for a multi-tab draft conflict (#710). */
export interface DraftConflictAuditEntry {
  /** The revision token of the draft this tab had loaded. */
  localRevision: string | null;
  /** The revision token already in storage (written by another tab). */
  storedRevision: string | null;
  /** ISO timestamp when the conflict was detected. */
  detectedAt: string;
  /** Which side the user chose to keep. */
  resolution: "keep-local" | "keep-remote";
  /** ISO timestamp when the conflict was resolved. */
  resolvedAt: string;
}

export interface DraftMeta {
  savedAt: string;
  formData: Record<string, unknown>;
  /**
   * Revision token that rotates on every successful write. Used for
   * last-writer detection so an older tab cannot silently clobber a newer
   * tab's changes (#710).
   */
  revision?: string;
  /** Audit trail of resolved multi-tab conflicts, persisted with the draft. */
  conflictAudit?: DraftConflictAuditEntry[];
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

/** Monotonic-ish unique token used as the draft revision. */
function newRevisionToken(): string {
  const cryptoObj = globalThis.crypto as Crypto | undefined;
  if (cryptoObj?.randomUUID) {
    return cryptoObj.randomUUID();
  }
  return `${Date.now().toString(36)}-${Math.random().toString(36).slice(2)}`;
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

/** A detected multi-tab write conflict awaiting resolution. */
export interface DraftConflict {
  /** ISO timestamp of the newer draft already stored (written by another tab). */
  storedSavedAt: string;
  /** ISO timestamp of the last save this tab made. */
  localSavedAt: string;
  localRevision: string | null;
  storedRevision: string | null;
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
  /** A multi-tab conflict detected on save, or null. */
  conflict: DraftConflict | null;
  /** Resolve an active conflict. */
  resolveConflict: (choice: "keep-local" | "keep-remote") => void;
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
  const [conflict, setConflict] = useState<DraftConflict | null>(null);
  const loadedKeyRef = useRef<string | null>(null);
  const timerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const skipNextSaveRef = useRef(false);
  const lastKnownRevisionRef = useRef<string | null>(null);
  const pendingConflictRef = useRef<Record<string, unknown> | null>(null);

  // ── Load draft on mount / key change ──────────────────────────────────
  useEffect(() => {
    loadedKeyRef.current = null;
    lastKnownRevisionRef.current = null;
    pendingConflictRef.current = null;
    setDraftRestored(false);
    setLastSavedAt(null);
    setConflict(null);

    if (!storageKey) return;

    const draft = readJson<DraftMeta>(storageKey);
    if (draft?.formData) {
      const safe = stripSensitive(draft.formData);
      Object.keys(safe).forEach((key) => {
        setValue(key, safe[key]);
      });
      lastKnownRevisionRef.current = draft.revision ?? null;
      setDraftRestored(true);
      setLastSavedAt(draft.savedAt ?? null);
    }

    loadedKeyRef.current = storageKey;
  }, [storageKey, setValue]);

  // ── Debounced auto-save ───────────────────────────────────────────────
  const persist = useCallback(
    (data: Record<string, unknown>, force = false) => {
      if (!storageKey) return;
      const safe = stripSensitive(data);
      const hasContent = Object.values(safe).some(
        (v) => v !== "" && v !== undefined && v !== null,
      );
      if (!hasContent) return;

      const stored = readJson<DraftMeta>(storageKey);
      const storedRevision = stored?.revision ?? null;

      // Last-writer detection (#710): if another tab wrote since we loaded or
      // last saved, do NOT silently overwrite — raise a conflict instead.
      if (
        !force &&
        storedRevision !== null &&
        lastKnownRevisionRef.current !== null &&
        storedRevision !== lastKnownRevisionRef.current
      ) {
        pendingConflictRef.current = safe;
        setConflict({
          storedSavedAt: stored?.savedAt ?? "",
          localSavedAt: new Date().toISOString(),
          localRevision: lastKnownRevisionRef.current,
          storedRevision,
        });
        return;
      }

      const meta: DraftMeta = {
        savedAt: new Date().toISOString(),
        revision: newRevisionToken(),
        formData: safe,
        conflictAudit: stored?.conflictAudit ?? undefined,
      };
      writeJson(storageKey, meta);
      lastKnownRevisionRef.current = meta.revision!;
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
    if (conflict) return;

    if (timerRef.current !== null) clearTimeout(timerRef.current);
    timerRef.current = setTimeout(() => persist(values), debounceMs);

    return () => {
      if (timerRef.current !== null) clearTimeout(timerRef.current);
    };
  }, [values, debounceMs, persist, storageKey, conflict]);

  // ── Discard ───────────────────────────────────────────────────────────
  const discardDraft = useCallback(() => {
    if (storageKey) {
      window.localStorage.removeItem(storageKey);
    }
    skipNextSaveRef.current = true;
    lastKnownRevisionRef.current = null;
    pendingConflictRef.current = null;
    setConflict(null);
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

  // ── Conflict resolution ───────────────────────────────────────────────
  const resolveConflict = useCallback(
    (choice: "keep-local" | "keep-remote") => {
      if (!storageKey || !conflict) return;

      const stored = readJson<DraftMeta>(storageKey);
      const auditEntry: DraftConflictAuditEntry = {
        localRevision: conflict.localRevision,
        storedRevision: conflict.storedRevision,
        detectedAt: "",
        resolution: choice,
        resolvedAt: new Date().toISOString(),
      };

      if (choice === "keep-remote") {
        // Load the newer stored draft into the form and adopt its revision.
        if (stored?.formData) {
          const safe = stripSensitive(stored.formData);
          Object.keys(safe).forEach((key) => {
            setValue(key, safe[key]);
          });
        }
        lastKnownRevisionRef.current = conflict.storedRevision;
        setLastSavedAt(conflict.storedSavedAt);

        // Record the audit entry back into the stored draft.
        writeJson(storageKey, {
          ...stored,
          revision: conflict.storedRevision ?? newRevisionToken(),
          conflictAudit: [...(stored?.conflictAudit ?? []), { ...auditEntry, detectedAt: new Date().toISOString() }],
        });
      } else {
        // Keep-local: overwrite with this tab's pending/local values.
        const local = pendingConflictRef.current ?? stripSensitive(values);
        const meta: DraftMeta = {
          savedAt: new Date().toISOString(),
          revision: newRevisionToken(),
          formData: local,
          conflictAudit: [...(stored?.conflictAudit ?? []), { ...auditEntry, detectedAt: new Date().toISOString() }],
        };
        writeJson(storageKey, meta);
        lastKnownRevisionRef.current = meta.revision!;
        setLastSavedAt(meta.savedAt);
      }

      pendingConflictRef.current = null;
      setConflict(null);
    },
    [storageKey, conflict, values, setValue],
  );

  // Cleanup
  useEffect(() => {
    return () => {
      if (timerRef.current !== null) clearTimeout(timerRef.current);
    };
  }, []);

  return { draftRestored, lastSavedAt, discardDraft, saveNow, conflict, resolveConflict };
}
