import { useCallback, useMemo, useState } from "react";

const STORAGE_KEY = "prompt-hash:recently-viewed";
const MAX_ITEMS = 20;

export interface RecentlyViewedPrompt {
  id: string;
  title: string;
  category: string;
  imageUrl: string;
  viewedAt: string;
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

export function useRecentlyViewed() {
  const [items, setItems] = useState<RecentlyViewedPrompt[]>(() => {
    return readJson<RecentlyViewedPrompt[]>(STORAGE_KEY) ?? [];
  });

  const persist = useCallback((next: RecentlyViewedPrompt[]) => {
    setItems(next);
    writeJson(STORAGE_KEY, next);
  }, []);

  /** Record a prompt view. Deduplicates by id and caps at MAX_ITEMS. */
  const recordView = useCallback(
    (prompt: Omit<RecentlyViewedPrompt, "viewedAt">) => {
      setItems((prev) => {
        const filtered = prev.filter((p) => p.id !== prompt.id);
        const next: RecentlyViewedPrompt[] = [
          { ...prompt, viewedAt: new Date().toISOString() },
          ...filtered,
        ].slice(0, MAX_ITEMS);
        writeJson(STORAGE_KEY, next);
        return next;
      });
    },
    [],
  );

  /** Remove a single entry by id. */
  const remove = useCallback(
    (id: string) => {
      const next = items.filter((p) => p.id !== id);
      persist(next);
    },
    [items, persist],
  );

  /** Clear the entire recently viewed list. */
  const clear = useCallback(() => {
    persist([]);
  }, [persist]);

  return useMemo(
    () => ({ items, recordView, remove, clear }),
    [items, recordView, remove, clear],
  );
}
