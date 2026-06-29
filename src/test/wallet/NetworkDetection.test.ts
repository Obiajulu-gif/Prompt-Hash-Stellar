import { describe, it, expect } from "vitest";
import { detectNetworkMismatch, mapTechnicalError } from "@/lib/wallet/networkDetection";

describe("Network Detection", () => {
  describe("detectNetworkMismatch", () => {
    it("returns disconnected when wallet is not connected", () => {
      const result = detectNetworkMismatch(false, undefined, "idle");
      
      expect(result.type).toBe("disconnected");
      expect(result.message).toBe("Wallet not connected");
      expect(result.recoveryInstructions).toContain("Connect your Stellar wallet");
    });

    it("returns unavailable when wallet is connecting", () => {
      const result = detectNetworkMismatch(true, undefined, "connecting");
      
      expect(result.type).toBe("unavailable");
      expect(result.message).toBe("Connecting to wallet...");
    });

    it("returns correct when networks match", () => {
      const result = detectNetworkMismatch(true, "TESTNET", "connected");
      
      expect(result.type).toBe("correct");
    });

    it("returns wrong-network when networks don't match", () => {
      const result = detectNetworkMismatch(true, "PUBLIC", "connected");
      
      expect(result.type).toBe("wrong-network");
      expect(result.message).toContain("Wrong network");
      expect(result.recoveryInstructions).toContain("switch your wallet");
    });

    it("returns correct when wallet network is unavailable", () => {
      const result = detectNetworkMismatch(true, undefined, "connected");
      
      expect(result.type).toBe("correct");
      expect(result.message).toBe("Network verification unavailable");
    });

    it("returns disconnected when wallet status is error", () => {
      const result = detectNetworkMismatch(true, "TESTNET", "error");
      
      expect(result.type).toBe("disconnected");
    });
  });

  describe("mapTechnicalError", () => {
    it("maps op_underfunded error to user-friendly message", () => {
      const result = mapTechnicalError(new Error("op_underfunded"));
      
      expect(result).toBe("Insufficient XLM balance. Please add funds to your wallet.");
    });

    it("maps op_no_trust error to user-friendly message", () => {
      const result = mapTechnicalError(new Error("op_no_trust"));
      
      expect(result).toContain("trustline");
    });

    it("maps tx_bad_auth error to user-friendly message", () => {
      const result = mapTechnicalError(new Error("tx_bad_auth"));
      
      expect(result).toContain("authorization failed");
    });

    it("maps timeout error to user-friendly message", () => {
      const result = mapTechnicalError(new Error("Request timed out"));
      
      expect(result).toContain("timed out");
    });

    it("maps user rejection error to user-friendly message", () => {
      const result = mapTechnicalError(new Error("User rejected transaction"));
      
      expect(result).toBe("Transaction was rejected in your wallet.");
    });

    it("returns original message for unmapped errors", () => {
      const originalMessage = "Some unknown error occurred";
      const result = mapTechnicalError(new Error(originalMessage));
      
      expect(result).toBe(originalMessage);
    });

    it("handles string errors", () => {
      const result = mapTechnicalError("op_underfunded");
      
      expect(result).toBe("Insufficient XLM balance. Please add funds to your wallet.");
    });
  });
});
