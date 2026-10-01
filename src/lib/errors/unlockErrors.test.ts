import { describe, expect, it } from "vitest";
import { ErrorCode } from "@/lib/api/errorCodes";
import {
  NETWORK_ERROR_CODE,
  UnlockError,
  getUnlockErrorMeta,
  isUnlockErrorCode,
} from "./unlockErrors";

describe("unlockErrors metadata", () => {
  it("classifies every stable API error code", () => {
    const codes = Object.values(ErrorCode);
    expect(codes.length).toBeGreaterThan(0);
    for (const code of codes) {
      const meta = getUnlockErrorMeta(code);
      expect(meta).not.toBeNull();
      expect(meta?.code).toBe(code);
      expect(["wallet", "access", "server"]).toContain(meta?.category);
      expect(typeof meta?.retryable).toBe("boolean");
      expect(meta?.i18nKey.length).toBeGreaterThan(0);
    }
  });

  it("marks access failures as non-retryable and wallet issues as retryable", () => {
    expect(getUnlockErrorMeta(ErrorCode.ACCESS_NOT_PURCHASED)?.retryable).toBe(false);
    expect(getUnlockErrorMeta(ErrorCode.ACCESS_NOT_PURCHASED)?.category).toBe("access");
    expect(getUnlockErrorMeta(ErrorCode.STALE_PROMPT_TERMS)?.retryable).toBe(true);
    expect(getUnlockErrorMeta(ErrorCode.INVALID_SIGNATURE)?.retryable).toBe(true);
    expect(getUnlockErrorMeta(ErrorCode.INVALID_SIGNATURE)?.category).toBe("wallet");
    expect(getUnlockErrorMeta(ErrorCode.TEMPORARY_FAILURE)?.retryable).toBe(true);
    expect(getUnlockErrorMeta(ErrorCode.TEMPORARY_FAILURE)?.category).toBe("server");
  });

  it("recognizes the fallback network code", () => {
    expect(isUnlockErrorCode(NETWORK_ERROR_CODE)).toBe(true);
    expect(getUnlockErrorMeta(NETWORK_ERROR_CODE)).toMatchObject({
      code: NETWORK_ERROR_CODE,
      category: "server",
      retryable: true,
    });
    expect(getUnlockErrorMeta("UNKNOWN_CODE")).toBeNull();
    expect(isUnlockErrorCode(undefined)).toBe(false);
  });
});

describe("UnlockError", () => {
  it("derives category and retryability from the code", () => {
    const error = new UnlockError({
      code: ErrorCode.ACCESS_NOT_PURCHASED,
      message: "Prompt access has not been purchased.",
      correlationId: "corr-abc",
    });
    expect(error).toBeInstanceOf(Error);
    expect(error.name).toBe("UnlockError");
    expect(error.category).toBe("access");
    expect(error.retryable).toBe(false);
    expect(error.correlationId).toBe("corr-abc");
  });

  it("falls back to message-based classification for unknown codes", () => {
    const error = new UnlockError({
      code: "SOME_LEGACY_CODE" as never,
      message: "Wallet signing was rejected by the user.",
    });
    expect(error.category).toBe("wallet");
    expect(error.retryable).toBe(true);
  });
});