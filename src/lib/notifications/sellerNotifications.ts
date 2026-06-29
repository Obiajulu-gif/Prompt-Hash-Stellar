/**
 * Seller notification center — derivation and persistence.
 *
 * The mock/real contract client exposes only point-in-time snapshots of a
 * seller's listings (sales count, active flag, price), not an event log. To
 * surface "what changed", we persist a compact snapshot of the seller's
 * listings per wallet and diff it against the next load to detect new sales and
 * listing updates. Read/unread state and the notification feed are persisted in
 * localStorage so they survive reloads.
 */
import type { PromptRecord } from "@/lib/stellar/promptHashClient";

export type SellerNotificationType = "sale" | "listing";

export interface SellerNotification {
  id: string;
  type: SellerNotificationType;
  promptId: string;
  title: string;
  message: string;
  createdAt: number;
  read: boolean;
}

/** Compact snapshot of a listing used to detect changes between loads. */
export interface PromptSnapshot {
  salesCount: number;
  active: boolean;
  priceStroops: string; // bigint serialised as string
}

export type SnapshotMap = Record<string, PromptSnapshot>;

export interface SellerActivitySummary {
  totalListings: number;
  activeListings: number;
  totalSales: number;
}

const MAX_STORED_NOTIFICATIONS = 50;
const NOTIFICATIONS_PREFIX = "prompt-hash:seller-notifications:";
const SNAPSHOT_PREFIX = "prompt-hash:seller-snapshot:";

export function snapshotOf(prompts: PromptRecord[]): SnapshotMap {
  const map: SnapshotMap = {};
  for (const prompt of prompts) {
    map[prompt.id.toString()] = {
      salesCount: prompt.salesCount ?? 0,
      active: prompt.active,
      priceStroops: prompt.priceStroops.toString(),
    };
  }
  return map;
}

export function summariseActivity(prompts: PromptRecord[]): SellerActivitySummary {
  return {
    totalListings: prompts.length,
    activeListings: prompts.filter((prompt) => prompt.active).length,
    totalSales: prompts.reduce((sum, prompt) => sum + (prompt.salesCount ?? 0), 0),
  };
}

/**
 * Derives new notifications by diffing the previous snapshot against the current
 * listings: new sales, listing/delisting, and price changes. Notification ids
 * are deterministic so the same change never produces a duplicate.
 *
 * On the very first load (no previous snapshot) nothing is emitted — that load
 * only establishes the baseline.
 */
export function deriveNotifications(
  previous: SnapshotMap | null,
  prompts: PromptRecord[],
  now: number,
): SellerNotification[] {
  if (!previous) return [];

  const notifications: SellerNotification[] = [];
  for (const prompt of prompts) {
    const id = prompt.id.toString();
    const before = previous[id];
    if (!before) continue; // a brand-new listing — nothing to diff against yet

    const sales = prompt.salesCount ?? 0;
    if (sales > before.salesCount) {
      const delta = sales - before.salesCount;
      notifications.push({
        id: `sale:${id}:${sales}`,
        type: "sale",
        promptId: id,
        title: prompt.title,
        message:
          delta === 1
            ? `New sale — "${prompt.title}" was purchased (${sales} total).`
            : `${delta} new sales — "${prompt.title}" now has ${sales} total.`,
        createdAt: now,
        read: false,
      });
    }

    if (before.active !== prompt.active) {
      notifications.push({
        id: `listing-active:${id}:${prompt.active}`,
        type: "listing",
        promptId: id,
        title: prompt.title,
        message: prompt.active
          ? `"${prompt.title}" is now listed and available to buyers.`
          : `"${prompt.title}" was delisted and is no longer for sale.`,
        createdAt: now,
        read: false,
      });
    }

    const price = prompt.priceStroops.toString();
    if (before.priceStroops !== price) {
      notifications.push({
        id: `listing-price:${id}:${price}`,
        type: "listing",
        promptId: id,
        title: prompt.title,
        message: `Price updated for "${prompt.title}".`,
        createdAt: now,
        read: false,
      });
    }
  }
  return notifications;
}

/** Prepends fresh notifications, dropping duplicates and capping the stored feed. */
export function mergeNotifications(
  existing: SellerNotification[],
  incoming: SellerNotification[],
): SellerNotification[] {
  const seen = new Set(existing.map((notification) => notification.id));
  const fresh = incoming.filter((notification) => !seen.has(notification.id));
  return [...fresh, ...existing].slice(0, MAX_STORED_NOTIFICATIONS);
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
    // ignore quota / unavailable storage
  }
}

export function loadStoredNotifications(address: string): SellerNotification[] {
  return readJson<SellerNotification[]>(`${NOTIFICATIONS_PREFIX}${address}`) ?? [];
}

export function saveStoredNotifications(
  address: string,
  notifications: SellerNotification[],
): void {
  writeJson(`${NOTIFICATIONS_PREFIX}${address}`, notifications);
}

export function loadSnapshot(address: string): SnapshotMap | null {
  return readJson<SnapshotMap>(`${SNAPSHOT_PREFIX}${address}`);
}

export function saveSnapshot(address: string, prompts: PromptRecord[]): void {
  writeJson(`${SNAPSHOT_PREFIX}${address}`, snapshotOf(prompts));
}
