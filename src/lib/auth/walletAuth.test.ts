import { beforeEach, describe, expect, it, vi } from "vitest";
import { signInWithWallet, WALLET_SIGN_IN_PROMPT_ID } from "./walletAuth";

describe("signInWithWallet", () => {
  beforeEach(() => {
    vi.restoreAllMocks();
  });

  it("requests a wallet sign-in challenge, signs it, and verifies ownership", async () => {
    const fetchMock = vi
      .fn()
      .mockResolvedValueOnce(
        new Response(
          JSON.stringify({
            token: "auth-token",
            challenge: "prompt-hash unlock:wallet-sign-in",
            expiresAt: Date.now() + 60_000,
            nonce: "nonce-1",
          }),
          { status: 200 },
        ),
      )
      .mockResolvedValueOnce(
        new Response(
          JSON.stringify({
            address: "GAUTHADDRESS",
            authenticated: true,
            expiresAt: Date.now() + 60_000,
          }),
          { status: 200 },
        ),
      );
    vi.stubGlobal("fetch", fetchMock);

    const signMessage = vi.fn().mockResolvedValue({ signedMessage: "signed-auth-challenge" });
    const session = await signInWithWallet("GAUTHADDRESS", signMessage);

    expect(fetchMock).toHaveBeenNthCalledWith(
      1,
      "/api/auth/challenge",
      expect.objectContaining({
        method: "POST",
        body: JSON.stringify({
          address: "GAUTHADDRESS",
          promptId: WALLET_SIGN_IN_PROMPT_ID,
        }),
      }),
    );
    expect(signMessage).toHaveBeenCalledWith("prompt-hash unlock:wallet-sign-in");
    expect(fetchMock).toHaveBeenNthCalledWith(
      2,
      "/api/auth/verify",
      expect.objectContaining({
        method: "POST",
        body: JSON.stringify({
          address: "GAUTHADDRESS",
          token: "auth-token",
          signedMessage: "signed-auth-challenge",
          promptId: WALLET_SIGN_IN_PROMPT_ID,
        }),
      }),
    );
    expect(session.authenticated).toBe(true);
  });

  it("fails when the wallet declines message signing", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn().mockResolvedValueOnce(
        new Response(
          JSON.stringify({
            token: "auth-token",
            challenge: "prompt-hash unlock:wallet-sign-in",
            expiresAt: Date.now() + 60_000,
            nonce: "nonce-1",
          }),
          { status: 200 },
        ),
      ),
    );

    await expect(signInWithWallet("GAUTHADDRESS", vi.fn().mockResolvedValue(""))).rejects.toThrow(
      "User declined message signing.",
    );
  });
});
