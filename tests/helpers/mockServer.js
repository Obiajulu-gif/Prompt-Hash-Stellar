/**
 * Mock server helpers for E2E tests — deterministic, isolated, no external network.
 *
 * Each helper registers `page.route` interceptors so tests never hit real RPC,
 * Horizon, or unlock endpoints. Pair with `fixtures/walletFixtures.js`.
 */

export async function mockSuccessfulSettlement(page, { txHash = 'a1b2c3d4e5f6a1b2c3d4e5f6a1b2c3d4e5f6a1b2c3d4' } = {}) {
  await page.route('**/soroban*', async (route) => {
    await route.fulfill({
      status: 200,
      contentType: 'application/json',
      body: JSON.stringify({ result: { transactionHash: txHash, status: 'SUCCESS', latestLedger: 100 } }),
    });
  });
}

export async function mockChallenge(page, {
  token = 'mock.challenge.token.803',
  challenge = 'prompt-hash:unlock:1:Test SDF Network ; September 2015:CPROMPT:GBUYER:1::nonce:803:2000000000000',
  expiresAt = 2_000_000_000_000,
  nonce = 'mock-nonce-803',
  status = 200,
  code = 'INVALID_REQUEST',
  error = 'Unable to issue unlock challenge.',
} = {}) {
  await page.route('**/api/auth/challenge', async (route) => {
    const body = status >= 400
      ? { error, code }
      : { token, challenge, expiresAt, nonce };
    await route.fulfill({ status, contentType: 'application/json', body: JSON.stringify(body) });
  });
}

export async function mockUnlockSuccess(page, content = 'Decrypted prompt content: secret prompt') {
  await mockChallenge(page);
  await page.route('**/api/prompts/unlock', async (route) => {
    await route.fulfill({
      status: 200,
      contentType: 'application/json',
      body: JSON.stringify({
        promptId: '1',
        title: 'Premium analysis prompt',
        contentHash: 'abc123',
        contentHashAlgorithm: 'SHA-256',
        contentHashVersion: 1,
        plaintext: content,
      }),
    });
  });
}

export async function mockUnlockFailure(page, { code = 'INVALID_SIGNATURE', error = 'Invalid wallet signature.', status = 401 } = {}) {
  await mockChallenge(page, { token: 'mock.token.803' });
  await page.route('**/api/prompts/unlock', async (route) => {
    await route.fulfill({
      status,
      contentType: 'application/json',
      body: JSON.stringify({ error, code, correlationId: 'test-corr-803' }),
    });
  });
}

export async function mockHasAccess(page, hasAccess = true) {
  await page.route('**/api/**', async (route) => {
    const url = route.request().url();
    if (url.includes('hasAccess') || url.includes('entitlement')) {
      await route.fulfill({
        status: 200,
        contentType: 'application/json',
        body: JSON.stringify({ hasAccess, ledgerSequence: 100, ledgerHash: 'hash-100' }),
      });
      return;
    }
    await route.continue();
  });
}

export async function mockPromptList(page, prompts) {
  await page.route('**/api/prompts*', async (route) => {
    if (route.request().method() === 'GET') {
      await route.fulfill({
        status: 200,
        contentType: 'application/json',
        body: JSON.stringify({ data: prompts, metadata: { hasNextPage: false, nextCursor: null } }),
      });
      return;
    }
    await route.continue();
  });
}

/**
 * Actionable logging helper — call in test `afterEach` on failure.
 * Playwright already captures trace/screenshot via config, but this adds
 * console + page error context to the test output for quick triage.
 */
export function attachActionableLogging(page, testInfo) {
  page.on('console', (msg) => {
    if (msg.type() === 'error') console.log(`[E2E console.error] ${msg.text()}`);
  });
  page.on('pageerror', (err) => console.log(`[E2E pageerror] ${err.message}`));
  page.on('requestfailed', (req) => {
    console.log(`[E2E requestfailed] ${req.method()} ${req.url()} — ${req.failure()?.errorText}`);
  });
}
