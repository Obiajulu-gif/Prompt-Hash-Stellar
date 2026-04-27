// @vitest-environment node

import { Buffer } from "buffer";
import { describe, expect, it } from "vitest";
import { Keypair } from "@stellar/stellar-sdk";
import {
  buildChallengeMessage,
  createChallengeToken,
  verifyChallengeSignature,
  verifyChallengeToken,
} from "./challenge";

describe("unlock challenge verification", () => {
  it("creates and verifies a short-lived challenge token and signature", () => {
    const secret = "unit-test-secret";
    const keypair = Keypair.random();
    const address = keypair.publicKey();
    const promptId = "42";

    const challenge = createChallengeToken(secret, address, promptId, 1_700_000_000_000);
    const payload = verifyChallengeToken(
      secret,
      challenge.token,
      address,
      promptId,
      1_700_000_100_000,
    );

    expect(payload.address).toBe(address);
    expect(payload.promptId).toBe(promptId);

    const message = buildChallengeMessage(payload);
    const signedMessage = Buffer.from(
      keypair.sign(Buffer.from(message, "utf8")),
    ).toString("base64");

    expect(verifyChallengeSignature(address, message, signedMessage)).toBe(true);
  });

  it("rejects expired challenge tokens", () => {
    const secret = "unit-test-secret";
    const keypair = Keypair.random();
    const address = keypair.publicKey();

    const challenge = createChallengeToken(secret, address, "7", 1_700_000_000_000, 1000);

    expect(() =>
      verifyChallengeToken(secret, challenge.token, address, "7", 1_700_000_010_500),
    ).toThrow("expired");
  });
});
