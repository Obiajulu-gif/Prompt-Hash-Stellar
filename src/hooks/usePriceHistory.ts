import { useCallback, useEffect, useRef, useState } from "react";

export interface PriceChangeEntry {
  _id: string;
  promptId: string;
  previousPrice: number | null;
  newPrice: number;
  asset: string;
  createdAt: string;
  ledgerSeq: number | null;
  txHash: string;
}

interface PriceHistoryResponse {
  data: PriceChangeEntry[];
  metadata: {
    hasNextPage: boolean;
    nextCursor: string | null;
  };
}

const API_BASE_URL = import.meta.env.VITE_API_BASE_URL || "http://localhost:5000";

export function usePriceHistory(onChainId: string | undefined) {
  const [changes, setChanges] = useState<PriceChangeEntry[]>([]);
  const [isLoading, setIsLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [hasMore, setHasMore] = useState(false);
  const cursorRef = useRef<string | null>(null);
  const mountedRef = useRef(true);

  useEffect(() => {
    mountedRef.current = true;
    return () => {
      mountedRef.current = false;
    };
  }, []);

  const fetchPage = useCallback(
    async (cursor?: string | null) => {
      if (!onChainId) return;

      setIsLoading(true);
      setError(null);

      try {
        const params = new URLSearchParams({ limit: "20" });
        if (cursor) params.set("cursor", cursor);

        const response = await fetch(
          `${API_BASE_URL}/api/prompts/${onChainId}/price-history?${params}`,
        );
        if (!response.ok) {
          throw new Error(`Failed to fetch price history (${response.status})`);
        }

        const result: PriceHistoryResponse = await response.json();

        if (!mountedRef.current) return;

        if (cursor) {
          setChanges((prev) => [...prev, ...result.data]);
        } else {
          setChanges(result.data);
        }

        cursorRef.current = result.metadata.nextCursor;
        setHasMore(result.metadata.hasNextPage);
      } catch (err) {
        if (mountedRef.current) {
          setError(err instanceof Error ? err.message : "Unknown error");
        }
      } finally {
        if (mountedRef.current) {
          setIsLoading(false);
        }
      }
    },
    [onChainId],
  );

  const loadMore = useCallback(() => {
    if (!isLoading && hasMore) {
      fetchPage(cursorRef.current);
    }
  }, [fetchPage, isLoading, hasMore]);

  useEffect(() => {
    setChanges([]);
    cursorRef.current = null;
    setHasMore(false);
    setError(null);
    fetchPage(null);
  }, [fetchPage]);

  return { changes, isLoading, error, hasMore, loadMore };
}