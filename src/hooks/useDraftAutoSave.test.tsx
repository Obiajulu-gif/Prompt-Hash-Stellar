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
