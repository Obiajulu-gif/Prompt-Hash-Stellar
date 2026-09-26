import { useState } from "react";
import { useNavigate } from "react-router-dom";
import {
  AlertCircle,
  Bell,
  BellRing,
  CheckCircle2,
  RefreshCw,
  Settings,
  ShieldAlert,
  ShoppingBag,
  Trash2,
  UserCheck,
  X,
} from "lucide-react";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { Button } from "@/components/ui/button";
import { useWallet } from "@/hooks/useWallet";
import {
  useBuyerNotifications,
  type BuyerNotification,
} from "@/hooks/useBuyerNotifications";
import type { NotificationType } from "@/hooks/notificationTypes";
import { NOTIFICATION_TYPE_LABELS } from "@/hooks/notificationTypes";

// ── Helpers ────────────────────────────────────────────────────────────────

function timeAgo(timestamp: string | Date): string {
  const date = new Date(timestamp);
  const minutes = Math.floor((Date.now() - date.getTime()) / 60_000);
  if (minutes < 1) return "just now";
  if (minutes < 60) return `${minutes}m ago`;
  const hours = Math.floor(minutes / 60);
  if (hours < 24) return `${hours}h ago`;
  return `${Math.floor(hours / 24)}d ago`;
}

function NotificationIcon({ type }: { type: NotificationType }) {
  const base = "h-3.5 w-3.5";
  switch (type) {
    case "purchase_confirmed":
      return <ShoppingBag className={base} />;
    case "dispute_opened":
      return <AlertCircle className={base} />;
    case "dispute_resolved":
      return <CheckCircle2 className={base} />;
    case "payout_available":
      return <CheckCircle2 className={base} />;
    case "moderation_action":
      return <ShieldAlert className={base} />;
    case "ownership_transfer":
      return <UserCheck className={base} />;
    case "system":
      return <Bell className={base} />;
    case "prompt_update":
    default:
      return <RefreshCw className={base} />;
  }
}

function iconBgFor(type: NotificationType): string {
  switch (type) {
    case "purchase_confirmed":
      return "bg-emerald-400/10 text-emerald-300";
    case "dispute_opened":
      return "bg-red-400/10 text-red-300";
    case "dispute_resolved":
      return "bg-blue-400/10 text-blue-300";
    case "payout_available":
      return "bg-emerald-400/10 text-emerald-300";
    case "moderation_action":
      return "bg-orange-400/10 text-orange-300";
    case "ownership_transfer":
      return "bg-purple-400/10 text-purple-300";
    case "system":
      return "bg-slate-400/10 text-slate-300";
    case "prompt_update":
    default:
      return "bg-amber-400/10 text-amber-300";
  }
}

// ── Preferences panel ──────────────────────────────────────────────────────

const ALL_TYPES: NotificationType[] = [
  "purchase_confirmed",
  "dispute_opened",
  "dispute_resolved",
  "payout_available",
  "moderation_action",
  "ownership_transfer",
  "prompt_update",
  "system",
];

function PreferencesPanel({
  mutedTypes,
  onToggle,
  onClose,
}: {
  mutedTypes: NotificationType[];
  onToggle: (type: NotificationType) => void;
  onClose: () => void;
}) {
  return (
    <div className="px-4 py-3">
      <div className="mb-3 flex items-center justify-between">
        <p className="text-sm font-semibold">Notification preferences</p>
        <button
          onClick={onClose}
          aria-label="Close preferences"
          className="text-slate-400 hover:text-white"
        >
          <X className="h-4 w-4" />
        </button>
      </div>
      <p className="mb-3 text-xs text-slate-400">
        Muted types will not create new notifications.
      </p>
      <div className="space-y-2">
        {ALL_TYPES.map((type) => {
          const muted = mutedTypes.includes(type);
          return (
            <label
              key={type}
              className="flex cursor-pointer items-center justify-between rounded-md px-2 py-1 hover:bg-white/5"
            >
              <span className="text-xs text-slate-200">
                {NOTIFICATION_TYPE_LABELS[type]}
              </span>
              <button
                role="switch"
                aria-checked={!muted}
                onClick={() => onToggle(type)}
                className={`relative h-4 w-7 rounded-full transition-colors ${
                  muted ? "bg-slate-600" : "bg-amber-400"
                }`}
              >
                <span
                  className={`absolute top-0.5 h-3 w-3 rounded-full bg-white transition-transform ${
                    muted ? "left-0.5" : "left-3.5"
                  }`}
                />
              </button>
            </label>
          );
        })}
      </div>
    </div>
  );
}

// ── Notification row ────────────────────────────────────────────────────────

