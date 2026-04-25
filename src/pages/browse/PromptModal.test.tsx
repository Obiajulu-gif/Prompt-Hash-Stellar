import { render, screen, fireEvent, waitFor } from '@testing-library/react';
import { vi } from 'vitest';
import { PromptModal } from './PromptModal';
import { WalletContext, WalletContextType } from '../../providers/WalletProvider';
import { TransactionProvider } from '../../components/TransactionProvider';
import * as promptHashClient from '@/lib/stellar/promptHashClient';
import * as unlockClient from '@/lib/prompts/unlock';

vi.mock('@/lib/stellar/promptHashClient', () => ({
  hasAccess: vi.fn(),
  buyPromptAccess: vi.fn(),
}));

vi.mock('@/lib/prompts/unlock', () => ({
  unlockPromptContent: vi.fn(),
}));

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

  it('handles rejected signing during purchase', async () => {
    vi.mocked(promptHashClient.hasAccess).mockResolvedValue(false);
    vi.mocked(promptHashClient.buyPromptAccess).mockRejectedValue(new Error('User declined'));

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

    fireEvent.click(screen.getByText('Buy access'));

    await waitFor(() => {
      expect(screen.getByText(/Transaction was rejected/)).toBeInTheDocument();
      expect(screen.getByText('Retry Purchase')).toBeInTheDocument();
    });
  });

  it('handles insufficient funds error', async () => {
    vi.mocked(promptHashClient.hasAccess).mockResolvedValue(false);
    vi.mocked(promptHashClient.buyPromptAccess).mockRejectedValue(new Error('insufficient balance'));

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

    fireEvent.click(screen.getByText('Buy access'));

    await waitFor(() => {
      expect(screen.getByText(/Insufficient balance/)).toBeInTheDocument();
      expect(screen.getByText('Retry Purchase')).toBeInTheDocument();
    });
  });

  it('handles duplicate purchase error', async () => {
    vi.mocked(promptHashClient.hasAccess).mockResolvedValue(true);

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

    fireEvent.click(screen.getByText('Buy access'));

    await waitFor(() => {
      expect(screen.getByText(/already have access/)).toBeInTheDocument();
      expect(screen.getByText('Already Owned - Unlock')).toBeInTheDocument();
    });
  });

  it('handles contract execution failure', async () => {
    vi.mocked(promptHashClient.hasAccess).mockResolvedValue(false);
    vi.mocked(promptHashClient.buyPromptAccess).mockRejectedValue(new Error('Contract failed'));

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

    fireEvent.click(screen.getByText('Buy access'));

    await waitFor(() => {
      expect(screen.getByText('Purchase failed. You can retry.')).toBeInTheDocument();
      expect(screen.getByText('Retry Purchase')).toBeInTheDocument();
    });
  });

  it('supports Resume Unlock recovery path', async () => {
    vi.mocked(promptHashClient.hasAccess)
      .mockResolvedValueOnce(false) // Initial check
      .mockResolvedValueOnce(true) // Check after purchase
      .mockResolvedValueOnce(true); // Check before unlock
    
    vi.mocked(promptHashClient.buyPromptAccess).mockResolvedValue({ txHash: '123', success: true });
    vi.mocked(unlockClient.unlockPromptContent).mockRejectedValue(new Error('401 unauthorized'));

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

    fireEvent.click(screen.getByText('Buy access'));

    await waitFor(() => {
      expect(screen.getByText(/Authentication failed/)).toBeInTheDocument();
      expect(screen.getByText('Retry Unlock')).toBeInTheDocument();
    });

    // Retry unlock
    vi.mocked(unlockClient.unlockPromptContent).mockResolvedValue({ plaintext: 'Secret prompt content' } as any);
    fireEvent.click(screen.getByText('Retry Unlock'));

    await waitFor(() => {
      expect(screen.getByText('Secret prompt content')).toBeInTheDocument();
      expect(screen.getByText('Prompt Unlocked')).toBeInTheDocument();
    });
  });
});
