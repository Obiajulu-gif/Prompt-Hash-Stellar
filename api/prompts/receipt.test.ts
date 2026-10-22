// @vitest-environment node

import { beforeEach, describe, expect, it, vi } from "vitest";

const { buildAndSignReceiptMock, findOneMock, verifyEntitlementMock } =
  vi.hoisted(() => ({
    buildAndSignReceiptMock: vi.fn(),
    findOneMock: vi.fn(),
    verifyEntitlementMock: vi.fn(),
  }));

vi.mock("../../src/lib/observability/wrapper", () => ({
  withObservability: (handler: unknown) => handler,
}));

vi.mock("../../server/src/db/connectDb", () => ({
  default: vi.fn().mockResolvedValue(undefined),
}));

vi.mock("../../server/src/models/Purchase", () => ({
  default: { findOne: findOneMock },
}));

vi.mock("../../src/lib/stellar/receipts", () => ({
  buildAndSignReceipt: (...args: unknown[]) => buildAndSignReceiptMock(...args),
  ReceiptEventNotFoundError: class ReceiptEventNotFoundError extends Error {},
}));

vi.mock("../../src/lib/stellar/promptHashClient", () => ({
  DEFAULT_MAX_LEDGER_AGE: 5,
  getCurrentEntitlementStatus: (entitlement: {
    hasAccess: boolean;
    divergenceReason?: string;
  }) =>
    entitlement.divergenceReason
      ? "unverifiable"
      : entitlement.hasAccess
        ? "verified"
        : "not_entitled",
  verifyEntitlement: (...args: unknown[]) => verifyEntitlementMock(...args),
}));

import handler from "./receipt";
import { ReceiptEventNotFoundError } from "../../src/lib/stellar/receipts";

const buyerWallet =
  "GBUYERACCOUNT1234567890ABCDEFGH1234567890ABCDEFGH123456789";

function invokeReceipt() {
  let statusCode = 0;
  let responseData: Record<string, unknown> = {};
  const req = {
    method: "GET",
    query: { promptId: "42", buyerWallet },
    logger: { error: vi.fn() },
  };
  const res = {
    status(code: number) {
      statusCode = code;
      return this;
    },
    json(data: Record<string, unknown>) {
      responseData = data;
      return this;
    },
  };

  // @ts-expect-error test handler invocation
  return handler(req, res).then(() => ({ statusCode, responseData }));
}

function ledgerEntitlement(
  overrides: Partial<{
    hasAccess: boolean;
    divergenceReason: string;
  }> = {},
) {
  return {
    hasAccess: true,
    ledgerSequence: 123456,
    ledgerHash: "current-ledger-hash",
    networkId: "test-network-id",
    contractId: "prompt-hash-contract",
    checkedAt: Date.now(),
    ...overrides,
  };
}

describe("receipt API current entitlement reconciliation (#675)", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    process.env.PUBLIC_PROMPT_HASH_CONTRACT_ID = "prompt-hash-contract";
    findOneMock.mockReturnValue({
      sort: vi.fn().mockResolvedValue(null),
    });
    verifyEntitlementMock.mockResolvedValue(ledgerEntitlement());
    buildAndSignReceiptMock.mockResolvedValue({
      receipt: { transaction: { hash: "purchase-tx" } },
      signature: "signature",
      signerPublicKey: "public-key",
      signerKeyId: "test-key",
    });
  });

  it("reports verified on-chain access while the purchase index is still missing", async () => {
    const { statusCode, responseData } = await invokeReceipt();

    expect(statusCode).toBe(200);
    expect(responseData.receipt).toBeNull();
    expect(responseData.receiptStatus).toBe("pending");
    expect(responseData.entitlement).toMatchObject({
      status: "verified",
      ledgerSequence: 123456,
    });
  });

  it("surfaces a delayed/missing purchase event without treating the receipt as final", async () => {
    findOneMock.mockReturnValue({
      sort: vi.fn().mockResolvedValue({ txHash: "purchase-tx" }),
    });
    buildAndSignReceiptMock.mockRejectedValue(new ReceiptEventNotFoundError());

    const { statusCode, responseData } = await invokeReceipt();

    expect(statusCode).toBe(200);
    expect(responseData.receipt).toBeNull();
    expect(responseData.receiptStatus).toBe("pending");
    expect(responseData.entitlement).toMatchObject({ status: "verified" });
  });

  it("returns a historical receipt as not entitled when current ledger state revokes access", async () => {
    findOneMock.mockReturnValue({
      sort: vi.fn().mockResolvedValue({ txHash: "purchase-tx" }),
    });
    verifyEntitlementMock.mockResolvedValue(
      ledgerEntitlement({ hasAccess: false }),
    );

    const { statusCode, responseData } = await invokeReceipt();

    expect(statusCode).toBe(200);
    expect(responseData.receiptStatus).toBe("ready");
    expect(responseData.entitlement).toMatchObject({
      status: "not_entitled",
      ledgerSequence: 123456,
    });
  });

  it("marks stale or divergent ledger state as unverifiable", async () => {
    verifyEntitlementMock.mockResolvedValue(
      ledgerEntitlement({
        hasAccess: false,
        divergenceReason: "stale_ledger",
      }),
    );

    const { statusCode, responseData } = await invokeReceipt();

    expect(statusCode).toBe(200);
    expect(responseData.entitlement).toMatchObject({
      status: "unverifiable",
      reason: "stale_ledger",
    });
  });
});
