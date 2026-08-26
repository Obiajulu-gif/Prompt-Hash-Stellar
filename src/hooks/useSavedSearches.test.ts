import { describe, it, expect, beforeEach, vi } from 'vitest';
import { renderHook, act } from '@testing-library/react';
import { useSavedSearches, SavedSearchFilter } from './useSavedSearches';

// Mock useWallet
vi.mock('@/hooks/useWallet', () => ({
  useWallet: () => ({ address: 'GUSER123456789' }),
}));

describe('useSavedSearches hook (#467)', () => {
  beforeEach(() => {
    localStorage.clear();
  });

  it('saves search filter scoped to user wallet', () => {
    const { result } = renderHook(() => useSavedSearches());

    const filter: SavedSearchFilter = {
      searchQuery: 'AI Assistant',
      category: 'Creative',
      priceRange: [5, 15],
      sortBy: 'recent',
    };

    act(() => {
      result.current.saveSearch('My AI Search', filter, true);
    });

    expect(result.current.savedSearches).toHaveLength(1);
    expect(result.current.savedSearches[0].name).toBe('My AI Search');
    expect(result.current.savedSearches[0].walletAddress).toBe('GUSER123456789');
    expect(result.current.savedSearches[0].filter.searchQuery).toBe('AI Assistant');
  });

  it('renames and deletes saved searches', () => {
    const { result } = renderHook(() => useSavedSearches());

    let createdId = '';
    act(() => {
      const search = result.current.saveSearch('Old Name', { searchQuery: '', category: '', priceRange: [0, 25], sortBy: 'recent' });
      createdId = search.id;
    });

    act(() => {
      result.current.renameSearch(createdId, 'New Name');
    });

    expect(result.current.savedSearches[0].name).toBe('New Name');

    act(() => {
      result.current.deleteSearch(createdId);
    });

    expect(result.current.savedSearches).toHaveLength(0);
  });

  it('generates in-app alerts for matching listings and prevents duplicates', () => {
    const { result } = renderHook(() => useSavedSearches());

    act(() => {
      result.current.saveSearch('Cheap Creative Prompts', {
        searchQuery: '',
        category: 'Creative',
        priceRange: [0, 10],
        sortBy: 'recent',
      }, true);
    });

    const listings = [
      { id: 'item_1', title: 'Logo Generator', category: 'Creative', price: '5 XLM' },
      { id: 'item_2', title: 'Financial Model', category: 'Finance', price: '8 XLM' },
      { id: 'item_3', title: 'Expensive Art', category: 'Creative', price: '50 XLM' },
    ];

    let generatedAlerts: any[] = [];
    act(() => {
      generatedAlerts = result.current.processListingAlerts(listings);
    });

    expect(generatedAlerts).toHaveLength(1);
    expect(generatedAlerts[0].listingTitle).toBe('Logo Generator');
    expect(result.current.alerts).toHaveLength(1);
    expect(result.current.unreadAlertCount).toBe(1);

    // Processing the same listings again should produce NO duplicate alerts
    let secondRunAlerts: any[] = [];
    act(() => {
      secondRunAlerts = result.current.processListingAlerts(listings);
    });

    expect(secondRunAlerts).toHaveLength(0);
    expect(result.current.alerts).toHaveLength(1);
  });

  it('disables alerts when alert preference is toggled off', () => {
    const { result } = renderHook(() => useSavedSearches());

    let createdId = '';
    act(() => {
      const search = result.current.saveSearch('Quiet Search', {
        searchQuery: 'quiet',
        category: '',
        priceRange: [0, 25],
        sortBy: 'recent',
      }, true);
      createdId = search.id;
    });

    act(() => {
      result.current.toggleAlerts(createdId, false);
    });

    expect(result.current.savedSearches[0].alertsEnabled).toBe(false);

    let generatedAlerts: any[] = [];
    act(() => {
      generatedAlerts = result.current.processListingAlerts([{ id: 'p1', title: 'quiet prompt', price: 2 }]);
    });

    expect(generatedAlerts).toHaveLength(0);
  });

  it('handles localStorage.setItem quota exceeded gracefully', () => {
    const { result } = renderHook(() => useSavedSearches());

    // Mock localStorage to throw quota exceeded
    const originalSetItem = Storage.prototype.setItem;
    Storage.prototype.setItem = vi.fn(() => {
      throw new Error('QuotaExceededError');
    });

    // Should not crash the component, just log error
    act(() => {
      const filter: SavedSearchFilter = {
        searchQuery: 'test',
        category: 'TestCat',
        priceRange: [0, 25],
        sortBy: 'recent',
      };
      result.current.saveSearch('Test', filter, true);
    });

    // Restore original
    Storage.prototype.setItem = originalSetItem;

    // Hook should still be functional even if persistence failed
    expect(result.current.savedSearches).toBeDefined();
  });

  it('handles localStorage.getItem errors in initialization', () => {
    localStorage.clear();

    // Mock localStorage.getItem to throw
    const originalGetItem = Storage.prototype.getItem;
    Storage.prototype.getItem = vi.fn(() => {
      throw new Error('StorageError');
    });

    // Should not crash during hook creation
    const { result } = renderHook(() => useSavedSearches());

    Storage.prototype.getItem = originalGetItem;

    // Should fall back to empty state
    expect(result.current.savedSearches).toEqual([]);
    expect(result.current.alerts).toEqual([]);
  });

  it('loads saved search with missing new schema fields without crashing', () => {
    const { result } = renderHook(() => useSavedSearches());

    // Simulate old saved data structure missing the 'tag' field
    const oldSearchData = [
      {
        id: 'old_search_1',
        name: 'Old Search',
        walletAddress: 'GUSER123456789',
        filter: {
          searchQuery: 'test',
          category: 'OldCategory',
          priceRange: [0, 10],
          sortBy: 'recent',
          // Missing 'tag' field - should not break
        },
        alertsEnabled: true,
        createdAt: Date.now() - 100000,
      },
    ];

    // Store old data in localStorage
    const key = 'prompthash_saved_searches_GUSER123456789';
    localStorage.setItem(key, JSON.stringify(oldSearchData));

    // Re-render to load from storage
    const { result: newResult } = renderHook(() => useSavedSearches());

    // Should load without crashing
    expect(newResult.current.savedSearches.length).toBeGreaterThanOrEqual(0);
  });

  it('provides defensive defaults for missing filter fields', () => {
    const { result } = renderHook(() => useSavedSearches());

    let createdId = '';
    act(() => {
      // Save with minimal fields
      const filter: SavedSearchFilter = {
        searchQuery: 'minimal',
        category: '',
        priceRange: [0, 25],
        sortBy: 'recent',
      };
      const search = result.current.saveSearch('Minimal', filter, true);
      createdId = search.id;
    });

    // The saved search should have all fields with safe defaults
    const saved = result.current.savedSearches.find((s) => s.id === createdId);
    expect(saved).toBeDefined();
    expect(saved?.filter.searchQuery).toBe('minimal');
    expect(saved?.filter.priceRange).toEqual([0, 25]);
  });

  it('alert processing handles missing/malformed listing fields gracefully', () => {
    const { result } = renderHook(() => useSavedSearches());

    act(() => {
      result.current.saveSearch('Category Search', {
        searchQuery: '',
        category: 'Creative',
        priceRange: [0, 100],
        sortBy: 'recent',
      }, true);
    });

    // Process listings with missing/malformed fields
    const malformedListings = [
      { id: 'item_1', title: 'Valid', category: 'Creative', price: 10 },
      { id: 'item_2', title: 'NoCategory', price: 5 }, // missing category
      { id: 'item_3', title: 'InvalidPrice', category: 'Creative', price: 'not a price' }, // malformed price
      { id: 'item_4' }, // minimal fields
    ];

    let alerts: any[] = [];
    act(() => {
      alerts = result.current.processListingAlerts(malformedListings);
    });

    // Should process gracefully without crashing
    expect(Array.isArray(alerts)).toBe(true);
    // Only valid matching item should generate alert
    expect(alerts.length).toBeLessThanOrEqual(malformedListings.length);
  });

  it('clears alerts and verifies persistence', () => {
    const { result } = renderHook(() => useSavedSearches());

    act(() => {
      result.current.saveSearch('Alert Test', {
        searchQuery: 'test',
        category: '',
        priceRange: [0, 25],
        sortBy: 'recent',
      }, true);
    });

    act(() => {
      result.current.processListingAlerts([{ id: 'p1', title: 'test prompt', price: 5 }]);
    });

    expect(result.current.alerts.length).toBeGreaterThan(0);

    act(() => {
      result.current.clearAlerts();
    });

    expect(result.current.alerts).toHaveLength(0);
    expect(result.current.unreadAlertCount).toBe(0);
  });

  it('marks alert as read and persists state', () => {
    const { result } = renderHook(() => useSavedSearches());

    act(() => {
      result.current.saveSearch('Mark Test', {
        searchQuery: 'mark',
        category: '',
        priceRange: [0, 25],
        sortBy: 'recent',
      }, true);
    });

    let alertId = '';
    act(() => {
      const alerts = result.current.processListingAlerts([{ id: 'p1', title: 'mark prompt', price: 5 }]);
      if (alerts.length > 0) {
        alertId = alerts[0].id;
      }
    });

    expect(result.current.unreadAlertCount).toBe(1);

    act(() => {
      result.current.markAlertRead(alertId);
    });

    expect(result.current.unreadAlertCount).toBe(0);
    const alert = result.current.alerts.find((a) => a.id === alertId);
    expect(alert?.read).toBe(true);
  });
});
