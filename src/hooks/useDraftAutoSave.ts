import { useCallback, useEffect, useRef, useState } from "react";

const DRAFT_PREFIX = "prompt-hash:create-draft:";

/** Fields that are safe to persist — never include secret prompt content. */
const SENSITIVE_FIELDS = new Set(["fullPrompt"]);

/**
 * Fields that count as "real" draft content. Used so a form sitting on its
 * defaults (e.g. the default `priceXlm: "2"`) is not treated as an unsynced
 * draft that could clobber a stored one (#680).
 */
const CONTENT_FIELDS = [
  "imageUrl",
  "title",
  "category",
  "previewText",
  "description",
  "fullPrompt",
  "coCreators",
] as const;

/** A detected conflict between the current wallet/network context and a draft. */
export interface DraftSessionGuard {
  /**
   * Why the session is out of sync with the stored/pending draft:
   *  - `wallet-changed`: the draft was authored under a different wallet
   *    than the one currently connected (or the wallet switched mid-edit).
   *  - `network-changed`: the draft was authored under a different Stellar
   *    network than the one currently connected.
   *  - `wallet-disconnected`: no wallet is connected but the form still
   *    holds unsynced edits that belong to a previous session.
   */
  kind: "wallet-changed" | "network-changed" | "wallet-disconnected";
  /** Wallet that authored the protected draft (from storage or the session). */
  draftAddress?: string;
  /** Stellar network the protected draft was authored under. */
  draftNetwork?: string;
  /** Last known `savedAt` for the protected draft. */
  savedAt?: string;
  /**
   * The storage key where the protected draft actually lives. May differ from
   * `getDraftStorageKey(draftAddress)` when a slot is claimed by a foreign
   * wallet — discard must remove the physical slot, not the claimed owner's.
   */
  protectedKey?: string;
}

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
  /**
   * Wallet public key that authored the draft. Binds drafts to a wallet
   * context so a different wallet cannot load or publish them (#680).
   */
  ownerAddress?: string;
  /**
   * Stellar network the draft was authored under. Binds drafts to a network
   * context so publishing never happens on a different network by accident
   * (#680).
   */
  network?: string;
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

