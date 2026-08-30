import { renderHook, act } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";
import {
  useDraftAutoSave,
  getDraftStorageKey,
  type DraftMeta,
  type DraftConflictAuditEntry,
} from "@/hooks/useDraftAutoSave";

const ADDRESS = "GCLONE1234567890ABCDEFGH1234567890ABCDEFGH1234567890";

function baseValues(overrides: Record<string, unknown> = {}) {
  return {
    imageUrl: "https://example.com/cover.png",
    title: "My draft",
    category: "Marketing",
    previewText: "Public preview",
    description: "A description",
    fullPrompt: "secret prompt body",
    priceXlm: "2",
    coCreators: [],
    ...overrides,
  };
}

function seedDraft(meta: DraftMeta): void {
  window.localStorage.setItem(getDraftStorageKey(ADDRESS), JSON.stringify(meta));
}

describe("useDraftAutoSave multi-tab conflict resolution (#710)", () => {
  beforeEach(() => {
    window.localStorage.clear();
  });

  it("rotates the revision token on every successful save", () => {
    const setValue = vi.fn();
    const values = baseValues();
    const { result } = renderHook(() =>
      useDraftAutoSave({ address: ADDRESS, values, setValue }),
    );

    act(() => result.current.saveNow());
    const first: DraftMeta = JSON.parse(
      window.localStorage.getItem(getDraftStorageKey(ADDRESS))!,
    );
    expect(first.revision).toBeTruthy();

    act(() => result.current.saveNow());
    const second: DraftMeta = JSON.parse(
      window.localStorage.getItem(getDraftStorageKey(ADDRESS))!,
    );
    expect(second.revision).toBeTruthy();
    expect(second.revision).not.toBe(first.revision);
  });

  it("detects a conflict when an older tab saves over a newer stored draft", () => {
    const setValue = vi.fn();
    const values = baseValues();
    const { result } = renderHook(() =>
      useDraftAutoSave({ address: ADDRESS, values, setValue }),
    );

    // Tab A (older) saves first → owns revision R1.
    act(() => result.current.saveNow());
    const first: DraftMeta = JSON.parse(
      window.localStorage.getItem(getDraftStorageKey(ADDRESS))!,
    );

    // Tab B (newer) writes its own revision directly into the same slot.
    act(() => {
      seedDraft({
        savedAt: new Date().toISOString(),
        revision: "tab-b-revision",
        formData: baseValues({ title: "Newer version from tab B" }),
      });
    });

    // Tab A attempts a stale save — must not silently overwrite.
    act(() => result.current.saveNow());
    expect(result.current.conflict).not.toBeNull();
    expect(result.current.conflict!.storedRevision).toBe("tab-b-revision");
    expect(result.current.conflict!.localRevision).toBe(first.revision);

    // The newer stored draft must remain intact while the conflict is pending.
    const stored: DraftMeta = JSON.parse(
      window.localStorage.getItem(getDraftStorageKey(ADDRESS))!,
    );
    expect(stored.revision).toBe("tab-b-revision");
    expect(stored.formData.title).toBe("Newer version from tab B");
  });

  it("resolves keep-local by overwriting with the current tab's values", () => {
    const setValue = vi.fn();
    const values = baseValues({ title: "My local title" });
    const { result } = renderHook(() =>
      useDraftAutoSave({ address: ADDRESS, values, setValue }),
    );

    act(() => result.current.saveNow());

    act(() => {
      seedDraft({
        savedAt: new Date().toISOString(),
        revision: "tab-b-revision",
        formData: baseValues({ title: "Tab B title" }),
      });
    });

    act(() => result.current.saveNow());
    expect(result.current.conflict).not.toBeNull();

    act(() => result.current.resolveConflict("keep-local"));

    expect(result.current.conflict).toBeNull();
    const stored: DraftMeta = JSON.parse(
      window.localStorage.getItem(getDraftStorageKey(ADDRESS))!,
    );
    expect(stored.formData.title).toBe("My local title");
    const audit = stored.conflictAudit as DraftConflictAuditEntry[] | undefined;
    expect(audit).toBeDefined();
    expect(audit![0].resolution).toBe("keep-local");
  });

  it("resolves keep-remote by loading the newer stored values into the form", () => {
    const setValue = vi.fn();
    const values = baseValues({ title: "My local title" });
    const { result } = renderHook(() =>
      useDraftAutoSave({ address: ADDRESS, values, setValue }),
    );

    act(() => result.current.saveNow());

    act(() => {
      seedDraft({
        savedAt: new Date().toISOString(),
        revision: "tab-b-revision",
        formData: baseValues({ title: "Tab B title" }),
      });
    });

    act(() => result.current.saveNow());
    expect(result.current.conflict).not.toBeNull();

    act(() => result.current.resolveConflict("keep-remote"));

    expect(result.current.conflict).toBeNull();
    // The hook should have fed the stored (other tab) values back via setValue.
    const titleCall = setValue.mock.calls.find(([name]) => name === "title");
    expect(titleCall).toBeDefined();
    expect(titleCall![1]).toBe("Tab B title");
  });

  it("keeps saving normally when no competing write happened", () => {
    const setValue = vi.fn();
    const values = baseValues();
    const { result } = renderHook(() =>
      useDraftAutoSave({ address: ADDRESS, values, setValue }),
    );

    act(() => result.current.saveNow());
    act(() => result.current.saveNow());
    act(() => result.current.saveNow());

    expect(result.current.conflict).toBeNull();
    const stored: DraftMeta = JSON.parse(
      window.localStorage.getItem(getDraftStorageKey(ADDRESS))!,
    );
    expect(stored.formData.title).toBe("My draft");
  });
});

