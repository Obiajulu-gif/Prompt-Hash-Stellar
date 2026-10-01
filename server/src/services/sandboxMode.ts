/**
 * Integration sandbox mode — safe contributor testing (#839).
 *
 * When `SANDBOX=true` (or `NODE_ENV=sandbox`), external service calls are
 * replaced with deterministic fake adapters that return canned responses.
 * No production credentials, real wallets, or irreversible records are touched.
 */

export interface SandboxConfig {
  enabled: boolean;
  fakeStellarSdk: boolean;
  fakeAiGateway: boolean;
  fakeEmailService: boolean;
  fakeDiscordWebhook: boolean;
}

let sandboxConfig: SandboxConfig = {
  enabled: false,
  fakeStellarSdk: false,
  fakeAiGateway: false,
  fakeEmailService: false,
  fakeDiscordWebhook: false,
};

export function initSandboxMode(overrides?: Partial<SandboxConfig>): SandboxConfig {
  const envEnabled =
    process.env.SANDBOX === "true" || process.env.NODE_ENV === "sandbox";

  sandboxConfig = {
    enabled: envEnabled || overrides?.enabled || false,
    fakeStellarSdk: overrides?.fakeStellarSdk ?? envEnabled,
    fakeAiGateway: overrides?.fakeAiGateway ?? envEnabled,
    fakeEmailService: overrides?.fakeEmailService ?? envEnabled,
    fakeDiscordWebhook: overrides?.fakeDiscordWebhook ?? envEnabled,
  };

  return sandboxConfig;
}

export function getSandboxConfig(): SandboxConfig {
  return { ...sandboxConfig };
}

export function isSandbox(): boolean {
  return sandboxConfig.enabled;
}

// ─── Fake Adapters ──────────────────────────────────────────────────────────

export const FakeStellarAdapter = {
  async getAccount(_address: string) {
    return {
      accountId: _address,
      sequence: "12345",
      balances: [{ asset: "native", balance: "10000.0000000" }],
    };
  },
  async submitTransaction(_tx: unknown) {
    return {
      success: true,
      hash: "FAKE_TX_HASH_" + Date.now(),
      ledger: 999999,
    };
  },
};

export const FakeAiGatewayAdapter = {
  async improvePrompt(promptText: string) {
    return {
      improved: `[SANDBOX] ${promptText}`,
      suggestions: ["Add examples", "Specify output format"],
    };
  },
  async chat(_messages: unknown[]) {
    return { content: "[SANDBOX] Fake AI response" };
  },
};

export const FakeEmailAdapter = {
  async send(_to: string, _subject: string, _body: string) {
    return { sent: true, messageId: "fake-email-" + Date.now() };
  },
};

export const FakeDiscordAdapter = {
  async announce(_message: string) {
    return { sent: true };
  },
};
