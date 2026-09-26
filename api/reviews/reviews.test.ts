// @vitest-environment node
process.env.MONGODB_URI = process.env.MONGODB_URI || "mongodb://localhost:27017/test";
import { describe, expect, it } from "vitest";
import { Keypair } from "@stellar/stellar-sdk";
import submitHandler, { buildReviewMessage, verifyReviewSignature } from "./submit";

describe("Durable Wallet-Signed Reviews API", () => {
  const buyerKeypair = Keypair.random();
  const buyerAddress = buyerKeypair.publicKey();
  const promptId = "101";
  const rating = 5;
  const text = "Outstanding prompt! Clear structure and great output quality.";

  it("builds correct domain-separated review message", () => {
    const message = buildReviewMessage(buyerAddress, promptId, rating, text);
    expect(message).toBe(`prompt-hash review:${buyerAddress}:${promptId}:${rating}:${text}`);
  });

  it("verifies valid domain-separated signature", () => {
    const message = buildReviewMessage(buyerAddress, promptId, rating, text);
    const signature = buyerKeypair.sign(Buffer.from(message, "utf8")).toString("base64");

    const isValid = verifyReviewSignature(buyerAddress, promptId, rating, text, signature);
    expect(isValid).toBe(true);
  });

  it("rejects invalid or tampered signature", () => {
    const message = buildReviewMessage(buyerAddress, promptId, rating, text);
    const signature = buyerKeypair.sign(Buffer.from(message, "utf8")).toString("base64");

    // Tampered rating
    const isValid = verifyReviewSignature(buyerAddress, promptId, 4, text, signature);
    expect(isValid).toBe(false);
  });

  it("rejects review submission without signature", async () => {
    const req = {
      method: "POST",
      body: {
        promptId,
        userAddress: buyerAddress,
        rating,
        text,
      },
    };

    let responseData: any = null;
    let statusCode = 0;
    const res = {
      status: (code: number) => {
        statusCode = code;
        return {
          json: (data: any) => {
            responseData = data;
          },
        };
      },
    };

    await submitHandler(req, res);
    expect(statusCode).toBe(401);
    expect(responseData.error).toContain("signature is required");
  });
});