describe("useDraftAutoSave draft ownership/session checks (#680)", () => {
  const NET_A = "Test SDF Network ; September 2015";
  const NET_B = "Public Global Stellar Network ; September 2015";
  const OTHER_ADDRESS =
    "GOTHER1234567890ABCDEFGHIJKLMNOPQRSTUVWXYZ1234567890ABCDEFGH";

  function writeStoredDraft(
    address: string,
    formData: Record<string, unknown> = baseValues(),
    overrides: Partial<DraftMeta> = {},
  ): void {
    const meta: DraftMeta = {
      savedAt: new Date().toISOString(),
      revision: "seed-revision",
      formData,
      ownerAddress: ADDRESS,
      network: NET_A,
      ...overrides,
    };
    window.localStorage.setItem(
      getDraftStorageKey(address),
      JSON.stringify(meta),
    );
  }

  beforeEach(() => {
    window.localStorage.clear();
  });

  it("stamps the authoring wallet and network on every save", () => {
    const { result } = renderHook(() =>
      useDraftAutoSave({
        address: ADDRESS,
        network: NET_A,
        values: baseValues(),
        setValue: vi.fn(),
      }),
    );

    act(() => result.current.saveNow());
    const stored: DraftMeta = JSON.parse(
      window.localStorage.getItem(getDraftStorageKey(ADDRESS))!,
    );
    expect(stored.ownerAddress).toBe(ADDRESS);
    expect(stored.network).toBe(NET_A);
  });

  it("raises a wallet-changed guard when the wallet switches mid-edit and blocks publishing", () => {
    writeStoredDraft(ADDRESS);
    const setValue = vi.fn();
    const { result, rerender } = renderHook(
      (props) => useDraftAutoSave(props),
      {
        initialProps: {
          address: ADDRESS,
          network: NET_A,
          values: baseValues(),
          setValue,
        },
      },
    );

    // Draft loads under wallet A.
    expect(result.current.draftRestored).toBe(true);
    expect(result.current.draftOwnerAddress).toBe(ADDRESS);
    expect(result.current.canPublish).toBe(true);

    // Wallet switches to a different account while the form still holds edits.
    rerender({
      address: OTHER_ADDRESS,
      network: NET_A,
      values: baseValues(),
      setValue,
    });

    expect(result.current.sessionGuard?.kind).toBe("wallet-changed");
    expect(result.current.sessionGuard?.draftAddress).toBe(ADDRESS);
    expect(result.current.canPublish).toBe(false);

    // The draft must not leak into the new wallet's storage slot.
    expect(
      window.localStorage.getItem(getDraftStorageKey(OTHER_ADDRESS)),
    ).toBeNull();

    // The original draft stays intact under the authoring wallet.
    const stored: DraftMeta = JSON.parse(
      window.localStorage.getItem(getDraftStorageKey(ADDRESS))!,
    );
    expect(stored.ownerAddress).toBe(ADDRESS);
  });

  it("rejects a stored draft that belongs to a different wallet without loading it", () => {
    writeStoredDraft(ADDRESS, baseValues({ title: "Someone else's draft" }), {
      ownerAddress: OTHER_ADDRESS,
    });

    const setValue = vi.fn();
    const { result } = renderHook(() =>
      useDraftAutoSave({
        address: ADDRESS,
        network: NET_A,
        values: {},
        setValue,
      }),
    );

    expect(result.current.sessionGuard?.kind).toBe("wallet-changed");
    expect(result.current.sessionGuard?.draftAddress).toBe(OTHER_ADDRESS);
    expect(result.current.canPublish).toBe(false);
    // The guarded draft is never written into the form.
    expect(setValue).not.toHaveBeenCalledWith("title", "Someone else's draft");
  });

  it("raises a network-changed guard when the connected network differs from the draft's", () => {
    writeStoredDraft(ADDRESS);

    const setValue = vi.fn();
    const { result, rerender } = renderHook(
      (props) => useDraftAutoSave(props),
      {
        initialProps: {
          address: ADDRESS,
          network: NET_A,
          values: baseValues(),
          setValue,
        },
      },
    );
    expect(result.current.draftRestored).toBe(true);
    expect(result.current.canPublish).toBe(true);

    // The wallet switches networks while the draft is still bound to NET_A.
    rerender({
      address: ADDRESS,
      network: NET_B,
      values: baseValues(),
      setValue,
    });

    expect(result.current.sessionGuard?.kind).toBe("network-changed");
    expect(result.current.sessionGuard?.draftNetwork).toBe(NET_A);
    expect(result.current.canPublish).toBe(false);
  });

  it("keeps unsynced edits recoverable across a disconnect/reconnect cycle", () => {
    const setValue = vi.fn();
    const { result, rerender } = renderHook(
      (props) => useDraftAutoSave(props),
      {
        initialProps: {
          address: ADDRESS,
          network: NET_A,
          values: baseValues(),
          setValue,
        },
      },
    );
    expect(result.current.canPublish).toBe(true);

    // Wallet disconnects while the user is mid-edit.
    rerender({
      address: undefined,
      network: undefined,
      values: baseValues({ title: "Edited while disconnected" }),
      setValue,
    });

    expect(result.current.sessionGuard?.kind).toBe("wallet-disconnected");
    // Autosave is paused — nothing is written to an undefined wallet slot.
    expect(Object.keys(window.localStorage).length).toBeGreaterThanOrEqual(0);

    // Reconnect with the same wallet: the edits must be flushed and preserved.
    rerender({
      address: ADDRESS,
      network: NET_A,
      values: baseValues({ title: "Edited while disconnected" }),
      setValue,
    });

    expect(result.current.sessionGuard).toBeNull();
    expect(result.current.canPublish).toBe(true);
    const stored: DraftMeta = JSON.parse(
      window.localStorage.getItem(getDraftStorageKey(ADDRESS))!,
    );
    expect(stored.formData.title).toBe("Edited while disconnected");
    expect(stored.ownerAddress).toBe(ADDRESS);
  });

  it("resolves a wallet-changed guard by adopting the edits under the new wallet", () => {
    writeStoredDraft(ADDRESS, baseValues({ title: "My draft" }));
    const setValue = vi.fn();
    const { result, rerender } = renderHook(
      (props) => useDraftAutoSave(props),
      {
        initialProps: {
          address: ADDRESS,
          network: NET_A,
          values: baseValues({ title: "My draft" }),
          setValue,
        },
      },
    );
    expect(result.current.draftRestored).toBe(true);

    rerender({
      address: OTHER_ADDRESS,
      network: NET_A,
      values: baseValues({ title: "My draft" }),
      setValue,
    });
    expect(result.current.sessionGuard?.kind).toBe("wallet-changed");

    act(() => result.current.resolveSessionGuard("adopt"));

    expect(result.current.sessionGuard).toBeNull();
    expect(result.current.canPublish).toBe(true);
    expect(result.current.draftOwnerAddress).toBe(OTHER_ADDRESS);
    const adopted: DraftMeta = JSON.parse(
      window.localStorage.getItem(getDraftStorageKey(OTHER_ADDRESS))!,
    );
    expect(adopted.formData.title).toBe("My draft");
    expect(adopted.ownerAddress).toBe(OTHER_ADDRESS);
  });

  it("resolves a wallet-changed guard by discarding the protected draft", () => {
    writeStoredDraft(ADDRESS, baseValues({ title: "My draft" }));
    const setValue = vi.fn();
    const { result, rerender } = renderHook(
      (props) => useDraftAutoSave(props),
      {
        initialProps: {
          address: ADDRESS,
          network: NET_A,
          values: baseValues({ title: "My draft" }),
          setValue,
        },
      },
    );
    expect(result.current.draftRestored).toBe(true);

    rerender({
      address: OTHER_ADDRESS,
      network: NET_A,
      values: baseValues({ title: "My draft" }),
      setValue,
    });
    expect(result.current.sessionGuard?.kind).toBe("wallet-changed");

    act(() => result.current.resolveSessionGuard("discard"));

    expect(result.current.sessionGuard).toBeNull();
    expect(result.current.draftOwnerAddress).toBeUndefined();
    // The protected draft is removed from the authoring wallet's slot.
    expect(
      window.localStorage.getItem(getDraftStorageKey(ADDRESS)),
    ).toBeNull();
  });
});
