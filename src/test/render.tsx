import type { ReactElement, ReactNode } from "react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { render, type RenderOptions } from "@testing-library/react";
import { MemoryRouter } from "react-router-dom";
import {
  WalletContext,
  type WalletContextType,
} from "@/providers/WalletProvider";
import { TransactionProvider } from "@/components/TransactionProvider";

// Updated defaultWallet to match the strict WalletContextType requirements
const defaultWallet: WalletContextType = {
  address: undefined,
  network: undefined,
  networkPassphrase: undefined,
  status: "idle",
  connect: async (_walletId: string) => {}, // Accepts required parameter
  disconnect: async () => {}, // Returns Promise<void>
  signMessage: async () => ({
    signedMessage: "mock_signed_message",
    signerAddress: "GA...",
  }),
  signTransaction: async () => ({
    signedTxXdr: "mock_signed_tx_xdr",
    signerAddress: "GA...",
  }),
};

export function createTestQueryClient() {
  return new QueryClient({
    defaultOptions: {
      queries: {
        retry: false,
        gcTime: 0,
      },
      mutations: {
        retry: false,
      },
    },
  });
}

interface AppRenderOptions extends Omit<RenderOptions, "wrapper"> {
  route?: string;
  wallet?: Partial<WalletContextType>;
  queryClient?: QueryClient;
}

export function renderWithProviders(
  ui: ReactElement,
  {
    route = "/",
    wallet,
    queryClient = createTestQueryClient(),
    ...renderOptions
  }: AppRenderOptions = {},
) {
  const walletValue: WalletContextType = {
    ...defaultWallet,
    ...wallet,
  };

  const Wrapper = ({ children }: { children: ReactNode }) => (
    <QueryClientProvider client={queryClient}>
      <TransactionProvider>
        {/* Ensure you are using the .Provider property if not on React 19 */}
        <WalletContext.Provider value={walletValue}>
          <MemoryRouter initialEntries={[route]}>{children}</MemoryRouter>
        </WalletContext.Provider>
      </TransactionProvider>
    </QueryClientProvider>
  );

  return {
    queryClient,
    ...render(ui, { wrapper: Wrapper, ...renderOptions }),
  };
}
