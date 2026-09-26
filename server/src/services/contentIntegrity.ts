import crypto from "crypto";
import connectDb from "../db/connectDb";
import Prompt from "../models/Prompt";

export interface IntegrityCheckResult {
  promptId: string;
  status: "ok" | "corrupted" | "missing" | "unreachable";
  checkedAt: string;
  expectedHash: string | null;
  computedHash: string | null;
  error: string | null;
}

export interface BatchIntegrityReport {
  checkedAt: string;
  totalChecked: number;
  okCount: number;
  corruptedCount: number;
  missingCount: number;
  unreachableCount: number;
  failures: IntegrityCheckResult[];
}

/**
 * Recomputes the SHA-256 digest of a prompt's encrypted payload (or content payload)
 * and compares it against the recorded content hash.
 *
 * Security & Privacy:
 * - Logs strictly hex hash digests, prompt IDs, and status.
 * - NEVER outputs or logs plaintext content, encryption keys, or IVs.
 * - Does NOT alter listing availability or sale state (`isActive` remains untouched).
 */
export async function verifyPromptIntegrity(
  promptId: string,
): Promise<IntegrityCheckResult> {
  await connectDb();

  const prompt = await Prompt.findOne({
    $or: [{ _id: promptId }, { onChainId: promptId }],
  });

  const now = new Date();

  if (!prompt) {
    return {
      promptId,
      status: "unreachable",
      checkedAt: now.toISOString(),
      expectedHash: null,
      computedHash: null,
      error: `Prompt ${promptId} not found in storage`,
    };
  }

  const payload = prompt.encryptedPrompt || prompt.content;

  if (!payload || typeof payload !== "string" || payload.trim().length === 0) {
    const errorMsg = "Encrypted payload is missing or empty";
    prompt.integrityStatus = "missing";
    prompt.integrityCheckedAt = now;
    prompt.integrityError = errorMsg;
    await prompt.save();

    console.warn(`[integrity-check] Prompt ${promptId}: status=missing`);

    return {
      promptId: String(prompt._id),
      status: "missing",
      checkedAt: now.toISOString(),
      expectedHash: prompt.contentHash || null,
      computedHash: null,
      error: errorMsg,
    };
  }

  // Compute SHA-256 digest of payload
  const computedHash = crypto
    .createHash("sha256")
    .update(payload, "utf8")
    .digest("hex");

  const expectedHash = prompt.contentHash || null;

  let status: "ok" | "corrupted" = "ok";
  let errorMsg: string | null = null;

  if (expectedHash && expectedHash.toLowerCase() !== computedHash.toLowerCase()) {
    status = "corrupted";
    errorMsg = `Content hash mismatch. Expected ${expectedHash}, computed ${computedHash}`;
  }

  // Record verification results without modifying listing availability state
  prompt.integrityStatus = status;
  prompt.integrityCheckedAt = now;
  prompt.integrityError = errorMsg;
  if (!prompt.contentHash) {
    prompt.contentHash = computedHash;
  }
  await prompt.save();

  if (status === "corrupted") {
    console.error(
      `[integrity-check] ALERT: Prompt ${promptId} status=corrupted expected=${expectedHash} computed=${computedHash}`,
    );
  } else {
    console.log(`[integrity-check] Prompt ${promptId}: status=ok hash=${computedHash}`);
  }

  return {
    promptId: String(prompt._id),
    status,
    checkedAt: now.toISOString(),
    expectedHash: expectedHash || computedHash,
    computedHash,
    error: errorMsg,
  };
}

/**
 * Runs a content integrity audit sweep across all stored prompt listings.
 */
export async function runContentIntegrityCheckAll(): Promise<BatchIntegrityReport> {
  await connectDb();

  const prompts = await Prompt.find().select("_id onChainId").lean();

  const now = new Date().toISOString();
  let okCount = 0;
  let corruptedCount = 0;
  let missingCount = 0;
  let unreachableCount = 0;
  const failures: IntegrityCheckResult[] = [];

  for (const p of prompts) {
    const id = String(p._id);
    const result = await verifyPromptIntegrity(id);

    if (result.status === "ok") {
      okCount += 1;
    } else if (result.status === "corrupted") {
      corruptedCount += 1;
      failures.push(result);
    } else if (result.status === "missing") {
      missingCount += 1;
      failures.push(result);
    } else if (result.status === "unreachable") {
      unreachableCount += 1;
      failures.push(result);
    }
  }

  console.log(
    `[integrity-sweep] Complete: total=${prompts.length} ok=${okCount} corrupted=${corruptedCount} missing=${missingCount}`,
  );

  return {
    checkedAt: now,
    totalChecked: prompts.length,
    okCount,
    corruptedCount,
    missingCount,
    unreachableCount,
    failures,
  };
}
