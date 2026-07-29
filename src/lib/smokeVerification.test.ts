import { describe, it, expect, vi, beforeEach } from 'vitest';
import { runSmokeVerification } from '../../scripts/smoke-verification.mjs';

describe('Post-deployment smoke verification command (#466)', () => {
  beforeEach(() => {
    vi.restoreAllMocks();
  });

  it('identifies failures at affected layers when frontend endpoint fails', async () => {
    // Mock global fetch
    globalThis.fetch = vi.fn().mockImplementation((url: string) => {
      if (url.includes('health')) {
        return Promise.resolve(new Response(JSON.stringify({ status: 'ok' }), { status: 200 }));
      }
      if (url.includes('auth/challenge')) {
        return Promise.resolve(new Response(JSON.stringify({ error: { code: 'MISSING_FIELDS' } }), { status: 400 }));
      }
      if (url.includes('soroban-testnet')) {
        return Promise.resolve(new Response(JSON.stringify({ result: { status: 'healthy' } }), { status: 200 }));
      }
      // Frontend fetch fails
      return Promise.reject(new Error('Connection refused'));
    });

    const result = await runSmokeVerification({
      url: 'http://localhost:5173',
      apiUrl: 'http://localhost:5173/api',
      network: 'testnet',
      rpcUrl: 'https://soroban-testnet.stellar.org',
      contractId: 'CAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA',
      json: true,
    });

    expect(result.success).toBe(false);
    expect(result.layers.frontend.status).toBe('fail');
    expect(result.layers.api_health.status).toBe('pass');
    expect(result.layers.configuration.status).toBe('pass');
    expect(result.layers.contract_read.status).toBe('pass');
    expect(result.layers.challenge_endpoint.status).toBe('pass');
  });

  it('passes all layers when all endpoints respond correctly', async () => {
    globalThis.fetch = vi.fn().mockImplementation((url: string) => {
      if (url.includes('health')) {
        return Promise.resolve(new Response(JSON.stringify({ status: 'ok' }), { status: 200 }));
      }
      if (url.includes('auth/challenge')) {
        return Promise.resolve(new Response(JSON.stringify({ error: { code: 'MISSING_FIELDS' } }), { status: 400 }));
      }
      if (url.includes('soroban-testnet')) {
        return Promise.resolve(new Response(JSON.stringify({ result: { status: 'healthy' } }), { status: 200 }));
      }
      return Promise.resolve(new Response('OK', { status: 200 }));
    });

    const result = await runSmokeVerification({
      url: 'http://localhost:5173',
      apiUrl: 'http://localhost:5173/api',
      network: 'testnet',
      rpcUrl: 'https://soroban-testnet.stellar.org',
      contractId: 'CB3X7PROMPT1234567890123456789012345678901234567890123456',
      json: true,
    });

    expect(result.success).toBe(true);
    expect(result.layers.frontend.status).toBe('pass');
    expect(result.layers.api_health.status).toBe('pass');
    expect(result.layers.configuration.status).toBe('pass');
    expect(result.layers.contract_read.status).toBe('pass');
    expect(result.layers.challenge_endpoint.status).toBe('pass');
  });

  it('fails configuration layer when contract ID is placeholder or missing', async () => {
    globalThis.fetch = vi.fn().mockImplementation(() =>
      Promise.resolve(new Response(JSON.stringify({ status: 'ok' }), { status: 200 }))
    );

    const result = await runSmokeVerification({
      url: 'http://localhost:5173',
      apiUrl: 'http://localhost:5173/api',
      network: 'testnet',
      rpcUrl: 'https://soroban-testnet.stellar.org',
      contractId: 'CXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXX',
      json: true,
    });

    expect(result.success).toBe(false);
    expect(result.layers.configuration.status).toBe('fail');
    expect(result.layers.configuration.details).toContain('placeholder');
  });
});
