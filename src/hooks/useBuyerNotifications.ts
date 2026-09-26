import { useCallback, useEffect, useMemo, useState } from "react";
import { useWallet } from "@/hooks/useWallet";
import type { NotificationType } from "./notificationTypes";

export type { NotificationType };

export interface BuyerNotification {
  _id: string;
  recipientWallet: string;
  promptId: string | null;
  promptTitle: string;
  type: NotificationType;
  message: string;
  deepLink: string | null;
  versionIndex: number | null;
  changeNote: string;
  read: boolean;
  createdAt: string;
  updatedAt: string;
}

export interface NotificationPreferences {
  walletAddress: string;
  mutedTypes: NotificationType[];
  emailEnabled: boolean;
}

export interface UseBuyerNotifications {
  notifications: BuyerNotification[];
  unreadCount: number;
  isLoading: boolean;
  preferences: NotificationPreferences | null;
  markAllRead: () => Promise<void>;
  markOneRead: (notificationId: string) => Promise<void>;
  clearAll: () => Promise<void>;
  updatePreferences: (
    patch: Partial<Omit<NotificationPreferences, "walletAddress">>,
  ) => Promise<void>;
  refetch: () => void;
}

const API_BASE = "/api/notifications";

export function useBuyerNotifications(): UseBuyerNotifications {
  const { address } = useWallet();
  const [notifications, setNotifications] = useState<BuyerNotification[]>([]);
  const [preferences, setPreferences] =
    useState<NotificationPreferences | null>(null);
  const [isLoading, setIsLoading] = useState(false);

  const fetchNotifications = useCallback(async () => {
    if (!address) return;
    setIsLoading(true);
    try {
      const [notifRes, prefRes] = await Promise.all([
        fetch(`${API_BASE}/${address}?limit=50`),
        fetch(`${API_BASE}/${address}/preferences`),
      ]);
      if (notifRes.ok) {
        const data = await notifRes.json();
        // API returns { notifications, page, total, ... } shape after pagination refactor.
        setNotifications(
          Array.isArray(data) ? data : (data.notifications ?? []),
        );
      }
      if (prefRes.ok) {
        setPreferences(await prefRes.json());
      }
    } catch (error) {
      console.error("Failed to fetch notifications:", error);
    } finally {
      setIsLoading(false);
    }
  }, [address]);

  useEffect(() => {
    void fetchNotifications();
    // Poll every 60 s to pick up new notifications without a websocket.
    const id = setInterval(() => void fetchNotifications(), 60_000);
    return () => clearInterval(id);
  }, [fetchNotifications]);

  const unreadCount = useMemo(
    () => notifications.filter((n) => !n.read).length,
    [notifications],
  );

  const markAllRead = useCallback(async () => {
    if (!address) return;
    try {
      const res = await fetch(`${API_BASE}/${address}/mark-read`, {
        method: "POST",
      });
      if (res.ok) {
        setNotifications((prev) => prev.map((n) => ({ ...n, read: true })));
      }
    } catch (err) {
      console.error("Failed to mark all notifications as read:", err);
    }
  }, [address]);

  const markOneRead = useCallback(
    async (notificationId: string) => {
      if (!address) return;
      try {
        const res = await fetch(`${API_BASE}/${address}/mark-read`, {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ notificationId }),
        });
        if (res.ok) {
          setNotifications((prev) =>
            prev.map((n) =>
              n._id === notificationId ? { ...n, read: true } : n,
            ),
          );
        }
      } catch (err) {
        console.error("Failed to mark notification as read:", err);
      }
    },
    [address],
  );

  const clearAll = useCallback(async () => {
    if (!address) return;
    try {
      const res = await fetch(`${API_BASE}/${address}`, { method: "DELETE" });
      if (res.ok) setNotifications([]);
    } catch (err) {
      console.error("Failed to clear notifications:", err);
    }
  }, [address]);

  const updatePreferences = useCallback(
    async (patch: Partial<Omit<NotificationPreferences, "walletAddress">>) => {
      if (!address) return;
      try {
        const res = await fetch(`${API_BASE}/${address}/preferences`, {
          method: "PUT",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify(patch),
        });
        if (res.ok) setPreferences(await res.json());
      } catch (err) {
        console.error("Failed to update notification preferences:", err);
      }
    },
    [address],
  );

  return {
    notifications,
    unreadCount,
    isLoading,
    preferences,
    markAllRead,
    markOneRead,
    clearAll,
    updatePreferences,
    refetch: fetchNotifications,
  };
}
