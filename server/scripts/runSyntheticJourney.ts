import { Keypair } from "@stellar/stellar-sdk";
import {
  startSyntheticMonitoring,
  runSyntheticJourney,
  type SyntheticMode,
} from "../src/services/syntheticJourneyMonitor";

const mode = (process.env.SYNTHETIC_MODE ??
  "authorization-probe") as SyntheticMode;
const secret = process.env.SYNTHETIC_BUYER_SECRET;
const keypair = secret ? Keypair.fromSecret(secret) : undefined;
const buyerAddress =
  process.env.SYNTHETIC_BUYER_ADDRESS ?? keypair?.publicKey();

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

function positiveInt(value: string | undefined): number | undefined {
  if (value === undefined || value === "") return undefined;
  const parsed = Number(value);
  if (!Number.isFinite(parsed) || parsed <= 0) {
    console.error(
      "Synthetic monitor interval/threshold must be positive numbers.",
    );
    process.exit(2);
  }
  return Math.floor(parsed);
}

const config = {
  baseUrl: process.env.SYNTHETIC_BASE_URL!,
  promptId: process.env.SYNTHETIC_PROMPT_ID!,
  buyerAddress: buyerAddress!,
  mode,
};

const dependencies = {
  fetch: globalThis.fetch,
  signChallenge: keypair
    ? (challenge: string) =>
        Buffer.from(keypair.sign(Buffer.from(challenge, "utf8"))).toString(
          "base64",
        )
    : undefined,
};

const watch =
  process.argv.includes("--watch") ||
  process.env.SYNTHETIC_WATCH === "1" ||
  process.env.SYNTHETIC_WATCH === "true";

if (!watch) {
  async function main(): Promise<void> {
    const result = await runSyntheticJourney(config, dependencies);
    console.log(JSON.stringify(result));
    process.exitCode = result.success ? 0 : 1;
  }

  void main().catch(() => {
    console.error("Synthetic journey runner failed.");
    process.exitCode = 1;
  });
} else {
  const intervalMs = positiveInt(process.env.SYNTHETIC_INTERVAL_MS) ?? 60_000;
  const failureThreshold =
    positiveInt(process.env.SYNTHETIC_FAILURE_THRESHOLD) ?? 2;

  const monitor = startSyntheticMonitoring(config, dependencies, {
    intervalMs,
    failureThreshold,
    runImmediately: true,
    unref: false,
  });

  const shutdown = (): void => {
    monitor.stop();
    process.exit(0);
  };
  process.once("SIGINT", shutdown);
  process.once("SIGTERM", shutdown);
}
