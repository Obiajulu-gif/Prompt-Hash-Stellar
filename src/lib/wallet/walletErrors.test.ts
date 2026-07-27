import { describe, expect, it } from "vitest";
import { classifyWalletError } from "./walletErrors";

describe("classifyWalletError", () => {
  it("detects missing wallet extension", () => {
    const result = classifyWalletError(new Error("Freighter is not installed"));
    expect(result.code).toBe("EXTENSION_NOT_FOUND");
    expect(result.retryable).toBe(false);
  });

  it("detects wallet not found", () => {
    expect(classifyWalletError(new Error("Wallet not available")).code).toBe(
      "EXTENSION_NOT_FOUND",
    );
    expect(
      classifyWalletError(new Error("No provider for xbull")).code,
    ).toBe("EXTENSION_NOT_FOUND");
  });

  it("detects user rejection", () => {
    const result = classifyWalletError(new Error("User rejected the request"));
    expect(result.code).toBe("USER_REJECTED");
    expect(result.retryable).toBe(true);
  });

  it("detects wrong network errors", () => {
    const result = classifyWalletError(new Error("Wrong network detected"));
    expect(result.code).toBe("WRONG_NETWORK");
    expect(result.retryable).toBe(true);
  });

  it("detects insufficient balance", () => {
    expect(
      classifyWalletError(new Error("op_underfunded")).code,
    ).toBe("INSUFFICIENT_BALANCE");
    expect(
      classifyWalletError(new Error("tx_insufficient_balance")).code,
    ).toBe("INSUFFICIENT_BALANCE");
  });

  it("detects transaction failures", () => {
    expect(classifyWalletError(new Error("tx_bad_auth")).code).toBe(
      "TRANSACTION_FAILED",
    );
    expect(classifyWalletError(new Error("tx_failed")).code).toBe(
      "TRANSACTION_FAILED",
    );
  });

  it("detects contract errors", () => {
    const result = classifyWalletError(
      new Error("host invocation failed"),
    );
    expect(result.code).toBe("CONTRACT_ERROR");
    expect(result.retryable).toBe(true);
  });

  it("detects timeout errors", () => {
    const result = classifyWalletError(new Error("Request timed out"));
    expect(result.code).toBe("TIMEOUT");
    expect(result.retryable).toBe(true);
  });

  it("detects network errors", () => {
    expect(classifyWalletError(new Error("Failed to fetch")).code).toBe(
      "NETWORK_ERROR",
    );
    expect(classifyWalletError(new Error("ECONNREFUSED")).code).toBe(
      "NETWORK_ERROR",
    );
  });

  it("handles unknown errors gracefully", () => {
    const result = classifyWalletError(new Error("something completely unexpected"));
    expect(result.code).toBe("UNKNOWN");
    expect(result.retryable).toBe(true);
    expect(result.message).toBeTruthy();
  });

  it("handles string errors", () => {
    const result = classifyWalletError("User rejected the request");
    expect(result.code).toBe("USER_REJECTED");
  });

  it("handles null/undefined errors", () => {
    expect(classifyWalletError(null).code).toBe("UNKNOWN");
    expect(classifyWalletError(undefined).code).toBe("UNKNOWN");
  });

  it("handles objects with message property", () => {
    const result = classifyWalletError({ message: "Wallet not available" });
    expect(result.code).toBe("EXTENSION_NOT_FOUND");
  });

  it("provides recovery actions", () => {
    const result = classifyWalletError(new Error("Freighter is not installed"));
    expect(result.recoveryAction).toBeTruthy();
    expect(result.recoveryAction).toMatch(/install/i);
  });
});
