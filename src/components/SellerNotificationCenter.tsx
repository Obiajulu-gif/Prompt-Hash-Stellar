import { Bell, BellRing, ShoppingBag, Tag, Trash2 } from "lucide-react";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { Button } from "@/components/ui/button";
import { useWallet } from "@/hooks/useWallet";
import { useSellerNotifications } from "@/hooks/useSellerNotifications";

function timeAgo(timestamp: number): string {
  const minutes = Math.floor((Date.now() - timestamp) / 60_000);
  if (minutes < 1) return "just now";
  if (minutes < 60) return `${minutes}m ago`;
  const hours = Math.floor(minutes / 60);
  if (hours < 24) return `${hours}h ago`;
  return `${Math.floor(hours / 24)}d ago`;
}

function Stat({ label, value }: { label: string; value: number }) {
  return (
    <div className="bg-slate-950 px-2 py-2.5">
      <p className="text-sm font-bold text-white">{value}</p>
      <p className="text-[10px] uppercase tracking-wider text-slate-500">{label}</p>
    </div>
  );
}

export function SellerNotificationCenter() {
  const { address } = useWallet();
  const { notifications, unreadCount, summary, hasListings, markAllRead, clearAll } =
    useSellerNotifications();

  // Only meaningful for a connected seller — a wallet with listings or a feed
  // of past activity.
  if (!address || (!hasListings && notifications.length === 0)) {
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
          aria-label={`Seller notifications${unreadCount > 0 ? ` (${unreadCount} unread)` : ""}`}
          className="relative border border-white/10 text-slate-200 hover:bg-white/10"
        >
          {unreadCount > 0 ? (
            <BellRing className="h-5 w-5" />
          ) : (
            <Bell className="h-5 w-5" />
          )}
          {unreadCount > 0 && (
            <span className="absolute -right-1 -top-1 flex h-4 min-w-4 items-center justify-center rounded-full bg-cyan-400 px-1 text-[10px] font-bold text-slate-950">
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
          <p className="text-sm font-semibold">Notifications</p>
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

        {/* Purchase activity summary */}
        <div className="grid grid-cols-3 gap-px border-b border-white/10 bg-white/10 text-center">
          <Stat label="Listings" value={summary.totalListings} />
          <Stat label="Active" value={summary.activeListings} />
          <Stat label="Sales" value={summary.totalSales} />
        </div>

        <div className="max-h-80 overflow-y-auto">
          {notifications.length === 0 ? (
            <div className="px-4 py-8 text-center text-xs leading-5 text-slate-400">
              You&apos;re all caught up. New sales and listing updates will show
              up here.
            </div>
          ) : (
            notifications.map((notification) => (
              <div
                key={notification.id}
                className="flex gap-3 border-b border-white/5 px-4 py-3 last:border-0"
              >
                <div
                  className={`mt-0.5 flex h-7 w-7 shrink-0 items-center justify-center rounded-full ${
                    notification.type === "sale"
                      ? "bg-emerald-400/10 text-emerald-300"
                      : "bg-cyan-400/10 text-cyan-300"
                  }`}
                >
                  {notification.type === "sale" ? (
                    <ShoppingBag className="h-3.5 w-3.5" />
                  ) : (
                    <Tag className="h-3.5 w-3.5" />
                  )}
                </div>
                <div className="min-w-0">
                  <p className="text-xs leading-5 text-slate-200">
                    {notification.message}
                  </p>
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
