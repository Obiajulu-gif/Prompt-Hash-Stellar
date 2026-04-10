import { networkPassphrase } from "@/lib/env";

interface ChallengeResponse {
  token: string;
  challenge: string;
  expiresAt: number;
  nonce: string;
}

interface UnlockResponse {
  promptId: string;
  title: string;
  contentHash: string;
  plaintext: string;
}

export async function unlockPromptContent(
  address: string,
  promptId: bigint,
  signMessage: (
    message: string,
    opts: { address: string; networkPassphrase: string },
  ) => Promise<{ signedMessage: string }>,
) {
  const challengeResponse = await fetch("/api/auth/challenge", {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
    },
    body: JSON.stringify({
      address,
      promptId: promptId.toString(),
    }),
  });

  if (!challengeResponse.ok) {
    throw new Error(await challengeResponse.text());
  }

  const challenge = (await challengeResponse.json()) as ChallengeResponse;
  const signed = await signMessage(challenge.challenge, {
    address,
    networkPassphrase,
  });

  const unlockResponse = await fetch("/api/prompts/unlock", {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
    },
    body: JSON.stringify({
      token: challenge.token,
      promptId: promptId.toString(),
      address,
      signedMessage: signed.signedMessage,
    }),
  });

  if (!unlockResponse.ok) {
    const body = await unlockResponse.json().catch(() => null);
    throw new Error(
      body && typeof body === "object" && "error" in body
        ? String(body.error)
        : "Failed to unlock prompt.",
    );
  }

  return (await unlockResponse.json()) as UnlockResponse;
}