function NotificationRow({
  notification,
  onNavigate,
  onMarkRead,
}: {
  notification: BuyerNotification;
  onNavigate: (path: string) => void;
  onMarkRead: (id: string) => void;
}) {
  const handleClick = () => {
    if (!notification.read) onMarkRead(notification._id);
    if (notification.deepLink) onNavigate(notification.deepLink);
  };

  return (
    <button
      type="button"
      onClick={handleClick}
      className={`flex w-full gap-3 border-b border-white/5 px-4 py-3 text-left last:border-0 transition-colors hover:bg-white/[0.06] ${
        !notification.read ? "bg-white/5" : ""
      }`}
    >
      <div
        className={`mt-0.5 flex h-7 w-7 shrink-0 items-center justify-center rounded-full ${iconBgFor(notification.type)}`}
        aria-hidden="true"
      >
        <NotificationIcon type={notification.type} />
      </div>
      <div className="min-w-0 flex-1">
        <p className="text-xs leading-5 text-slate-200">
          {notification.message}
        </p>
        {notification.changeNote && (
          <p className="mt-0.5 text-[10px] italic text-slate-400">
            &quot;{notification.changeNote}&quot;
          </p>
        )}
        <div className="mt-0.5 flex items-center gap-2">
          <span className="text-[10px] text-slate-500">
            {timeAgo(notification.createdAt)}
          </span>
          <span className="text-[10px] text-slate-600">
            {NOTIFICATION_TYPE_LABELS[notification.type]}
          </span>
          {!notification.read && (
            <span
              className="ml-auto h-1.5 w-1.5 rounded-full bg-amber-400"
              aria-label="Unread"
            />
          )}
        </div>
      </div>
    </button>
  );
}

// ── Main component ──────────────────────────────────────────────────────────

export function BuyerNotificationCenter() {
  const { address } = useWallet();
  const navigate = useNavigate();
  const {
    notifications,
    unreadCount,
    isLoading,
    preferences,
    markAllRead,
    markOneRead,
    clearAll,
    updatePreferences,
  } = useBuyerNotifications();

  const [showPreferences, setShowPreferences] = useState(false);

  if (!address) return null;

  const mutedTypes: NotificationType[] = preferences?.mutedTypes ?? [];

  const handleToggleMute = async (type: NotificationType) => {
    const next = mutedTypes.includes(type)
      ? mutedTypes.filter((t) => t !== type)
      : [...mutedTypes, type];
    await updatePreferences({ mutedTypes: next });
  };

  const handleOpenChange = (open: boolean) => {
    if (open && unreadCount > 0) void markAllRead();
    if (!open) setShowPreferences(false);
  };

  return (
    <DropdownMenu onOpenChange={handleOpenChange}>
      <DropdownMenuTrigger asChild>
        <Button
          variant="ghost"
          size="icon"
          aria-label={`Notifications${unreadCount > 0 ? ` (${unreadCount} unread)` : ""}`}
          className="relative border border-white/10 text-slate-200 hover:bg-white/10"
          disabled={isLoading}
        >
          {unreadCount > 0 ? (
            <BellRing className="h-5 w-5" />
          ) : (
            <Bell className="h-5 w-5" />
          )}
          {unreadCount > 0 && (
            <span
              aria-hidden="true"
              className="absolute -right-1 -top-1 flex h-4 min-w-4 items-center justify-center rounded-full bg-amber-400 px-1 text-[10px] font-bold text-slate-950"
            >
              {unreadCount > 9 ? "9+" : unreadCount}
            </span>
          )}
        </Button>
      </DropdownMenuTrigger>

      <DropdownMenuContent
        align="end"
        className="w-80 border-white/10 bg-slate-950 p-0 text-white"
      >
        {/* Header */}
        <div className="flex items-center justify-between border-b border-white/10 px-4 py-3">
          <p className="text-sm font-semibold">Notifications</p>
          <div className="flex items-center gap-2">
            <button
              onClick={() => setShowPreferences((v) => !v)}
              aria-label="Notification preferences"
              className="text-slate-400 transition-colors hover:text-white"
            >
              <Settings className="h-4 w-4" />
            </button>
            {notifications.length > 0 && (
              <button
                onClick={() => void clearAll()}
                aria-label="Clear all notifications"
                className="inline-flex items-center gap-1 text-xs text-slate-400 transition-colors hover:text-white"
              >
                <Trash2 className="h-3 w-3" />
                Clear
              </button>
            )}
          </div>
        </div>

        {/* Preferences panel (toggleable) */}
        {showPreferences ? (
          <PreferencesPanel
            mutedTypes={mutedTypes}
            onToggle={(type) => void handleToggleMute(type)}
            onClose={() => setShowPreferences(false)}
          />
        ) : (
          <div
            className="max-h-80 overflow-y-auto"
            role="list"
            aria-label="Notifications list"
          >
            {isLoading ? (
              <div className="flex flex-col items-center justify-center gap-2 px-4 py-8 text-xs text-slate-400">
                <RefreshCw
                  className="h-4 w-4 animate-spin"
                  aria-hidden="true"
                />
                Loading…
              </div>
            ) : notifications.length === 0 ? (
              <div className="px-4 py-8 text-center text-xs leading-5 text-slate-400">
                No notifications yet. Purchases, disputes, and prompt updates
                will appear here.
              </div>
            ) : (
              notifications.map((n) => (
                <NotificationRow
                  key={n._id}
                  notification={n}
                  onNavigate={(path) => navigate(path)}
                  onMarkRead={(id) => void markOneRead(id)}
                />
              ))
            )}
          </div>
        )}
      </DropdownMenuContent>
    </DropdownMenu>
  );
}
