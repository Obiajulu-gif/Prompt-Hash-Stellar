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
});
