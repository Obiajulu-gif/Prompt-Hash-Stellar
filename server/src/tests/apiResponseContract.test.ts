import { describe, expect, it } from "vitest";
import {
  API_RESPONSE_CONTRACT_VERSION,
  errorResponse,
  successResponse,
  validateApiResponseContract,
} from "../services/apiResponseContract";

describe("api response contracts", () => {
  it("wraps successful payloads with the current contract version", () => {
    const response = successResponse({ id: "prompt-1" }, { requestId: "req-1" });

    expect(response).toEqual({
      ok: true,
      data: { id: "prompt-1" },
      meta: {
        requestId: "req-1",
        contractVersion: API_RESPONSE_CONTRACT_VERSION,
      },
    });
    expect(validateApiResponseContract(response)).toEqual([]);
  });

  it("wraps error payloads with stable code and message fields", () => {
    const response = errorResponse("VALIDATION_FAILED", "Import file has invalid rows", {
      rowNumbers: [2, 4],
    });

    expect(response.ok).toBe(false);
    expect(response.error.code).toBe("VALIDATION_FAILED");
    expect(validateApiResponseContract(response)).toEqual([]);
  });

  it("reports missing contract fields for contributor integrations", () => {
    expect(validateApiResponseContract({ ok: false, error: { message: "" }, meta: {} })).toEqual([
      "meta.contractVersion must be a non-empty string",
      "error.code must be a non-empty string",
      "error.message must be a non-empty string",
    ]);
  });
});
