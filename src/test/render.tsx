import type { ReactElement, ReactNode } from "react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import {
  render,
  type RenderOptions,
} from "@testing-library/react";
import { MemoryRouter } from "react-router-dom";
import {
  WalletContext,
  type WalletContextType,
} from "@/providers/WalletProvider";

const defaultWallet: WalletContextType = {
  address: undefined,
  network: undefined,
  networkPassphrase: undefined,
  isPending: false,
  signMessage: undefined,
  signTransaction: undefined,
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
      <WalletContext value={walletValue}>
        <MemoryRouter initialEntries={[route]}>{children}</MemoryRouter>
      </WalletContext>
    </QueryClientProvider>
  );

  return {
    queryClient,
    ...render(ui, { wrapper: Wrapper, ...renderOptions }),
  };
}
