import React, {
  createContext,
  useState,
  ReactNode,
  useMemo,
  useCallback,
} from "react";
import { Notification as StellarNotification } from "@stellar/design-system";
import "./NotificationProvider.css"; // Import CSS for sliding effect

type NotificationType =
  | "primary"
  | "secondary"
  | "success"
  | "error"
  | "warning";
interface Notification {
  id: string;
  message: string;
  type: NotificationType;
  isVisible: boolean;
  actionLabel?: string;
  onAction?: () => void;
}

export interface NotificationActionOptions {
  /** Label for the action button rendered inside the notification. */
  actionLabel?: string;
  /** Invoked when the action is pressed (typically a retry). */
  onAction?: () => void;
}

interface NotificationContextType {
  addNotification: (
    _message: string,
    _type: NotificationType,
    _options?: NotificationActionOptions,
  ) => void;
}

const NotificationContext = createContext<NotificationContextType | undefined>(
  undefined,
);

import { useOfflineQueue } from "@/hooks/useOfflineQueue";

export const NotificationProvider: React.FC<{ children: ReactNode }> = ({
  children,
}) => {
  const [notifications, setNotifications] = useState<Notification[]>([]);

  const addNotification = useCallback(
    (
      message: string,
      type: NotificationType,
      options?: NotificationActionOptions,
    ) => {
      const hasAction = Boolean(options?.actionLabel && options?.onAction);
      const newNotification: Notification = {
        id: `${type}-${Date.now().toString()}`,
        message,
        type,
        isVisible: true,
        actionLabel: options?.actionLabel,
        onAction: options?.onAction,
      };
      setNotifications((prev) => [...prev, newNotification]);

      if (hasAction) {
        // Action-backed notifications stay visible so the user can act on them.
        setTimeout(() => {
          setNotifications(filterOut(newNotification.id));
        }, 15000);
        return;
      }

      setTimeout(() => {
        setNotifications(markRead(newNotification.id));
      }, 2500); // Start transition out after 2.5 seconds

      setTimeout(() => {
        setNotifications(filterOut(newNotification.id));
      }, 5000); // Remove after 5 seconds
    },
    [],
  );

  const contextValue = useMemo(() => ({ addNotification }), [addNotification]);

  return (
    <NotificationContext.Provider value={contextValue}>
      {children}
      <OfflineQueueManager />
      <div className="notification-container">
        {notifications.map((notification) => (
          <div
            key={notification.id}
            className={`notification ${notification.isVisible ? "slide-in" : "slide-out"}`}
          >
            <StellarNotification
              title={notification.message}
              variant={
                notification.type === "secondary"
                  ? "primary"
                  : notification.type
              }
            />
            {notification.actionLabel && notification.onAction && (
              <button
                type="button"
                className="notification-action"
                onClick={() => {
                  setNotifications(filterOut(notification.id));
                  notification.onAction?.();
                }}
              >
                {notification.actionLabel}
              </button>
            )}
          </div>
        ))}
      </div>
    </NotificationContext.Provider>
  );
};

function markRead(
  id: Notification["id"],
): React.SetStateAction<Notification[]> {
  return (prev) =>
    prev.map((notification) =>
      notification.id === id
        ? { ...notification, isVisible: true }
        : notification,
    );
}

function filterOut(
  id: Notification["id"],
): React.SetStateAction<Notification[]> {
  return (prev) => prev.filter((notification) => notification.id !== id);
}

export { NotificationContext };
export type { NotificationContextType };

function OfflineQueueManager() {
  useOfflineQueue();
  return null;
}