function readStoredDraft(address: string | undefined): DraftMeta | null {
  if (!address) return null;
  return readJson<DraftMeta>(getDraftStorageKey(address));
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

/** Whether a record contains any meaningful user-provided draft content. */
function hasDraftContent(data: Record<string, unknown>): boolean {
  return CONTENT_FIELDS.some((key) => {
    const value = data[key];
    if (Array.isArray(value)) return value.length > 0;
    return value !== "" && value !== undefined && value !== null;
  });
}

/** Monotonic-ish unique token used as the draft revision. */
function newRevisionToken(): string {
  const cryptoObj = globalThis.crypto as Crypto | undefined;
  if (cryptoObj?.randomUUID) {
    return cryptoObj.randomUUID();
  }
  return `${Date.now().toString(36)}-${Math.random().toString(36).slice(2)}`;
}

/** Default form values used to reset the form on discard (#680). */
const DEFAULT_FORM_VALUES: Record<string, unknown> = {
  imageUrl: "",
  title: "",
  category: "",
  previewText: "",
  description: "",
  fullPrompt: "",
  priceXlm: "2",
  coCreators: [],
};

export interface UseDraftAutoSaveOptions {
  /** Wallet address — drives the storage key. */
  address: string | undefined;
  /** Current Stellar network (passphrase) the wallet is connected to. */
  network?: string;
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
  /**
   * Non-null when the connected wallet/network context does not match the
   * draft being edited. While set, autosave is paused and publishing must be
   * blocked until the user resolves the mismatch (#680).
   */
  sessionGuard: DraftSessionGuard | null;
  /**
   * Resolve an active session guard.
   *  - `adopt`  — keep the current edits, re-stamp them under the currently
   *    connected wallet/network and resume autosaving.
   *  - `discard` — delete the protected draft from storage and reset the form.
   *  - `cancel` — leave the guard active (no-op).
   */
  resolveSessionGuard: (action: "adopt" | "discard" | "cancel") => void;
  /** The wallet the current form session belongs to. */
  draftOwnerAddress: string | undefined;
  /** The network the current form session belongs to. */
  draftNetwork: string | undefined;
  /** True only when publishing under the current wallet is safe. */
  canPublish: boolean;
}

export function useDraftAutoSave({
  address,
  network,
  values,
  setValue,
  debounceMs = 1500,
}: UseDraftAutoSaveOptions): UseDraftAutoSaveResult {
  const storageKey = address ? getDraftStorageKey(address) : null;
  const [draftRestored, setDraftRestored] = useState(false);
  const [lastSavedAt, setLastSavedAt] = useState<string | null>(null);
  const [conflict, setConflict] = useState<DraftConflict | null>(null);
  const [sessionGuard, setSessionGuard] = useState<DraftSessionGuard | null>(null);
  const [draftOwner, setDraftOwner] = useState<string | undefined>(undefined);
  const [draftNet, setDraftNet] = useState<string | undefined>(undefined);

  const loadedKeyRef = useRef<string | null>(null);
  const timerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const skipNextSaveRef = useRef(false);
  const lastKnownRevisionRef = useRef<string | null>(null);
  const pendingConflictRef = useRef<Record<string, unknown> | null>(null);
  /** The wallet/network context the current form session is bound to. */
  const sessionOwnerRef = useRef<string | undefined>(undefined);
  const sessionNetworkRef = useRef<string | undefined>(undefined);
  /**
   * Whether the form holds real (non-default) content that needs session
   * continuity. Mirrored first so the load effect can decide between loading
   * a stored draft and preserving live edits.
   */
  const dirtyRef = useRef(false);
  /** Mirror of the latest form values (used to flush edits after reconnects). */
  const valuesRef = useRef(values);

  const persist = useCallback(
    (data: Record<string, unknown>, force = false) => {
      if (!storageKey) return;
      if (loadedKeyRef.current !== storageKey) return;
      const safe = stripSensitive(data);
      if (!hasDraftContent(safe)) return;

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
        ownerAddress: address,
        network,
      };
      writeJson(storageKey, meta);
      lastKnownRevisionRef.current = meta.revision!;
      setLastSavedAt(meta.savedAt);
    },
    [storageKey, address, network],
  );

  /**
   * Mirror the form values and track whether the form holds real draft
   * content. Declared before the load effect so a wallet/network change that
   * happens mid-edit is reconciled against the live edits, never silently
   * clobbered.
   */
  useEffect(() => {
    valuesRef.current = values;
    if (hasDraftContent(values)) {
      dirtyRef.current = true;
    }
  }, [values]);

  /**
   * Reconcile the stored draft with the connected wallet/network context on
   * every change. A mismatch between the session context and the
   * stored/pending draft is surfaced as a `sessionGuard` instead of being
   * silently loaded, overwritten, or published (#680).
   */
  useEffect(() => {
    setConflict(null);
    setDraftRestored(false);
    lastKnownRevisionRef.current = null;

    // No wallet connected — keep live edits but pause autosave. They flush
    // back into storage once the same wallet reconnects (case 4 below).
    if (!storageKey) {
      if (dirtyRef.current && sessionOwnerRef.current) {
        setSessionGuard({
          kind: "wallet-disconnected",
          draftAddress: sessionOwnerRef.current,
          draftNetwork: sessionNetworkRef.current,
          savedAt: readStoredDraft(sessionOwnerRef.current)?.savedAt ?? undefined,
          protectedKey: getDraftStorageKey(sessionOwnerRef.current),
        });
      } else {
        setSessionGuard(null);
      }
      loadedKeyRef.current = null;
      return;
    }

    const stored = readJson<DraftMeta>(storageKey);
    const storedOwner = stored?.ownerAddress;
    const storedNetwork = stored?.network;

    // (1) Wallet switched while the form still holds edits from another
    //     session — never bind those edits to the new wallet implicitly.
    if (
      dirtyRef.current &&
      sessionOwnerRef.current &&
      sessionOwnerRef.current !== address
    ) {
      setSessionGuard({
        kind: "wallet-changed",
        draftAddress: sessionOwnerRef.current,
        draftNetwork: sessionNetworkRef.current,
        savedAt: stored?.savedAt ?? undefined,
        protectedKey: getDraftStorageKey(sessionOwnerRef.current),
      });
      pendingConflictRef.current = null;
      loadedKeyRef.current = null;
      return;
    }

    // (2) Stored draft belongs to a different wallet — block load + publish.
    if (stored && storedOwner && storedOwner !== address) {
      setSessionGuard({
        kind: "wallet-changed",
        draftAddress: storedOwner,
        draftNetwork: storedNetwork,
        savedAt: stored.savedAt,
        protectedKey: storageKey,
      });
      loadedKeyRef.current = null;
      return;
    }

    // (3) Stored draft was authored under a different Stellar network.
    if (stored && storedNetwork && network && storedNetwork !== network) {
      setSessionGuard({
        kind: "network-changed",
        draftAddress: storedOwner ?? address,
        draftNetwork: storedNetwork,
        savedAt: stored.savedAt,
        protectedKey: storageKey,
      });
      loadedKeyRef.current = null;
      return;
    }

    // (4) A wallet reconnected / context reapplied while unsynced edits are
    //     in the form — keep them and flush them into the correct slot so
    //     offline or disconnected edits are never lost. Only runs when a
    //     session with the SAME wallet already existed (a fresh mount with a
    //     pre-filled form defers to the stored draft in case 5).
    if (dirtyRef.current && sessionOwnerRef.current === address) {
      sessionOwnerRef.current = address;
      sessionNetworkRef.current = network;
      setDraftOwner(address);
      setDraftNet(network);
      lastKnownRevisionRef.current = stored?.revision ?? null;
      setSessionGuard(null);
      loadedKeyRef.current = storageKey;
      persist(valuesRef.current, true);
      return;
    }

    // (5) Clean form: load a stored draft that matches the session context,
    //     otherwise start a fresh session under the current context.
    if (stored?.formData) {
      const safe = stripSensitive(stored.formData);
      Object.keys(safe).forEach((key) => {
        setValue(key, safe[key]);
      });
      sessionOwnerRef.current = storedOwner ?? address;
      sessionNetworkRef.current = storedNetwork ?? network;
      setDraftOwner(storedOwner ?? address);
      setDraftNet(storedNetwork ?? network);
      lastKnownRevisionRef.current = stored.revision ?? null;
      loadedKeyRef.current = storageKey;
      setDraftRestored(true);
      setLastSavedAt(stored.savedAt ?? null);
      setSessionGuard(null);
      dirtyRef.current = true;
    } else {
      sessionOwnerRef.current = address;
      sessionNetworkRef.current = network;
      setDraftOwner(address);
      setDraftNet(network);
      loadedKeyRef.current = storageKey;
      setSessionGuard(null);
    }
    // `persist` is recreated whenever its dependencies (storageKey, address,
    // network) change, which are already the effect's dependencies.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [address, network, storageKey]);

  useEffect(() => {
    if (loadedKeyRef.current !== storageKey) return;
    if (skipNextSaveRef.current) {
      skipNextSaveRef.current = false;
      return;
    }
    if (conflict) return;
    if (sessionGuard) return;

    if (timerRef.current !== null) clearTimeout(timerRef.current);
    timerRef.current = setTimeout(() => persist(values), debounceMs);

    return () => {
      if (timerRef.current !== null) clearTimeout(timerRef.current);
    };
  }, [values, debounceMs, persist, storageKey, conflict, sessionGuard]);

  // ── Discard ───────────────────────────────────────────────────────────
  const discardDraft = useCallback(() => {
    if (storageKey) {
      window.localStorage.removeItem(storageKey);
    }
    skipNextSaveRef.current = true;
    lastKnownRevisionRef.current = null;
    pendingConflictRef.current = null;
    setConflict(null);
    setSessionGuard(null);
    setDraftRestored(false);
    setLastSavedAt(null);
    dirtyRef.current = false;
    sessionOwnerRef.current = address;
    sessionNetworkRef.current = network;
    setDraftOwner(undefined);
    setDraftNet(undefined);
    loadedKeyRef.current = storageKey;
    // Reset the form fields to defaults
    Object.keys(DEFAULT_FORM_VALUES).forEach((key) => {
      setValue(key, DEFAULT_FORM_VALUES[key]);
    });
  }, [storageKey, setValue, address, network]);

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
          ownerAddress: sessionOwnerRef.current ?? address,
          network: sessionNetworkRef.current ?? network,
        };
        writeJson(storageKey, meta);
        lastKnownRevisionRef.current = meta.revision!;
        setLastSavedAt(meta.savedAt);
      }

      pendingConflictRef.current = null;
      setConflict(null);
    },
    [storageKey, conflict, values, setValue, address, network],
  );

  // ── Session guard resolution ──────────────────────────────────────────
  const resolveSessionGuard = useCallback(
    (action: "adopt" | "discard" | "cancel") => {
      if (!sessionGuard) return;
      if (action === "cancel") return;

      if (action === "discard") {
        // Remove the protected draft where it actually lives (which may be
        // the current slot even when a foreign wallet claims it), reset the
        // form so a fresh session starts under the current context.
        const targetKey =
          sessionGuard.protectedKey ??
          (sessionGuard.draftAddress
            ? getDraftStorageKey(sessionGuard.draftAddress)
            : storageKey);
        if (targetKey) {
          window.localStorage.removeItem(targetKey);
        }
        dirtyRef.current = false;
        sessionOwnerRef.current = address;
        sessionNetworkRef.current = network;
        setDraftOwner(undefined);
        setDraftNet(undefined);
        lastKnownRevisionRef.current = null;
        pendingConflictRef.current = null;
        setConflict(null);
        setDraftRestored(false);
        setLastSavedAt(null);
        setSessionGuard(null);
        loadedKeyRef.current = storageKey;
        Object.keys(DEFAULT_FORM_VALUES).forEach((key) => {
          setValue(key, DEFAULT_FORM_VALUES[key]);
        });
        return;
      }

      // action === "adopt": re-stamp the current edits under the connected
      // wallet/network and persist them immediately.
      const storedRevision = readJson<DraftMeta>(storageKey ?? "")?.revision ?? null;
      sessionOwnerRef.current = address;
      sessionNetworkRef.current = network;
      setDraftOwner(address);
      setDraftNet(network);
      lastKnownRevisionRef.current = storedRevision;
      pendingConflictRef.current = null;
      setConflict(null);
      setSessionGuard(null);
      loadedKeyRef.current = storageKey;
      if (storageKey) {
        persist(valuesRef.current, true);
      }
    },
    [sessionGuard, storageKey, address, network, setValue, persist],
  );

  // Cleanup
  useEffect(() => {
    return () => {
      if (timerRef.current !== null) clearTimeout(timerRef.current);
    };
  }, []);

  const canPublish = Boolean(
    address &&
      !sessionGuard &&
      !conflict &&
      (!draftOwner || draftOwner === address),
  );

  return {
    draftRestored,
    lastSavedAt,
    discardDraft,
    saveNow,
    conflict,
    resolveConflict,
    sessionGuard,
    resolveSessionGuard,
    draftOwnerAddress: draftOwner,
    draftNetwork: draftNet,
    canPublish,
  };
}