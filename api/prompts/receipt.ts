import type { VercelRequest, VercelResponse } from "@vercel/node";
import { withObservability } from "../../src/lib/observability/wrapper";
import {
  buildAndSignReceipt,
  type ReceiptContractConfig,
} from "../../src/lib/stellar/receipts";
import connectDb from "../../server/src/db/connectDb";
import Purchase from "../../server/src/models/Purchase";
import {
  RECEIPT_ERROR_KEYS,
  PURCHASE_KEYS,
} from "../../src/lib/i18n/serverMessages";

/**
 * GET /api/prompts/receipt?promptId=&buyerWallet=&txHash=
 *
 * Issues an independently verifiable purchase receipt (#436). `txHash` is
 * optional — when omitted, the most recent matching `Purchase` record is
 * used only to look up the transaction hash; every other field on the
 * receipt is re-derived from Stellar RPC, never from the database row.
 *
 * Error responses include i18n keys for user-facing messages.
 */
function getServerConfig(): ReceiptContractConfig {
  const rpcUrl =
    process.env.PUBLIC_STELLAR_RPC_URL ?? "https://soroban-testnet.stellar.org";
  const networkPassphrase =
    process.env.PUBLIC_STELLAR_NETWORK_PASSPHRASE ??
    "Test SDF Network ; September 2015";
  const promptHashContractId = process.env.PUBLIC_PROMPT_HASH_CONTRACT_ID ?? "";
  const nativeAssetContractId =
    process.env.PUBLIC_STELLAR_NATIVE_ASSET_CONTRACT_ID ??
    "CDLZFC3SYJYDZT7K67VZ75HPJVIEUVNIXF47ZG2FB2RMQQVU2HHGCYSC";

  return {
    rpcUrl,
    networkPassphrase,
    promptHashContractId,
    nativeAssetContractId,
    allowHttp: new URL(rpcUrl).hostname === "localhost",
  };
}

async function handler(req: VercelRequest, res: VercelResponse): Promise<void> {
  if (req.method !== "GET") {
    res.status(405).json({ error: "Method not allowed." });
    return;
  }

  const { promptId, buyerWallet, txHash: txHashParam } = req.query ?? {};

  if (!promptId || !buyerWallet) {
    res.status(400).json({ error: "promptId and buyerWallet are required." });
    return;
  }

  try {
    let txHash = typeof txHashParam === "string" ? txHashParam : undefined;
    let purchase = null;

    await connectDb();
    purchase = await Purchase.findOne({
      promptId: String(promptId),
      buyerWallet: String(buyerWallet).toLowerCase(),
    }).sort({ createdAt: -1 });

    if (!txHash && !purchase?.txHash) {
      res.status(404).json({
        error: RECEIPT_ERROR_KEYS.NOT_FOUND,
        code: "RECEIPT_NOT_FOUND",
      });
      return;
    }
    txHash = txHash || purchase?.txHash;

    const config = getServerConfig();
    if (!config.promptHashContractId) {
      res.status(500).json({
        error: RECEIPT_ERROR_KEYS.CONFIG_MISSING,
        code: "CONFIGURATION_ERROR",
      });
      return;
    }

    const signed = await buildAndSignReceipt({
      config,
      promptId: String(promptId),
      buyerWallet: String(buyerWallet),
      txHash,
    });

    // Map status/resolution to i18n keys for frontend
    const purchaseStatus = purchase?.status || "purchased";
    const statusKey =
      (PURCHASE_KEYS.STATUS as Record<string, string>)[
        purchaseStatus.toUpperCase()
      ] || PURCHASE_KEYS.STATUS.PURCHASED;

    const disputeResolution = purchase?.disputeResolution;
    const resolutionKey = disputeResolution
      ? (PURCHASE_KEYS.RESOLUTION as Record<string, string>)[
          disputeResolution.toUpperCase()
        ]
      : null;

    res.status(200).json({
      ...signed,
      purchaseStatus,
      purchaseStatusKey: statusKey,
      disputeResolution,
      disputeResolutionKey: resolutionKey,
    });
  } catch (error) {
    const message =
      error instanceof Error ? error.message : RECEIPT_ERROR_KEYS.BUILD_FAILED;
    req.logger?.error({ error: message }, "Receipt build failed");
    res.status(400).json({
      error: RECEIPT_ERROR_KEYS.BUILD_FAILED,
      code: "RECEIPT_BUILD_FAILED",
      details: message,
    });
  }
}

export default withObservability(handler, "prompts/receipt");
