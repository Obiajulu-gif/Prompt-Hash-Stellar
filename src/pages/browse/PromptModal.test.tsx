import { render, screen } from '@testing-library/react';
import { vi } from 'vitest';
import { PromptModal } from './PromptModal';
import { WalletContext, WalletContextType } from '../../providers/WalletProvider';
import { TransactionProvider } from '../../components/TransactionProvider';

const mockWalletContext: WalletContextType = {
  address: 'GTESTADDRESS',
  network: 'testnet',
  networkPassphrase: 'Test SDF Network ; September 2015',
  status: 'connected',
  error: undefined,
  connect: vi.fn(),
  disconnect: vi.fn(),
  signTransaction: vi.fn(),
  signMessage: vi.fn(),
};

const MockWalletProvider = ({ children }: { children: React.ReactNode }) => (
  <WalletContext.Provider value={mockWalletContext}>{children}</WalletContext.Provider>
);

const AllProviders = ({ children }: { children: React.ReactNode }) => (
  <TransactionProvider>
    <MockWalletProvider>{children}</MockWalletProvider>
  </TransactionProvider>
);

const mockPrompt = {
  id: 1n,
  creator: 'GABC123',
  imageUrl: '',
  title: 'Test Prompt',
  category: 'General',
  previewText: 'Preview...',
  encryptedPrompt: '',
  encryptionIv: '',
  wrappedKey: '',
  contentHash: '',
  priceStroops: 10000000n,
  active: true,
  salesCount: 0,
};

describe('PromptModal Buyer Flow', () => {
  it('renders pre-purchase state', () => {
    render(
      <AllProviders>
        <PromptModal
          prompt={mockPrompt}
          initialHasAccess={false}
          closeModal={() => {}}
          onRefresh={async () => {}}
        />
      </AllProviders>
    );
    expect(screen.getByText('Buy access')).toBeInTheDocument();
  });

  it('disables purchase for inactive listing', () => {
    render(
      <AllProviders>
        <PromptModal
          prompt={{ ...mockPrompt, active: false }}
          initialHasAccess={false}
          closeModal={() => {}}
          onRefresh={async () => {}}
        />
      </AllProviders>
    );
    expect(screen.getByText('Unavailable')).toBeInTheDocument();
  });

  it('shows purchased-locked state if already has access', () => {
    render(
      <AllProviders>
        <PromptModal
          prompt={mockPrompt}
          initialHasAccess={true}
          closeModal={() => {}}
          onRefresh={async () => {}}
        />
      </AllProviders>
    );
    expect(screen.getByText('View full prompt')).toBeInTheDocument();
  });

  // More tests for error, unlock, and retry flows can be added here
});
