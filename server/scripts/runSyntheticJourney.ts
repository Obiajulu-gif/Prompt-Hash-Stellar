import { Keypair } from "@stellar/stellar-sdk";
import {
  runSyntheticJourney,
  type SyntheticMode,
} from "../src/services/syntheticJourneyMonitor";

const mode = (process.env.SYNTHETIC_MODE ??
  "authorization-probe") as SyntheticMode;
const secret = process.env.SYNTHETIC_BUYER_SECRET;
const keypair = secret ? Keypair.fromSecret(secret) : undefined;
const buyerAddress =
  process.env.SYNTHETIC_BUYER_ADDRESS ?? keypair?.publicKey();

const MAX_ATTEMPTS = Math.max(
  1,
  Number.parseInt(process.env.SYNTHETIC_MAX_ATTEMPTS ?? "3", 10) || 3,
);
const RETRY_BASE_DELAY_MS = Math.max(
  0,
  Number.parseInt(process.env.SYNTHETIC_RETRY_BASE_DELAY_MS ?? "500", 10) ||
    500,
);
const TIMEOUT_MS = Math.max(
  1000,
  Number.parseInt(process.env.SYNTHETIC_TIMEOUT_MS ?? "15000", 10) || 15000,
);

if (
  !process.env.SYNTHETIC_BASE_URL ||
  !process.env.SYNTHETIC_PROMPT_ID ||
  !buyerAddress
) {
  console.error(
    "SYNTHETIC_BASE_URL, SYNTHETIC_PROMPT_ID, and a synthetic buyer address are required.",
  );
  process.exit(2);
}
if (mode !== "authorized" && mode !== "authorization-probe") {
  console.error("SYNTHETIC_MODE must be authorized or authorization-probe.");
  process.exit(2);
}
if (mode === "authorized" && !keypair) {
  console.error("SYNTHETIC_BUYER_SECRET is required in authorized mode.");
  process.exit(2);
}

/**
 * Fetch wrapper enforcing a per-request timeout so a hung upstream cannot
 * stall the scheduled monitor indefinitely.
 */
function fetchWithTimeout(
  input: Parameters<typeof fetch>[0],
  init?: Parameters<typeof fetch>[1],
): ReturnType<typeof fetch> {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), TIMEOUT_MS);
  return fetch(input, { ...init, signal: controller.signal }).finally(() =>
    clearTimeout(timer),
  );
}

/**
 * Authorization-probe failures are expected outcomes (the probe asserts that
 * unauthorized access is rejected), so they are never retried. Only transport
 * errors and 5xx-style failures from the journey are retried.
 */
function isRetryable(error: unknown): boolean {
  if (error instanceof Error && error.name === "AbortError") return true;
  if (error instanceof TypeError) return true; // network-level fetch failure
  return false;
}

async function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

async function runWithRetry<T>(
  operation: () => Promise<T>,
): Promise<T> {
  let lastError: unknown;
  for (let attempt = 1; attempt <= MAX_ATTEMPTS; attempt++) {
    try {
      return await operation();
    } catch (error) {
      lastError = error;
      if (!isRetryable(error) || attempt === MAX_ATTEMPTS) {
        throw error;
      }
      // Exponential backoff: base, 2*base, 4*base, ...
      await sleep(RETRY_BASE_DELAY_MS * 2 ** (attempt - 1));
    }
  }
  throw lastError;
}

async function main(): Promise<void> {
  const result = await runWithRetry(() =>
    runSyntheticJourney(
      {
        baseUrl: process.env.SYNTHETIC_BASE_URL!,
        promptId: process.env.SYNTHETIC_PROMPT_ID!,
        buyerAddress: buyerAddress!,
        mode,
      },
      {
        fetch: fetchWithTimeout,
        signChallenge: keypair
          ? (challenge) =>
              Buffer.from(keypair.sign(Buffer.from(challenge, "utf8"))).toString(
                "base64",
              )
          : undefined,
      },
    ),
  );

  console.log(JSON.stringify(result));
  process.exitCode = result.success ? 0 : 1;
}

void main().catch((error) => {
  // Emit a structured failure record so monitoring can alert on the cause
  // without leaking secrets; rollback is a no-op since the journey is read-only
  // for the authorization probe.
  console.log(
    JSON.stringify({
      success: false,
      mode,
      error: error instanceof Error ? error.name : "UnknownError",
    }),
  );
  console.error("Synthetic journey runner failed.");
  process.exitCode = 1;
});
