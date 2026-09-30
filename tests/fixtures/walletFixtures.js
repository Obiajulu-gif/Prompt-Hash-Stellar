/**
 * Wallet signing fixtures — success and failure modes for E2E buyer path.
 *
 * Deterministic, no external network required. Use via page.addInitScript
 * or route mocks to isolate tests.
 */

// Deterministic test keypair (SDF testnet, not funded — for signing only)
export const TEST_WALLETS = {
  buyer: {
    publicKey: 'GBUYERTESTACCOUNT1234567890ABCDEFGH1234567890ABCDEFGH1234',
    secret: 'SBUYERSECRET1234567890ABCDEFGH1234567890ABCDEFGH1234567890AB',
  },
  creator: {
    publicKey: 'GCREATORTESTACCOUNT1234567890ABCDEFGH1234567890ABCDEFGH123',
    secret: 'SCREATORSECRET1234567890ABCDEFGH1234567890ABCDEFGH123456789',
  },
  stranger: {
    publicKey: 'GSTRANGERTESTACCOUNT1234567890ABCDEFGH1234567890ABCDEFGH12',
    secret: 'SSTRANGERSECRET1234567890ABCDEFGH1234567890ABCDEFGH12345678',
  },
};

export const WALLET_FIXTURES = {
  connectedBuyer: {
    address: TEST_WALLETS.buyer.publicKey,
    signTransaction: async (xdr) => xdr, // mock: return same XDR as signed
    signMessage: async (message) => ({
      signedMessage: Buffer.from(`mock-signature-for-${message}`).toString('base64'),
      signerAddress: TEST_WALLETS.buyer.publicKey,
    }),
  },
  connectedCreator: {
    address: TEST_WALLETS.creator.publicKey,
    signTransaction: async (xdr) => xdr,
    signMessage: async (message) => ({
      signedMessage: Buffer.from(`mock-signature-for-${message}`).toString('base64'),
      signerAddress: TEST_WALLETS.creator.publicKey,
    }),
  },
  // Failure modes
  userRejectsSigning: {
    address: TEST_WALLETS.buyer.publicKey,
    signTransaction: async () => { throw new Error('User declined transaction signing'); },
    signMessage: async () => { throw new Error('User declined message signing'); },
  },
  networkFailure: {
    address: TEST_WALLETS.buyer.publicKey,
    signTransaction: async () => { throw new Error('Could not reach the Stellar network.'); },
    signMessage: async () => { throw new Error('Could not reach the Stellar network.'); },
  },
  invalidSignature: {
    address: TEST_WALLETS.stranger.publicKey,
    signTransaction: async (xdr) => xdr,
    signMessage: async (message) => ({
      signedMessage: Buffer.from(`forged-signature-for-${message}`).toString('base64'),
      signerAddress: TEST_WALLETS.stranger.publicKey,
    }),
  },
  expiredChallenge: {
    address: TEST_WALLETS.buyer.publicKey,
    signTransaction: async (xdr) => xdr,
    signMessage: async (message) => ({
      signedMessage: Buffer.from(`expired-${message}`).toString('base64'),
      signerAddress: TEST_WALLETS.buyer.publicKey,
    }),
  },
};

/**
 * Helper to inject a mock wallet into the page before navigation.
 * Keeps tests deterministic and isolated (no real extension needed).
 */
export async function injectMockWallet(page, fixture) {
  await page.addInitScript((wallet) => {
    window.__mockWallet = wallet;
    window.stellarWalletsKit = {
      getPublicKey: async () => wallet.address,
      isConnected: async () => true,
      signTransaction: wallet.signTransaction,
      signMessage: wallet.signMessage,
    };
  }, fixture);
}

export const SETTLEMENT_FIXTURES = {
  success: {
    txHash: 'a1b2c3d4e5f6a1b2c3d4e5f6a1b2c3d4e5f6a1b2c3d4e5f6a1b2c3d4e5f6a1b2c3d4',
    ledger: 123456,
    success: true,
  },
  pending: {
    txHash: 'pending-tx-hash-1234567890abcdef',
    success: false,
    status: 'pending',
  },
  failedInsufficientBalance: {
    error: 'Insufficient XLM balance to cover purchase + fee.',
    code: 'INSUFFICIENT_BALANCE',
    success: false,
  },
  failedNetwork: {
    error: 'Could not reach the Stellar network.',
    code: 'NETWORK_ERROR',
    success: false,
  },
};

export const ENTITLEMENT_FIXTURES = {
  hasAccess: {
    hasAccess: true,
    ledgerSequence: 100,
    ledgerHash: 'ledger-hash-100',
    networkId: 'Test SDF Network ; September 2015',
    contractId: 'CPROMPTTESTCONTRACT',
    checkedAt: Date.now(),
  },
  noAccess: {
    hasAccess: false,
    ledgerSequence: 100,
    ledgerHash: 'ledger-hash-100',
    networkId: 'Test SDF Network ; September 2015',
    contractId: 'CPROMPTTESTCONTRACT',
    checkedAt: Date.now(),
  },
  pendingIndexing: {
    hasAccess: true,
    pending: true,
    reason: 'indexer_delay',
  },
};

export const UNLOCK_FIXTURES = {
  success: {
    promptId: '1',
    title: 'Premium analysis prompt',
    contentHash: 'abc123hash',
    plaintext: 'Decrypted prompt content: This is the secret prompt that was purchased.',
  },
  invalidSignature: {
    error: 'Invalid wallet signature.',
    code: 'INVALID_SIGNATURE',
  },
  expiredChallenge: {
    error: 'Challenge token has expired.',
    code: 'CHALLENGE_EXPIRED',
  },
  noAccess: {
    error: 'You have not purchased access to this prompt.',
    code: 'ACCESS_NOT_PURCHASED',
  },
  integrityFailure: {
    error: 'Prompt integrity check failed.',
    code: 'INTEGRITY_FAILURE',
  },
};
