import { useCallback, useEffect, useMemo, useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { useWallet } from "@/hooks/useWallet";
import { browserStellarConfig } from "@/lib/stellar/browserConfig";
import { getPromptsByCreator } from "@/lib/stellar/promptHashClient";
import {
  deriveNotifications,
  loadSnapshot,
  loadStoredNotifications,
  mergeNotifications,
  saveSnapshot,
  saveStoredNotifications,
  summariseActivity,
  type SellerActivitySummary,
  type SellerNotification,
} from "@/lib/notifications/sellerNotifications";

export interface UseSellerNotifications {
  notifications: SellerNotification[];
  unreadCount: number;
  summary: SellerActivitySummary;
  hasListings: boolean;
  markAllRead: () => void;
  clearAll: () => void;
}

export function useSellerNotifications(): UseSellerNotifications {
  const { address } = useWallet();
  const [notifications, setNotifications] = useState<SellerNotification[]>([]);

  const { data: prompts = [] } = useQuery({
    queryKey: ["created-prompts", address],
    queryFn: () =>
      address ? getPromptsByCreator(browserStellarConfig, address) : [],
    enabled: Boolean(address),
    refetchInterval: 60_000,
  });

  // Load the persisted feed whenever the connected wallet changes.
  useEffect(() => {
    if (!address) {
      setNotifications([]);
      return;
    }
    setNotifications(loadStoredNotifications(address));
  }, [address]);

  // Diff incoming listings against the stored snapshot to surface new events.
  useEffect(() => {
    if (!address || prompts.length === 0) return;
    const previous = loadSnapshot(address);
    const fresh = deriveNotifications(previous, prompts, Date.now());
    saveSnapshot(address, prompts);
    if (fresh.length === 0) return;
    setNotifications((current) => {
      const merged = mergeNotifications(current, fresh);
      saveStoredNotifications(address, merged);
      return merged;
    });
  }, [address, prompts]);

  const summary = useMemo(() => summariseActivity(prompts), [prompts]);
  const unreadCount = useMemo(
    () => notifications.filter((notification) => !notification.read).length,
    [notifications],
  );

  const markAllRead = useCallback(() => {
    if (!address) return;
    setNotifications((current) => {
      const updated = current.map((notification) => ({ ...notification, read: true }));
      saveStoredNotifications(address, updated);
      return updated;
    });
  }, [address]);

  const clearAll = useCallback(() => {
    if (!address) return;
    setNotifications([]);
    saveStoredNotifications(address, []);
  }, [address]);

  return {
    notifications,
    unreadCount,
    summary,
    hasListings: prompts.length > 0,
    markAllRead,
    clearAll,
  };
}
