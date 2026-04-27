import { StrictMode } from "react";
import { createRoot } from "react-dom/client";
import "./index.css";
import App from "./App.tsx";
import "@stellar/design-system/build/styles.min.css";
import { WalletProvider } from "./providers/WalletProvider.tsx";
import { NotificationProvider } from "./providers/NotificationProvider.tsx";
import { ContractSyncProvider } from "./providers/ContractSyncProvider.tsx";
<<<<<<< HEAD
import { TransactionProvider } from "./components/TransactionProvider.tsx";
=======
>>>>>>> 8baeef1 (fix: final sync with upstream/main and conflict resolution)
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
<<<<<<< HEAD
    <NotificationProvider>
  <QueryClientProvider client={queryClient}>
    <TransactionProvider>
      <ContractSyncProvider>
=======
      <NotificationProvider>
  <QueryClientProvider client={queryClient}>
    <ContractSyncProvider>
      <TransactionProvider>
>>>>>>> 8baeef1 (fix: final sync with upstream/main and conflict resolution)
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
