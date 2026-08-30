import { render, screen, act, waitFor } from '@testing-library/react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { WalletProvider, WalletContext } from '../WalletProvider';
import storage from '../../util/storage';
import { describe, it, expect, vi, beforeEach } from 'vitest';
import React from 'react'; // Ensure React is imported for the TestComponent
import { TransactionProvider } from '../../components/TransactionProvider';

// The wallet kit now uses a static (v2) API — mock that surface so the
// provider's adapter layer is exercised without touching real wallets.
vi.mock('@creit.tech/stellar-wallets-kit', async (importOriginal) => {
  const actual = await importOriginal<typeof import('@creit.tech/stellar-wallets-kit')>();
  return {
    ...actual,
    StellarWalletsKit: {
      init: vi.fn(),
      setWallet: vi.fn(),
      getAddress: vi.fn().mockResolvedValue({ address: 'GABC123' }),
      getNetwork: vi.fn().mockResolvedValue({
        network: 'TESTNET',
        networkPassphrase: 'Test SDF Network ; September 2015',
      }),
      signTransaction: vi.fn(),
      signMessage: vi.fn(),
      disconnect: vi.fn().mockResolvedValue(undefined),
      authModal: vi.fn().mockResolvedValue({ address: 'GABC123' }),
    },
  };
});

describe('WalletProvider Session Persistence', () => {
  const queryClient = new QueryClient({
    defaultOptions: { queries: { retry: false }, mutations: { retry: false } },
  });

  const Harness = ({ children }: { children: React.ReactNode }) => (
    <QueryClientProvider client={queryClient}>
      <TransactionProvider>
        <WalletProvider>{children}</WalletProvider>
      </TransactionProvider>
    </QueryClientProvider>
  );

  beforeEach(() => {
    // 0. Clear any existing storage to avoid cross-test contamination
    if (storage.clear) {
      storage.clear();
    } else {
      ['walletId', 'walletAddress', 'walletNetwork', 'networkPassphrase']
        .forEach(key => storage.removeItem(key as any));
    }
  });

  it('should purge storage on disconnect', async () => {
    // 1. Mock existing storage values
    storage.setItem('walletId', 'freighter');
    storage.setItem('walletAddress', 'GABC123');

    const TestComponent = () => {
      const context = React.useContext(WalletContext);
      if (!context) return null;
      
      const { disconnect, address, status } = context;
      return (
        <div>
          <span data-testid="addr">{address}</span>
          <span data-testid="status">{status}</span>
          <button onClick={disconnect} disabled={status === 'reconnecting'}>Logout</button>
        </div>
      );
    };

    const { rerender } = render(
      <Harness>
        <TestComponent />
      </Harness>
    );

    // Wait for the provider to finish rehydration and reach connected state
    await act(async () => {
      await new Promise(resolve => setTimeout(resolve, 100));
    });

    // Re-render to get updated context after rehydration
    rerender(
      <Harness>
        <TestComponent />
      </Harness>
    );

    // Verify we're connected before testing disconnect
    const statusEl = screen.getByTestId('status');
    expect(statusEl.textContent).toBe('connected');

    // 2. Trigger disconnect action
    const btn = screen.getByText('Logout');
    await act(async () => {
      btn.click();
    });

    // 3. Wait for the async disconnect to clear storage
    await waitFor(() => {
      expect(storage.getItem('walletId')).toBeNull();
      expect(storage.getItem('walletAddress')).toBeNull();
    });
  });
});