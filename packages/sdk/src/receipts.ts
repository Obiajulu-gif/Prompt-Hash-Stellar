/**
 * Standalone purchase-receipt verifier — Issue #436.
 *
 * Validates a `PurchaseReceipt` directly against Stellar RPC. No PromptHash
 * API or database access is required: every check re-derives the truth from
 * the ledger itself and the receipt's own signature, so a receipt stays
 * verifiable after index rebuilds or API key rotation.
 */
import {
  Account,
  BASE_FEE,
  Contract,
  TransactionBuilder,
  nativeToScVal,
  rpc as StellarRpc,
  scValToNative,
} from "@stellar/stellar-sdk";
import sodium from "libsodium-wrappers";
import type {
  PurchaseReceipt,
  ReceiptCurrentEntitlement,
  ReceiptVerificationResult,
} from "./types.js";

/** Deterministic (sorted-key) JSON serialization used for both signing and verifying. */
export function canonicalizeReceipt(receipt: PurchaseReceipt): string {
  return JSON.stringify(sortKeysDeep(receipt));
}

function sortKeysDeep(value: unknown): unknown {
  if (Array.isArray(value)) return value.map(sortKeysDeep);
  if (value !== null && typeof value === "object") {
    return Object.keys(value as Record<string, unknown>)
      .sort()
      .reduce<Record<string, unknown>>((acc, key) => {
        acc[key] = sortKeysDeep((value as Record<string, unknown>)[key]);
        return acc;
      }, {});
  }
  return value;
}

async function verifySignature(
  receipt: PurchaseReceipt,
  signature: string,
  signerPublicKey: string,
): Promise<boolean> {
  await sodium.ready;
  try {
    const message = sodium.from_string(canonicalizeReceipt(receipt));
    const sig = sodium.from_base64(signature, sodium.base64_variants.ORIGINAL);
    const pk = sodium.from_base64(signerPublicKey, sodium.base64_variants.ORIGINAL);
    return sodium.crypto_sign_verify_detached(sig, message, pk);
  } catch {
    return false;
  }
}

/**
 * Finds the contract event this receipt claims to reference. Prefers the
 * event at the recorded index (its position among matching events within
 * the same transaction) and falls back to the first same-tx match.
 */
async function fetchMatchingEvent(
  server: StellarRpc.Server,
  receipt: PurchaseReceipt,
): Promise<StellarRpc.Api.EventResponse | undefined> {
  const response = await server.getEvents({
    startLedger: receipt.transaction.ledger,
    filters: [{ type: "contract", contractIds: [receipt.contract.id] }],
    limit: 200,
  });

  const sameTx = response.events.filter((event) => event.txHash === receipt.transaction.hash);
  return sameTx[receipt.event.index] ?? sameTx[0];
}

export interface VerifyReceiptOptions {
  /** Overrides the RPC endpoint the receipt itself points at (defaults to `receipt.network.rpcUrl`). */
  rpcUrl?: string;
  allowHttp?: boolean;
  /** A funded account used only to simulate read-only calls (has_access / get_dispute). */
  simulationAccount?: string;
  /** Skip the live current-entitlement lookup and only verify the historical purchase proof. */
  skipEntitlementCheck?: boolean;
}

/**
 * Verifies a signed purchase receipt.
 *
 * `valid` is true only when the signature checks out AND the referenced
 * transaction is found, succeeded, on the claimed network, and its decoded
 * event matches every receipt field exactly. `currentEntitlement` is a
 * best-effort secondary signal (does the buyer still hold the license right
 * now) that never affects `valid`, since a receipt proves a historical
 * purchase occurred — not present-day ownership.
 */
