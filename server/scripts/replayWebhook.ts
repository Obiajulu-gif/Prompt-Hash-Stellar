#!/usr/bin/env ts-node
import { replayWebhookFixture, type WebhookReplayFixtureName } from "../src/services/localWebhookReplay";

const fixtures: WebhookReplayFixtureName[] = [
  "success",
  "duplicate",
  "stale",
  "invalid-signature",
  "malformed",
];

async function main() {
  const requested = process.argv[2];
  if (!requested || !fixtures.includes(requested as WebhookReplayFixtureName)) {
    console.error(`Usage: yarn webhook:replay <${fixtures.join("|")}>`);
    process.exitCode = 2;
    return;
  }

  const results = await replayWebhookFixture(requested);
  for (const result of results) {
    console.log(JSON.stringify(result));
  }
}

main().catch((error: unknown) => {
  console.error("Webhook fixture replay failed:", error instanceof Error ? error.message : String(error));
  process.exitCode = 1;
});