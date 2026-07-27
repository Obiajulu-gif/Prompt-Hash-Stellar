import { StrictMode } from "react";
import { createRoot } from "react-dom/client";
import "./index.css";
import App from "./App.tsx";
import "@stellar/design-system/build/styles.min.css";

import { QueryClient } from "@tanstack/react-query";
import { PersistQueryClientProvider } from "@tanstack/react-query-persist-client";
import { createSyncStoragePersister } from "@tanstack/query-sync-storage-persister";

import { BrowserRouter } from "react-router-dom";

import { WalletProvider } from "./providers/WalletProvider.tsx";
import { TransactionProvider } from "./components/TransactionProvider.tsx";
import { NotificationProvider } from "./providers/NotificationProvider.tsx";
import { ContractSyncProvider } from "./providers/ContractSyncProvider.tsx";

// Initialize the client
const queryClient = new QueryClient({
  defaultOptions: {
    queries: {
      refetchOnWindowFocus: false,
      retry: false,
      gcTime: 1000 * 60 * 60 * 24, // 24 hours caching
      staleTime: 1000 * 60 * 5, // 5 minutes fresh
    },
  },
});

queryClient.getQueryCache().subscribe((event) => {
  if (event.type === 'updated' && event.action.type === 'success') {
    localStorage.setItem('lastCacheRefresh', Date.now().toString());
  }
});

const persister = createSyncStoragePersister({
  storage: window.localStorage,
});

createRoot(document.getElementById("root") as HTMLElement).render(
  <StrictMode>
    <NotificationProvider>
      <PersistQueryClientProvider 
        client={queryClient} 
        persistOptions={{ 
          persister,
          dehydrateOptions: {
            shouldDehydrateQuery: (query) => {
              // Cache safe public listing metadata only
              const key = query.queryKey[0];
              return typeof key === 'string' && (key.startsWith('prompts') || key === 'prompt-detail');
            }
          }
        }}
      >
        <ContractSyncProvider>
          <TransactionProvider>
            <WalletProvider>
              <BrowserRouter>
                <App />
              </BrowserRouter>
            </WalletProvider>
          </TransactionProvider>
        </ContractSyncProvider>
      </PersistQueryClientProvider>
    </NotificationProvider>
  </StrictMode>,
);