export async function verifyReceipt(
  receipt: PurchaseReceipt,
  signature: string,
  signerPublicKey: string,
  options: VerifyReceiptOptions = {},
): Promise<ReceiptVerificationResult> {
  const errors: string[] = [];
  const checks = {
    signatureValid: false,
    networkMatches: false,
    transactionFound: false,
    transactionSucceeded: false,
    eventMatches: false,
  };

  checks.signatureValid = await verifySignature(receipt, signature, signerPublicKey);
  if (!checks.signatureValid) {
    errors.push(
      "Receipt signature does not match its contents — the receipt has been tampered with or was not issued by the expected signer.",
    );
  }

  const rpcUrl = options.rpcUrl ?? receipt.network.rpcUrl;
  const server = new StellarRpc.Server(rpcUrl, {
    allowHttp: options.allowHttp ?? new URL(rpcUrl).hostname === "localhost",
  });

  try {
    const network = await server.getNetwork();
    checks.networkMatches = network.passphrase === receipt.network.passphrase;
    if (!checks.networkMatches) {
      errors.push(
        `Receipt claims network "${receipt.network.passphrase}" but the RPC endpoint reports "${network.passphrase}".`,
      );
    }
  } catch (err) {
    errors.push(`Unable to reach RPC to confirm network identity: ${(err as Error).message}`);
  }

  try {
    const tx = await server.getTransaction(receipt.transaction.hash);
    checks.transactionFound = tx.status !== "NOT_FOUND";
    checks.transactionSucceeded = tx.status === "SUCCESS";

    if (!checks.transactionFound) {
      errors.push(
        "Transaction was not found on this network — it may be orphaned, unconfirmed, or belong to a different network.",
      );
    } else if (!checks.transactionSucceeded) {
      errors.push(`Transaction did not succeed (status: ${tx.status}).`);
    } else if ("ledger" in tx && tx.ledger !== receipt.transaction.ledger) {
      errors.push(
        `Transaction ledger (${tx.ledger}) does not match the receipt's recorded ledger (${receipt.transaction.ledger}).`,
      );
    }
  } catch (err) {
    errors.push(`Unable to fetch transaction from RPC: ${(err as Error).message}`);
  }

  if (checks.transactionFound && checks.transactionSucceeded) {
    try {
      const event = await fetchMatchingEvent(server, receipt);
      if (!event) {
        errors.push("No matching contract event found for this receipt's transaction.");
      } else {
        const topic = scValToNative(event.topic[0]);
        const data = scValToNative(event.value) as Record<string, unknown>;
        const promptId = data.prompt_id !== undefined ? String(data.prompt_id) : undefined;
        const buyer = data.buyer !== undefined ? String(data.buyer) : undefined;
        const priceStroops =
          data.price_stroops !== undefined
            ? String(data.price_stroops)
            : data.resale_price !== undefined
              ? String(data.resale_price)
              : undefined;

        checks.eventMatches =
          topic === receipt.event.topic &&
          promptId === receipt.prompt.id &&
          buyer === receipt.buyer &&
          priceStroops === receipt.amount.stroops;

        if (!checks.eventMatches) {
          errors.push(
            "On-chain event fields do not match the receipt — one or more receipt fields have been altered.",
          );
        }
      }
    } catch (err) {
      errors.push(`Unable to fetch/decode contract events: ${(err as Error).message}`);
    }
  }

  let currentEntitlement: ReceiptCurrentEntitlement | undefined;
  if (!options.skipEntitlementCheck) {
    currentEntitlement = await checkCurrentEntitlement(server, receipt, options).catch(
      () => undefined,
    );
  }

  const valid =
    checks.signatureValid &&
    checks.networkMatches &&
    checks.transactionFound &&
    checks.transactionSucceeded &&
    checks.eventMatches;

  return { valid, checks, currentEntitlement, errors };
}

/**
 * Best-effort live read of whether the buyer still holds the license today,
 * and whether a dispute has since refunded it. Never throws — callers treat
 * a missing result as "unknown", not "invalid".
 */
async function checkCurrentEntitlement(
  server: StellarRpc.Server,
  receipt: PurchaseReceipt,
  options: VerifyReceiptOptions,
): Promise<ReceiptCurrentEntitlement> {
  const source = options.simulationAccount ?? receipt.buyer;
  const account = new Account(source, (await server.getAccount(source)).sequenceNumber());

  const simulate = async (method: string, args: ReturnType<typeof nativeToScVal>[]) => {
    const tx = new TransactionBuilder(account, {
      fee: BASE_FEE,
      networkPassphrase: receipt.network.passphrase,
    })
      .addOperation(new Contract(receipt.contract.id).call(method, ...args))
      .setTimeout(30)
      .build();
    const simulation = await server.simulateTransaction(tx);
    if (StellarRpc.Api.isSimulationError(simulation) || !simulation.result) {
      return undefined;
    }
    return scValToNative(simulation.result.retval);
  };

  const hasAccessResult = await simulate("has_access", [
    nativeToScVal(receipt.buyer, { type: "address" }),
    nativeToScVal(BigInt(receipt.prompt.id), { type: "u64" }),
  ]);

  let disputeStatus: ReceiptCurrentEntitlement["disputeStatus"];
  try {
    const dispute = await simulate("get_dispute", [
      nativeToScVal(BigInt(receipt.prompt.id), { type: "u64" }),
      nativeToScVal(receipt.buyer, { type: "address" }),
    ]);
    const rawStatus = (dispute as { status?: unknown } | undefined)?.status;
    const tag =
      rawStatus && typeof rawStatus === "object" && "tag" in (rawStatus as Record<string, unknown>)
        ? (rawStatus as { tag: string }).tag
        : typeof rawStatus === "string"
          ? rawStatus
          : undefined;
    if (tag === "Open" || tag === "Refunded" || tag === "Rejected") {
      disputeStatus = tag;
    }
  } catch {
    // No dispute on record for this prompt/buyer — leave undefined.
  }

  return { hasAccess: Boolean(hasAccessResult), disputeStatus };
}
