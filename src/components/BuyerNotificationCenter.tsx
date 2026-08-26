import { Bell, BellRing, RefreshCw, Trash2 } from "lucide-react";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { Button } from "@/components/ui/button";
import { useWallet } from "@/hooks/useWallet";
import { useBuyerNotifications } from "@/hooks/useBuyerNotifications";

function timeAgo(timestamp: string | Date): string {
  const date = new Date(timestamp);
  const minutes = Math.floor((Date.now() - date.getTime()) / 60_000);
  if (minutes < 1) return "just now";
  if (minutes < 60) return `${minutes}m ago`;
  const hours = Math.floor(minutes / 60);
  if (hours < 24) return `${hours}h ago`;
  return `${Math.floor(hours / 24)}d ago`;
}

export function BuyerNotificationCenter() {
  const { address } = useWallet();
  const { notifications, unreadCount, markAllRead, clearAll, isLoading } =
    useBuyerNotifications();

  // Only show for connected wallet
  if (!address) {
    return null;
  }

  return (
    <DropdownMenu
      onOpenChange={(open) => {
        if (open && unreadCount > 0) markAllRead();
      }}
    >
      <DropdownMenuTrigger asChild>
        <Button
          variant="ghost"
          size="icon"
          aria-label={`Buyer notifications${unreadCount > 0 ? ` (${unreadCount} unread)` : ""}`}
          className="relative border border-white/10 text-slate-200 hover:bg-white/10"
          disabled={isLoading}
        >
          {unreadCount > 0 ? (
            <BellRing className="h-5 w-5" />
          ) : (
            <Bell className="h-5 w-5" />
          )}
          {unreadCount > 0 && (
            <span className="absolute -right-1 -top-1 flex h-4 min-w-4 items-center justify-center rounded-full bg-amber-400 px-1 text-[10px] font-bold text-slate-950">
              {unreadCount > 9 ? "9+" : unreadCount}
            </span>
          )}
        </Button>
      </DropdownMenuTrigger>
      <DropdownMenuContent
        align="end"
        className="w-80 border-white/10 bg-slate-950 p-0 text-white"
      >
        <div className="flex items-center justify-between border-b border-white/10 px-4 py-3">
          <p className="text-sm font-semibold">Prompt Updates</p>
          {notifications.length > 0 && (
            <button
              onClick={clearAll}
              className="inline-flex items-center gap-1 text-xs text-slate-400 transition-colors hover:text-white"
            >
              <Trash2 className="h-3 w-3" />
              Clear
            </button>
          )}
        </div>

        <div className="max-h-80 overflow-y-auto">
          {isLoading ? (
            <div className="px-4 py-8 text-center text-xs leading-5 text-slate-400">
              <RefreshCw className="mx-auto h-4 w-4 animate-spin" />
              Loading...
            </div>
          ) : notifications.length === 0 ? (
            <div className="px-4 py-8 text-center text-xs leading-5 text-slate-400">
              No prompt updates yet. When creators update prompts you&apos;ve
              purchased, you&apos;ll see them here.
            </div>
          ) : (
            notifications.map((notification) => (
              <div
                key={notification._id}
                className={`flex gap-3 border-b border-white/5 px-4 py-3 last:border-0 ${
                  !notification.read ? "bg-white/5" : ""
                }`}
              >
                <div className="mt-0.5 flex h-7 w-7 shrink-0 items-center justify-center rounded-full bg-amber-400/10 text-amber-300">
                  <RefreshCw className="h-3.5 w-3.5" />
                </div>
                <div className="min-w-0 flex-1">
                  <p className="text-xs leading-5 text-slate-200">
                    {notification.message}
                  </p>
                  {notification.changeNote && (
                    <p className="mt-1 text-[10px] text-slate-400 italic">
                      &quot;{notification.changeNote}&quot;
                    </p>
                  )}
                  <p className="mt-0.5 text-[10px] text-slate-500">
                    {timeAgo(notification.createdAt)}
                  </p>
                </div>
              </div>
            ))
          )}
        </div>
      </DropdownMenuContent>
    </DropdownMenu>
  );
}
