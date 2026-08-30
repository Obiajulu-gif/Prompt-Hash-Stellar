import { useState, useEffect, useCallback } from "react";
import storage from "@/util/storage";
import { useNotification } from "@/hooks/useNotification";

export type QueuedActionType = "DRAFT_SAVE" | "ARCHIVE_DRAFT";

export interface QueuedAction {
  id: string;
  type: QueuedActionType;
  payload: any;
  timestamp: number;
  status: "pending" | "failed";
}

export function useOfflineQueue() {
  const [isOnline, setIsOnline] = useState<boolean>(
    typeof navigator !== "undefined" ? navigator.onLine : true
  );
  const [queue, setQueue] = useState<QueuedAction[]>([]);
  const { addNotification } = useNotification();

  // Initialize from storage
  useEffect(() => {
    const stored = storage.getItem("offlineQueue", "safe") || [];
    setQueue(stored);
  }, []);

  const updateQueue = useCallback((newQueue: QueuedAction[]) => {
    setQueue(newQueue);
    storage.setItem("offlineQueue", newQueue);
  }, []);

  const enqueueAction = useCallback((type: QueuedActionType, payload: any) => {
    const action: QueuedAction = {
      id: `${type}-${Date.now()}-${Math.random().toString(36).substring(2, 9)}`,
      type,
      payload,
      timestamp: Date.now(),
      status: "pending",
    };
    const newQueue = [...(storage.getItem("offlineQueue", "safe") || []), action];
    updateQueue(newQueue);
    addNotification("Action queued while offline.", "warning");
  }, [addNotification, updateQueue]);

  const processQueue = useCallback(async () => {
    const currentQueue = storage.getItem("offlineQueue", "safe") || [];
    if (currentQueue.length === 0) return;

    let hasErrors = false;
    let reconciledCount = 0;
    const remainingQueue: QueuedAction[] = [];

    for (const action of currentQueue) {
      try {
        if (action.type === "ARCHIVE_DRAFT") {
          const res = await fetch(`/api/prompts/${action.payload.id}/archive`, {
            method: "POST",
            headers: {
              "Idempotency-Key": action.id, // For idempotency
            },
          });
          if (!res.ok) {
            if (res.status === 409) {
               addNotification("Conflict detected during draft archive.", "error");
            }
            throw new Error("Failed to archive");
          }
        }
        reconciledCount++;
      } catch (error) {
        console.error("Queue sync error for action:", action, error);
        hasErrors = true;
        remainingQueue.push({ ...action, status: "failed" });
      }
    }

    updateQueue(remainingQueue);

    if (reconciledCount > 0) {
      addNotification(`${reconciledCount} queued actions synced successfully.`, "success");
    }
    if (hasErrors) {
      addNotification("Some queued actions failed to sync.", "error");
    }
  }, [addNotification, updateQueue]);

  useEffect(() => {
    const handleOnline = () => {
      setIsOnline(true);
      processQueue();
    };
    const handleOffline = () => setIsOnline(false);

    window.addEventListener("online", handleOnline);
    window.addEventListener("offline", handleOffline);

    return () => {
      window.removeEventListener("online", handleOnline);
      window.removeEventListener("offline", handleOffline);
    };
  }, [processQueue]);

  return { isOnline, queue, enqueueAction, processQueue };
}
