# Frontend Testing Guide

PromptHash Stellar uses Vitest + jsdom + React Testing Library for frontend integration coverage.

## Run The Suite

```bash
yarn test:frontend
```

Watch mode:

```bash
yarn test:frontend:watch
```

## What To Cover

Prefer real user journeys at the component or page-flow level:

- wallet connection or disconnection state
- wrong-network handling
- create listing validation and submission guards
- purchase and unlock flows
- failure recovery after async errors
- React Query refresh behavior after mutations

## Recommended Pattern

1. Render the real flow component with [`src/test/render.tsx`](../src/test/render.tsx).
2. Reuse realistic prompt fixtures from [`src/test/fixtures/prompts.ts`](../src/test/fixtures/prompts.ts).
3. Mock wallet, Soroban client, encryption, and unlock modules at the boundary:
   - `@/util/wallet`
   - `@/lib/stellar/promptHashClient`
   - `@/lib/crypto/promptCrypto`
   - `@/lib/prompts/unlock`
4. Update mocked in-memory state after mutations, then assert the UI refreshes after React Query invalidation.
5. Assert both happy-path and failure or recovery behavior.

## CI Rules

- Do not depend on live wallet extensions.
- Do not depend on a live Soroban RPC or Horizon server.
- Keep mock responses deterministic.
- Prefer explicit text assertions over snapshots for async marketplace flows.
