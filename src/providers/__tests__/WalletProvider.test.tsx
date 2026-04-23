import { render, screen, act } from '@testing-library/react';
import { WalletProvider, WalletContext } from '../WalletProvider';
import storage from '../../util/storage';
import { describe, it, expect, vi } from 'vitest';
import React from 'react'; // Ensure React is imported for the TestComponent

// 1. Partial Mock: Keeps WalletNetwork intact while mocking the Class
vi.mock('@creit.tech/stellar-wallets-kit', async (importOriginal) => {
  const actual = await importOriginal<typeof import('@creit.tech/stellar-wallets-kit')>();
  return {
    ...actual,
    freighter: vi.fn(),
    albedo: vi.fn(),
    xbull: vi.fn(),
    StellarWalletsKit: vi.fn().mockImplementation(() => ({
      setWallet: vi.fn(),
      getAddress: vi.fn().mockResolvedValue({ address: 'GABC123' }),
      getNetwork: vi.fn().mockResolvedValue({ 
        network: 'TESTNET', 
        networkPassphrase: 'Test SDF Network ; September 2015' 
      }),
      signTransaction: vi.fn(),
      signMessage: vi.fn(),
      disconnect: vi.fn().mockResolvedValue(undefined), // Add this!
    })),
  };
});

describe('WalletProvider Session Persistence', () => {
  it('should purge storage on disconnect', async () => {
    // 0. Clear any existing storage to avoid cross-test contamination
    storage.removeItem('walletId');
    storage.removeItem('walletAddress');
    storage.removeItem('walletNetwork');
    storage.removeItem('networkPassphrase');

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
      <WalletProvider>
        <TestComponent />
      </WalletProvider>
    );

    // Wait for the provider to finish rehydration and reach connected state
    await act(async () => {
      await new Promise(resolve => setTimeout(resolve, 100));
    });

    // Re-render to get updated context after rehydration
    rerender(
      <WalletProvider>
        <TestComponent />
      </WalletProvider>
    );

    // Verify we're connected before testing disconnect
    const statusEl = screen.getByTestId('status');
    expect(statusEl.textContent).toBe('connected');

    // 2. Trigger disconnect action
    const btn = screen.getByText('Logout');
    await act(async () => {
      btn.click();
    });

    // 3. Assertions: Verify storage is cleared (Expect null, not "")
    expect(storage.getItem('walletId')).toBeNull();
    expect(storage.getItem('walletAddress')).toBeNull();
  });
});