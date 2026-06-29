# Transaction Feedback Primitives

This folder contains shared primitives for transaction status, loading, error, and retry feedback. Use these components and hooks to provide consistent, accessible feedback for all async flows (wallet, listing, purchase, unlock, etc).

## Components

- `TransactionFeedbackProvider`: Context provider for transaction feedback state.
- `useTransactionFeedback`: Hook to access and set transaction status, error, and retry.
- `TransactionStatusBanner`: Shows a banner for current transaction status.
- `TransactionSpinner`: Shows a loading spinner when status is pending.
- `TransactionErrorBanner`: Shows error message and optional retry button.
- `TransactionRetryButton`: Standard retry button with loading state.

## Usage

Wrap your app (or a subtree) with `TransactionFeedbackProvider`, then use the hook and components in your flows.

```tsx
<TransactionFeedbackProvider>
  <App />
</TransactionFeedbackProvider>
```

See each component file for details.
