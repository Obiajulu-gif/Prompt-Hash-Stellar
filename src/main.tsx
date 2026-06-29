import { StrictMode } from "react";
import { createRoot } from "react-dom/client";
import "./index.css";
import App from "./App.tsx";
import "@stellar/design-system/build/styles.min.css";
import * as Sentry from "@sentry/react";

import { QueryClient, QueryClientProvider } from "@tanstack/react-query";

import { BrowserRouter } from "react-router-dom";

import { WalletProvider } from "./providers/WalletProvider.tsx";
import { TransactionProvider } from "./components/TransactionProvider.tsx";
import { NotificationProvider } from "./providers/NotificationProvider.tsx";
import { ContractSyncProvider } from "./providers/ContractSyncProvider.tsx";

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

// Initialize the client
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
        <ContractSyncProvider>
          <TransactionProvider>
            <WalletProvider>
              <BrowserRouter>
                <App />
              </BrowserRouter>
            </WalletProvider>
          </TransactionProvider>
        </ContractSyncProvider>
      </QueryClientProvider>
    </NotificationProvider>
  </StrictMode>,
);
