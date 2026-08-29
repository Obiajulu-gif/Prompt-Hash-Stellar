import { StrictMode } from "react";
import { createRoot } from "react-dom/client";
import "./index.css";
import { initializeCorrelation } from "./lib/observability/correlation";
import { applyThemeBeforeRender } from "./hooks/useTheme";
import App from "./App.tsx";
import "@stellar/design-system/build/styles.min.css";
import "./i18n"; // initialise i18n catalogue before rendering

initializeCorrelation();


import { QueryClient } from "@tanstack/react-query";
import { PersistQueryClientProvider } from "@tanstack/react-query-persist-client";
import { createSyncStoragePersister } from "@tanstack/query-sync-storage-persister";

import { BrowserRouter } from "react-router-dom";

import { WalletProvider } from "./providers/WalletProvider.tsx";
import { TransactionProvider } from "./components/TransactionProvider.tsx";
import { NotificationProvider } from "./providers/NotificationProvider.tsx";
import { ContractSyncProvider } from "./providers/ContractSyncProvider.tsx";
import { ErrorBoundary } from "./components/ErrorBoundary.tsx";
import { ThemeProvider } from "./components/theme-provider.tsx";

// ── Sentry frontend monitoring (#332) ─────────────────────────────────────
// Set PUBLIC_SENTRY_DSN in .env to enable error reporting.
// Source maps are uploaded automatically during `vite build` when
// SENTRY_AUTH_TOKEN and SENTRY_ORG / SENTRY_PROJECT are configured.
if (import.meta.env.PUBLIC_SENTRY_DSN) {
  Sentry.init({
    dsn: import.meta.env.PUBLIC_SENTRY_DSN as string,
    environment: import.meta.env.MODE,
    // Capture 10 % of sessions as performance traces in production.
    tracesSampleRate: import.meta.env.PROD ? 0.1 : 1.0,
    // Replay 5 % of sessions; 100 % on error.
    replaysSessionSampleRate: 0.05,
    replaysOnErrorSampleRate: 1.0,
    integrations: [
      Sentry.browserTracingIntegration(),
      Sentry.replayIntegration(),
    ],
  });
}

// Apply the saved theme before first paint to prevent light-theme flash.
applyThemeBeforeRender();

// Initialize the client
const queryClient = new QueryClient({
  defaultOptions: {
    queries: {
      refetchOnWindowFocus: false,
      refetchOnReconnect: false,
      retry: false,
      staleTime: 5 * 60 * 1000,
      gcTime: 10 * 60 * 1000,
    },
    mutations: {
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
