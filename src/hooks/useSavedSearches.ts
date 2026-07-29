import { useState, useEffect, useCallback, useMemo } from 'react';
import { useWallet } from '@/hooks/useWallet';

export interface SavedSearchFilter {
  searchQuery: string;
  category: string;
  priceRange: [number, number];
  sortBy: string;
  tag?: string;
}

export interface SavedSearch {
  id: string;
  name: string;
  walletAddress: string;
  filter: SavedSearchFilter;
  alertsEnabled: boolean;
  createdAt: number;
}

export interface SearchListingAlert {
  id: string;
  savedSearchId: string;
  savedSearchName: string;
  listingId: string;
  listingTitle: string;
  listingCategory?: string;
  listingPrice: string | number;
  walletAddress: string;
  createdAt: number;
  read: boolean;
}

const SEARCHES_STORAGE_KEY_PREFIX = 'prompthash_saved_searches_';
const ALERTS_STORAGE_KEY_PREFIX = 'prompthash_search_alerts_';
const SEEN_ALERTS_KEY_PREFIX = 'prompthash_seen_alerts_';

export function useSavedSearches() {
  const { address } = useWallet();
  const activeWallet = address || 'anonymous_guest';

  const searchesKey = `${SEARCHES_STORAGE_KEY_PREFIX}${activeWallet}`;
  const alertsKey = `${ALERTS_STORAGE_KEY_PREFIX}${activeWallet}`;
  const seenAlertsKey = `${SEEN_ALERTS_KEY_PREFIX}${activeWallet}`;

  const [savedSearches, setSavedSearches] = useState<SavedSearch[]>(() => {
    try {
      const raw = localStorage.getItem(searchesKey);
      return raw ? JSON.parse(raw) : [];
    } catch {
      return [];
    }
  });

  const [alerts, setAlerts] = useState<SearchListingAlert[]>(() => {
    try {
      const raw = localStorage.getItem(alertsKey);
      return raw ? JSON.parse(raw) : [];
    } catch {
      return [];
    }
  });

  // Re-load when activeWallet changes
  useEffect(() => {
    try {
      const rawSearches = localStorage.getItem(searchesKey);
      setSavedSearches(rawSearches ? JSON.parse(rawSearches) : []);

      const rawAlerts = localStorage.getItem(alertsKey);
      setAlerts(rawAlerts ? JSON.parse(rawAlerts) : []);
    } catch {
      setSavedSearches([]);
      setAlerts([]);
    }
  }, [searchesKey, alertsKey]);

  // Persist searches
  const persistSearches = useCallback((searches: SavedSearch[]) => {
    setSavedSearches(searches);
    try {
      localStorage.setItem(searchesKey, JSON.stringify(searches));
    } catch (e) {
      console.error('Failed to save searches to localStorage:', e);
    }
  }, [searchesKey]);

  // Persist alerts
  const persistAlerts = useCallback((newAlerts: SearchListingAlert[]) => {
    setAlerts(newAlerts);
    try {
      localStorage.setItem(alertsKey, JSON.stringify(newAlerts));
    } catch (e) {
      console.error('Failed to save alerts to localStorage:', e);
    }
  }, [alertsKey]);

  // Save current search
  const saveSearch = useCallback(
    (name: string, filter: SavedSearchFilter, alertsEnabled = true): SavedSearch => {
      const newSearch: SavedSearch = {
        id: `search_${Date.now()}_${Math.random().toString(36).slice(2, 7)}`,
        name: name.trim() || `Search (${filter.category || 'All'}, ${filter.searchQuery || 'any'})`,
        walletAddress: activeWallet,
        filter: {
          searchQuery: filter.searchQuery || '',
          category: filter.category || '',
          priceRange: filter.priceRange || [0, 25],
          sortBy: filter.sortBy || 'recent',
          tag: filter.tag || '',
        },
        alertsEnabled,
        createdAt: Date.now(),
      };

      const updated = [newSearch, ...savedSearches];
      persistSearches(updated);
      return newSearch;
    },
    [activeWallet, savedSearches, persistSearches]
  );

  // Rename search
  const renameSearch = useCallback(
    (id: string, newName: string) => {
      const updated = savedSearches.map((s) => (s.id === id ? { ...s, name: newName } : s));
      persistSearches(updated);
    },
    [savedSearches, persistSearches]
  );

  // Toggle alerts per search
  const toggleAlerts = useCallback(
    (id: string, enabled?: boolean) => {
      const updated = savedSearches.map((s) =>
        s.id === id ? { ...s, alertsEnabled: enabled !== undefined ? enabled : !s.alertsEnabled } : s
      );
      persistSearches(updated);
    },
    [savedSearches, persistSearches]
  );

  // Delete search
  const deleteSearch = useCallback(
    (id: string) => {
      const updated = savedSearches.filter((s) => s.id !== id);
      persistSearches(updated);
    },
    [savedSearches, persistSearches]
  );

  // Check new/indexed listings against saved searches and generate alerts (preventing duplicates)
  const processListingAlerts = useCallback(
    (listings: Array<{ id: string; title: string; category?: string; price?: string | number; tags?: string[] }>) => {
      if (!listings || listings.length === 0 || savedSearches.length === 0) return [];

      let seenKeys: Set<string>;
      try {
        const raw = localStorage.getItem(seenAlertsKey);
        seenKeys = new Set(raw ? JSON.parse(raw) : []);
      } catch {
        seenKeys = new Set();
      }

      const generatedAlerts: SearchListingAlert[] = [];

      for (const search of savedSearches) {
        if (!search.alertsEnabled) continue;

        for (const item of listings) {
          const alertDedupKey = `${search.id}:${item.id}`;
          if (seenKeys.has(alertDedupKey)) continue;

          // Matching criteria
          const q = search.filter.searchQuery.toLowerCase();
          const matchesQuery =
            !q || item.title.toLowerCase().includes(q) || (item.category && item.category.toLowerCase().includes(q));

          const matchesCategory =
            !search.filter.category || item.category === search.filter.category;

          let numPrice = 0;
          if (typeof item.price === 'number') {
            numPrice = item.price;
          } else if (typeof item.price === 'string') {
            numPrice = parseFloat(item.price.replace(/[^\d.]/g, '')) || 0;
          }

          const matchesPrice =
            numPrice >= search.filter.priceRange[0] && numPrice <= search.filter.priceRange[1];

          const matchesTag =
            !search.filter.tag || (item.tags && item.tags.includes(search.filter.tag));

          if (matchesQuery && matchesCategory && matchesPrice && matchesTag) {
            seenKeys.add(alertDedupKey);
            generatedAlerts.push({
              id: `alert_${Date.now()}_${Math.random().toString(36).slice(2, 7)}`,
              savedSearchId: search.id,
              savedSearchName: search.name,
              listingId: item.id,
              listingTitle: item.title,
              listingCategory: item.category,
              listingPrice: item.price,
              walletAddress: activeWallet,
              createdAt: Date.now(),
              read: false,
            });
          }
        }
      }

      if (generatedAlerts.length > 0) {
        try {
          localStorage.setItem(seenAlertsKey, JSON.stringify(Array.from(seenKeys)));
        } catch {
          // ignore
        }
        const updatedAlerts = [...generatedAlerts, ...alerts];
        persistAlerts(updatedAlerts);
      }

      return generatedAlerts;
    },
    [savedSearches, seenAlertsKey, activeWallet, alerts, persistAlerts]
  );

  const markAlertRead = useCallback(
    (alertId: string) => {
      const updated = alerts.map((a) => (a.id === alertId ? { ...a, read: true } : a));
      persistAlerts(updated);
    },
    [alerts, persistAlerts]
  );

  const clearAlerts = useCallback(() => {
    persistAlerts([]);
  }, [persistAlerts]);

  const unreadAlertCount = useMemo(() => alerts.filter((a) => !a.read).length, [alerts]);

  return {
    savedSearches,
    alerts,
    unreadAlertCount,
    saveSearch,
    renameSearch,
    toggleAlerts,
    deleteSearch,
    processListingAlerts,
    markAlertRead,
    clearAlerts,
  };
}
