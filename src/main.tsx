import { StrictMode } from "react";
import { createRoot } from "react-dom/client";
import "./index.css";
import App from "./App.tsx";
import "@stellar/design-system/build/styles.min.css";
import { WalletProvider } from "./providers/WalletProvider.tsx";
import { NotificationProvider } from "./providers/NotificationProvider.tsx";
import { ContractSyncProvider } from "./providers/ContractSyncProvider.tsx";
import { TransactionProvider } from "./components/TransactionProvider.tsx";
import { BrowserRouter } from "react-router-dom";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";

const queryClient = new QueryClient({
  defaultOptions: {
    queries: {
      refetchOnWindowFocus: false,
      retry: false,
    },
  },
});

createRoot(document.getElementById("root") as HTMLElement).render(
  <StrictMode>
    <NotificationProvider>
  <QueryClientProvider client={queryClient}>
    <TransactionProvider>
      <ContractSyncProvider>
        <WalletProvider>
          <BrowserRouter>
            <App />
          </BrowserRouter>
        </WalletProvider>
      </ContractSyncProvider>
    </TransactionProvider>
  </QueryClientProvider>
</NotificationProvider>
  </StrictMode>,
);
