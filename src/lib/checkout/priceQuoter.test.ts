import { describe, it, expect } from "vitest";
import {
  generatePriceQuote,
  validateQuoteForPurchase,
  isQuoteExpired,
  formatAssetUnits,
  parseAssetUnitsToBigInt,
  convertBaseStroopsToAssetUnits,
  calculateSlippageMaxCharge,
  SUPPORTED_ASSET_CONFIGS,
} from "./priceQuoter";

describe("Multi-Currency Price Quoting & Protection (#760)", () => {
  const FIXED_NOW = 1700000000000; // Fixed timestamp for deterministic tests
  const BASE_PROMPT_ID = "101";
  const BASE_PRICE_STROOPS = 100_000_000n; // 10 XLM

  describe("Deterministic Quote Generation", () => {
    it("generates deterministic quotes when provided a fixed timestamp", () => {
      const quote = generatePriceQuote({
        promptId: BASE_PROMPT_ID,
        baseAmountStroops: BASE_PRICE_STROOPS,
        targetAsset: "XLM",
        now: FIXED_NOW,
        ttlSeconds: 60,
        slippageBps: 50,
        feeBps: 500,
      });

      expect(quote.promptId).toBe(BASE_PROMPT_ID);
      expect(quote.baseAsset).toBe("XLM");
      expect(quote.quoteAsset).toBe("XLM");
      expect(quote.createdAt).toBe(FIXED_NOW);
      expect(quote.expiresAt).toBe(FIXED_NOW + 60_000);
      expect(quote.rawQuoteAmountUnits).toBe(100_000_000n);
      expect(quote.quoteAmountFormatted).toBe("10");
      expect(quote.slippageBps).toBe(50);
      expect(quote.slippageAmountUnits).toBe(500_000n); // 0.5% of 10 XLM = 0.05 XLM = 500,000 stroops
      expect(quote.maxChargeAmountUnits).toBe(100_500_000n); // 10.05 XLM
      expect(quote.platformFeeUnits).toBe(5_000_000n); // 5% of 10 XLM = 0.5 XLM
      expect(quote.creatorAmountUnits).toBe(95_000_000n); // 9.5 XLM
    });

    it("generates multi-currency USDC quote with exact exchange conversion", () => {
      // 1 XLM = 0.12 USDC (120,000 / 1,000_000)
      // 10 XLM (100,000,000 Stroops) => (100,000,000 * 120,000) / 1,000,000 = 12,000,000 units (1.2 USDC)
      const quote = generatePriceQuote({
        promptId: BASE_PROMPT_ID,
        baseAmountStroops: BASE_PRICE_STROOPS,
        targetAsset: "USDC",
        now: FIXED_NOW,
      });

      expect(quote.quoteAsset).toBe("USDC");
      expect(quote.rawQuoteAmountUnits).toBe(12_000_000n);
      expect(quote.quoteAmountFormatted).toBe("1.2");
      expect(quote.platformFeeUnits).toBe(600_000n); // 5% of 1.2 USDC = 0.06 USDC
      expect(quote.creatorAmountUnits).toBe(11_400_000n); // 1.14 USDC
    });
  });

  describe("Integer-Safe Asset Handling & Rounding Behavior", () => {
    it("handles unit string formatting and parsing safely without floating point errors", () => {
      expect(formatAssetUnits(100_000_000n, 7)).toBe("10");
      expect(formatAssetUnits(12_345_678n, 7)).toBe("1.2345678");
      expect(formatAssetUnits(1n, 7)).toBe("0.0000001");
      expect(formatAssetUnits(0n, 7)).toBe("0");

      expect(parseAssetUnitsToBigInt("10", 7)).toBe(100_000_000n);
      expect(parseAssetUnitsToBigInt("1.2345678", 7)).toBe(12_345_678n);
      expect(parseAssetUnitsToBigInt("0.0000001", 7)).toBe(1n);
    });

    it("prevents zero truncation on very small non-zero base amounts", () => {
      // 1 Stroop converted with low rate: (1 * 120,000) / 1,000,000 = 0 -> rounds up to 1 unit
      const converted = convertBaseStroopsToAssetUnits(1n, 120_000n, 1_000_000n);
      expect(converted).toBe(1n);
    });

    it("applies ceiling rounding for slippage calculation to cover max charges", () => {
      // 1 unit with 50 BPS slippage => (1 * 50 + 9999) / 10000 = 1 unit slippage added
      const { slippageAmountUnits, maxChargeAmountUnits } = calculateSlippageMaxCharge(1n, 50);
      expect(slippageAmountUnits).toBe(1n);
      expect(maxChargeAmountUnits).toBe(2n);
    });
  });

  describe("Quote Expiry Protection", () => {
    it("identifies active vs expired quotes", () => {
      const quote = generatePriceQuote({
        promptId: BASE_PROMPT_ID,
        baseAmountStroops: BASE_PRICE_STROOPS,
        now: FIXED_NOW,
        ttlSeconds: 30,
      });

      expect(isQuoteExpired(quote, FIXED_NOW)).toBe(false);
      expect(isQuoteExpired(quote, FIXED_NOW + 29_999)).toBe(false);
      expect(isQuoteExpired(quote, FIXED_NOW + 30_000)).toBe(true);
      expect(isQuoteExpired(quote, FIXED_NOW + 60_000)).toBe(true);
    });

    it("rejects purchase settlement when quote is expired", () => {
      const quote = generatePriceQuote({
        promptId: BASE_PROMPT_ID,
        baseAmountStroops: BASE_PRICE_STROOPS,
        targetAsset: "XLM",
        now: FIXED_NOW,
        ttlSeconds: 60,
      });

      // Valid before expiry
      const validResult = validateQuoteForPurchase(quote, {
        promptId: BASE_PROMPT_ID,
        requestedAsset: "XLM",
        now: FIXED_NOW + 59_000,
      });
      expect(validResult.isValid).toBe(true);

      // Invalid after expiry
      const expiredResult = validateQuoteForPurchase(quote, {
        promptId: BASE_PROMPT_ID,
        requestedAsset: "XLM",
        now: FIXED_NOW + 60_000,
      });
      expect(expiredResult.isValid).toBe(false);
      expect(expiredResult.errorCode).toBe("QUOTE_EXPIRED");
      expect(expiredResult.errorMessage).toContain(
        "Expired quotes cannot be used for purchase settlement"
      );
    });
  });

  describe("Asset & Mismatch Rules", () => {
    it("rejects settlement on asset mismatch", () => {
      const usdcQuote = generatePriceQuote({
        promptId: BASE_PROMPT_ID,
        baseAmountStroops: BASE_PRICE_STROOPS,
        targetAsset: "USDC",
        now: FIXED_NOW,
      });

      const result = validateQuoteForPurchase(usdcQuote, {
        promptId: BASE_PROMPT_ID,
        requestedAsset: "XLM", // Mismatched asset requested
        now: FIXED_NOW,
      });

      expect(result.isValid).toBe(false);
      expect(result.errorCode).toBe("QUOTE_ASSET_MISMATCH");
      expect(result.errorMessage).toContain('quote is for "USDC"');
    });

    it("rejects settlement on prompt ID mismatch", () => {
      const quote = generatePriceQuote({
        promptId: BASE_PROMPT_ID,
        baseAmountStroops: BASE_PRICE_STROOPS,
        now: FIXED_NOW,
      });

      const result = validateQuoteForPurchase(quote, {
        promptId: "999", // Different prompt
        requestedAsset: "XLM",
        now: FIXED_NOW,
      });

      expect(result.isValid).toBe(false);
      expect(result.errorCode).toBe("QUOTE_PROMPT_MISMATCH");
    });

    it("rejects settlement when authorized charge ceiling is breached", () => {
      const quote = generatePriceQuote({
        promptId: BASE_PROMPT_ID,
        baseAmountStroops: BASE_PRICE_STROOPS,
        now: FIXED_NOW,
        slippageBps: 100, // 1%
      });

      // Max charge is 101,000,000 stroops (10.1 XLM)
      const result = validateQuoteForPurchase(quote, {
        promptId: BASE_PROMPT_ID,
        requestedAsset: "XLM",
        maxAuthorizedAmountUnits: 100_000_000n, // Lower authorized ceiling
        now: FIXED_NOW,
      });

      expect(result.isValid).toBe(false);
      expect(result.errorCode).toBe("QUOTE_CHARGE_EXCEEDED");
    });
  });

  describe("Supported Asset Configuration", () => {
    it("includes standard Stellar asset configurations (XLM, USDC, EURC)", () => {
      expect(SUPPORTED_ASSET_CONFIGS.XLM).toBeDefined();
      expect(SUPPORTED_ASSET_CONFIGS.USDC).toBeDefined();
      expect(SUPPORTED_ASSET_CONFIGS.EURC).toBeDefined();
      expect(SUPPORTED_ASSET_CONFIGS.USDC.issuer).toBeTruthy();
    });

    it("throws error for unsupported asset request", () => {
      expect(() =>
        generatePriceQuote({
          promptId: BASE_PROMPT_ID,
          baseAmountStroops: BASE_PRICE_STROOPS,
          targetAsset: "UNSUPPORTED_TOKEN",
          now: FIXED_NOW,
        })
      ).toThrow("Unsupported quote asset");
    });
  });
});
