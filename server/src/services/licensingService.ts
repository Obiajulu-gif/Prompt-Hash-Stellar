import connectDb from "../db/connectDb";
import Prompt from "../models/Prompt";
import Purchase from "../models/Purchase";
import LicenseTemplate from "../models/LicenseTemplate";
import LicenseSnapshot from "../models/LicenseSnapshot";
import { logger } from "./structuredLogger";

/** Shape of the licensing fields stored on a Prompt document (#759). */
export interface PromptLicenseState {
  licenseTemplateKey: string | null;
  licenseTemplateVersion: number | null;
  licenseVersionIndex: number;
  licenseSummary: string;
  licenseTermsText: string;
  licenseAllowedUses: string[];
  licenseCommercialUse: boolean;
  licenseAttributionRequired: boolean;
  licenseRedistributionAllowed: boolean;
  licenseCustomTerms: string;
  licenseUpdatedAt: Date | null;
}

/** Fallback terms used when a prompt has no explicit license configured. */
export const DEFAULT_LICENSE: Omit<
  PromptLicenseState,
  | "licenseTemplateKey"
  | "licenseTemplateVersion"
  | "licenseVersionIndex"
  | "licenseUpdatedAt"
> = {
  licenseSummary: "Default marketplace license",
  licenseTermsText:
    "The buyer receives a personal, non-exclusive license to use the purchased prompt and its outputs. " +
    "Redistribution or resale of the prompt itself is not permitted without the creator's written consent.",
  licenseAllowedUses: ["personal", "internal-business"],
  licenseCommercialUse: false,
  licenseAttributionRequired: false,
  licenseRedistributionAllowed: false,
  licenseCustomTerms: "",
};

export interface UpdateLicenseInput {
  promptId: string;
  actingWallet: string;
  templateKey?: string;
  templateVersion?: number;
  summary?: string;
  termsText?: string;
  allowedUses?: string[];
  commercialUse?: boolean;
  attributionRequired?: boolean;
  redistributionAllowed?: boolean;
  customTerms?: string;
}

export interface UpdateLicenseResult {
  ok: boolean;
  status: number;
  error?: string;
  license?: PromptLicenseState;
}

function materialChange(
  before: PromptLicenseState,
  after: Omit<PromptLicenseState, "licenseVersionIndex" | "licenseUpdatedAt">,
): boolean {
  return (
    before.licenseTemplateKey !== after.licenseTemplateKey ||
    before.licenseTemplateVersion !== after.licenseTemplateVersion ||
    before.licenseSummary !== after.licenseSummary ||
    before.licenseTermsText !== after.licenseTermsText ||
    before.licenseCommercialUse !== after.licenseCommercialUse ||
    before.licenseAttributionRequired !== after.licenseAttributionRequired ||
    before.licenseRedistributionAllowed !== after.licenseRedistributionAllowed ||
    before.licenseCustomTerms !== after.licenseCustomTerms ||
    JSON.stringify([...before.licenseAllowedUses].sort()) !==
      JSON.stringify([...after.licenseAllowedUses].sort())
  );
}

/**
 * Resolve the license terms a prompt currently advertises. Falls back to the
 * marketplace default when the creator has never configured one (#759).
 */
export async function resolveCurrentLicense(
  promptId: string,
): Promise<PromptLicenseState> {
  await connectDb();
  const prompt = await Prompt.findOne({ onChainId: promptId })
    .select(
      "licenseTemplateKey licenseTemplateVersion licenseVersionIndex " +
        "licenseSummary licenseTermsText licenseAllowedUses " +
        "licenseCommercialUse licenseAttributionRequired " +
        "licenseRedistributionAllowed licenseCustomTerms licenseUpdatedAt",
    )
    .lean<PromptLicenseState | null>();

  if (!prompt || !prompt.licenseTermsText) {
    return {
      ...DEFAULT_LICENSE,
      licenseTemplateKey: prompt?.licenseTemplateKey ?? null,
      licenseTemplateVersion: prompt?.licenseTemplateVersion ?? null,
      licenseVersionIndex: 1,
      licenseUpdatedAt: null,
    };
  }
  return prompt;
}

/**
 * Creator updates the license attached to a prompt (#759).
 *
 * Material changes bump `licenseVersionIndex`; purchases already recorded
 * keep their snapshots untouched, which is the core guarantee of the issue.
 * A `templateKey`/`templateVersion` pair must reference an active template
 * version — either both are provided or neither.
 */
export async function updatePromptLicense(
  input: UpdateLicenseInput,
): Promise<UpdateLicenseResult> {
  await connectDb();

  const actingWallet = String(input.actingWallet || "").toLowerCase();
  if (!input.promptId || !actingWallet) {
    return { ok: false, status: 400, error: "promptId and walletAddress are required." };
  }

  const templateProvided =
    input.templateKey !== undefined || input.templateVersion !== undefined;
  if (templateProvided && (input.templateKey === undefined || input.templateVersion === undefined)) {
    return {
      ok: false,
      status: 400,
      error: "templateKey and templateVersion must be provided together.",
    };
  }

  const prompt = await Prompt.findOne({ onChainId: String(input.promptId) })
    .populate("owner", "walletAddress")
    .lean<{
      owner?: { walletAddress?: string } | null;
      licenseTemplateKey?: string | null;
      licenseTemplateVersion?: number | null;
      licenseVersionIndex?: number;
      licenseSummary?: string;
      licenseTermsText?: string;
      licenseAllowedUses?: string[];
      licenseCommercialUse?: boolean;
      licenseAttributionRequired?: boolean;
      licenseRedistributionAllowed?: boolean;
      licenseCustomTerms?: string;
      licenseUpdatedAt?: Date | null;
    } | null>();
  if (!prompt) {
    return { ok: false, status: 404, error: `Prompt ${input.promptId} not found.` };
  }

  const ownerWallet = (prompt.owner as { walletAddress?: string } | null)?.walletAddress;
  if (!ownerWallet || ownerWallet.toLowerCase() !== actingWallet) {
    return { ok: false, status: 403, error: "Only the prompt owner can change the license." };
  }

  let resolved = {
    summary: input.summary,
    termsText: input.termsText,
    allowedUses: input.allowedUses,
    commercialUse: input.commercialUse,
    attributionRequired: input.attributionRequired,
    redistributionAllowed: input.redistributionAllowed,
    customTerms: input.customTerms,
  };

  if (templateProvided) {
    const template = await LicenseTemplate.findOne({
      key: String(input.templateKey).toLowerCase(),
      version: Number(input.templateVersion),
      active: true,
    }).lean();
    if (!template) {
      return {
        ok: false,
        status: 404,
        error: `License template ${input.templateKey}@${input.templateVersion} not found or inactive.`,
      };
    }
    resolved = {
      summary: input.summary ?? template.summary,
      termsText: input.termsText ?? template.termsText,
      allowedUses: input.allowedUses ?? template.allowedUses,
      commercialUse: input.commercialUse ?? template.commercialUse,
      attributionRequired: input.attributionRequired ?? template.attributionRequired,
      redistributionAllowed: input.redistributionAllowed ?? template.redistributionAllowed,
      customTerms: input.customTerms ?? "",
    };
  }

  const before: PromptLicenseState = {
    licenseTemplateKey: prompt.licenseTemplateKey ?? null,
    licenseTemplateVersion: prompt.licenseTemplateVersion ?? null,
    licenseVersionIndex: prompt.licenseVersionIndex ?? 1,
    licenseSummary: prompt.licenseSummary ?? "",
    licenseTermsText: prompt.licenseTermsText ?? "",
    licenseAllowedUses: prompt.licenseAllowedUses ?? [],
    licenseCommercialUse: prompt.licenseCommercialUse ?? false,
    licenseAttributionRequired: prompt.licenseAttributionRequired ?? false,
    licenseRedistributionAllowed: prompt.licenseRedistributionAllowed ?? false,
    licenseCustomTerms: prompt.licenseCustomTerms ?? "",
    licenseUpdatedAt: prompt.licenseUpdatedAt ?? null,
  };

  const after = {
    licenseTemplateKey: templateProvided ? String(input.templateKey).toLowerCase() : before.licenseTemplateKey,
    licenseTemplateVersion: templateProvided ? Number(input.templateVersion) : before.licenseTemplateVersion,
    licenseSummary: resolved.summary ?? before.licenseSummary,
    licenseTermsText: resolved.termsText ?? before.licenseTermsText,
    licenseAllowedUses: resolved.allowedUses ?? before.licenseAllowedUses,
    licenseCommercialUse: resolved.commercialUse ?? before.licenseCommercialUse,
    licenseAttributionRequired: resolved.attributionRequired ?? before.licenseAttributionRequired,
    licenseRedistributionAllowed: resolved.redistributionAllowed ?? before.licenseRedistributionAllowed,
    licenseCustomTerms: resolved.customTerms ?? before.licenseCustomTerms,
  };

  if (!materialChange(before, after)) {
    return { ok: true, status: 200, license: before };
  }

  if (!after.licenseTermsText || after.licenseTermsText.length < 10) {
    return { ok: false, status: 400, error: "licenseTermsText must be at least 10 characters." };
  }

  const nextVersionIndex = (before.licenseVersionIndex ?? 1) + 1;
  const updatedAt = new Date();

  const updated = await Prompt.findOneAndUpdate(
    { onChainId: String(input.promptId) },
    {
      $set: {
        licenseTemplateKey: after.licenseTemplateKey,
        licenseTemplateVersion: after.licenseTemplateVersion,
        licenseVersionIndex: nextVersionIndex,
        licenseSummary: after.licenseSummary,
        licenseTermsText: after.licenseTermsText,
        licenseAllowedUses: after.licenseAllowedUses,
        licenseCommercialUse: after.licenseCommercialUse,
        licenseAttributionRequired: after.licenseAttributionRequired,
        licenseRedistributionAllowed: after.licenseRedistributionAllowed,
        licenseCustomTerms: after.licenseCustomTerms,
        licenseUpdatedAt: updatedAt,
      },
    },
    { new: true },
  ).lean<PromptLicenseState | null>();

  if (!updated) {
    return { ok: false, status: 404, error: `Prompt ${input.promptId} not found.` };
  }

  return { ok: true, status: 200, license: updated };
}

/**
 * Freeze the license terms active at purchase time into a LicenseSnapshot and
 * link the purchase to it (#759).
 *
 * Idempotent: re-processing the same purchase event returns the existing
 * snapshot instead of creating a second copy. Legacy purchases (created
 * before #759, which lack a version link) are treated as version 1.
 */
export async function snapshotLicenseForPurchase(
  promptId: string,
  buyerWallet: string,
  purchaseId: string,
): Promise<void> {
  try {
    await connectDb();

    const wallet = String(buyerWallet || "").toLowerCase();
    if (!promptId || !wallet || !purchaseId) return;

    const existing = await LicenseSnapshot.findOne({ purchaseId }).lean();
    if (existing) return; // idempotent replay

    const purchase = await Purchase.findById(purchaseId)
    .select("licenseVersionIndex")
    .lean<{ licenseVersionIndex?: number } | null>();
    const prompt = await Prompt.findOne({ onChainId: promptId })
      .select(
        "licenseTemplateKey licenseTemplateVersion licenseVersionIndex " +
          "licenseSummary licenseTermsText licenseAllowedUses " +
          "licenseCommercialUse licenseAttributionRequired " +
          "licenseRedistributionAllowed licenseCustomTerms",
      )
      .lean<PromptLicenseState | null>();

    const license: PromptLicenseState =
      prompt && prompt.licenseTermsText
        ? prompt
        : {
            ...DEFAULT_LICENSE,
            licenseTemplateKey: prompt?.licenseTemplateKey ?? null,
            licenseTemplateVersion: prompt?.licenseTemplateVersion ?? null,
            licenseVersionIndex: 1,
            licenseUpdatedAt: null,
          };

    const snapshot = await LicenseSnapshot.create({
      purchaseId: String(purchaseId),
      promptId: String(promptId),
      buyerWallet: wallet,
      licenseVersionIndex: purchase?.licenseVersionIndex ?? 1,
      templateKey: license.licenseTemplateKey ?? null,
      templateVersion: license.licenseTemplateVersion ?? null,
      name: license.licenseSummary || DEFAULT_LICENSE.licenseSummary,
      summary: license.licenseSummary || DEFAULT_LICENSE.licenseSummary,
      termsText: license.licenseTermsText || DEFAULT_LICENSE.licenseTermsText,
      allowedUses: license.licenseAllowedUses ?? [],
      commercialUse: license.licenseCommercialUse,
      attributionRequired: license.licenseAttributionRequired,
      redistributionAllowed: license.licenseRedistributionAllowed,
      customTerms: license.licenseCustomTerms ?? "",
      snapshotAt: new Date(),
    });

    await Purchase.updateOne(
      { _id: purchaseId },
      { $set: { licenseSnapshotId: String(snapshot._id) } },
    );
  } catch (err) {
    // Never break purchase indexing because of snapshot bookkeeping.
    logger.error(
      "license snapshot failed for purchase",
      { err: (err as Error).message, promptId, purchaseId },
    );
  }
}

/**
 * Buyer-facing receipt renderer (#759): returns the purchase with the exact
 * license terms frozen at purchase time. Legacy purchases with no snapshot
 * report `legacy: true` and resolve the marketplace default terms.
 */
export async function getPurchaseReceipt(
  promptId: string,
  buyerWallet: string,
): Promise<{
  ok: boolean;
  status: number;
  receipt?: Record<string, unknown>;
  error?: string;
}> {
  await connectDb();

  const wallet = String(buyerWallet || "").toLowerCase();
  if (!promptId || !wallet) {
    return { ok: false, status: 400, error: "promptId and walletAddress are required." };
  }

  const purchase = await Purchase.findOne({
    promptId: String(promptId),
    buyerWallet: wallet,
  })
    .sort({ createdAt: -1 })
    .lean();

  if (!purchase) {
    return { ok: false, status: 404, error: "Purchase not found for this wallet." };
  }

  const snapshot = purchase.licenseSnapshotId
    ? await LicenseSnapshot.findById(purchase.licenseSnapshotId).lean()
    : await LicenseSnapshot.findOne({ purchaseId: String(purchase._id) }).lean();

  if (!snapshot) {
    // Legacy purchase (pre-#759): surface the marketplace default terms and
    // mark it explicitly so the UI can annotate the receipt.
    return {
      ok: true,
      status: 200,
      receipt: {
        purchaseId: String(purchase._id),
        promptId: String(purchase.promptId),
        buyerWallet: wallet,
        versionIndex: purchase.versionIndex,
        txHash: purchase.txHash ?? "",
        purchasedAt: (purchase as unknown as { createdAt?: Date }).createdAt ?? null,
        license: {
          legacy: true,
          licenseVersionIndex: 1,
          name: DEFAULT_LICENSE.licenseSummary,
          summary: DEFAULT_LICENSE.licenseSummary,
          termsText: DEFAULT_LICENSE.licenseTermsText,
          allowedUses: DEFAULT_LICENSE.licenseAllowedUses,
          commercialUse: DEFAULT_LICENSE.licenseCommercialUse,
          attributionRequired: DEFAULT_LICENSE.licenseAttributionRequired,
          redistributionAllowed: DEFAULT_LICENSE.licenseRedistributionAllowed,
          customTerms: "",
          snapshotAt: null,
        },
      },
    };
  }

  return {
    ok: true,
    status: 200,
    receipt: {
      purchaseId: String(purchase._id),
      promptId: String(purchase.promptId),
      buyerWallet: wallet,
      versionIndex: purchase.versionIndex,
      txHash: purchase.txHash ?? "",
      purchasedAt: (purchase as unknown as { createdAt?: Date }).createdAt ?? null,
      license: {
        legacy: false,
        licenseVersionIndex: snapshot.licenseVersionIndex,
        name: snapshot.name,
        summary: snapshot.summary,
        termsText: snapshot.termsText,
        allowedUses: snapshot.allowedUses,
        commercialUse: snapshot.commercialUse,
        attributionRequired: snapshot.attributionRequired,
        redistributionAllowed: snapshot.redistributionAllowed,
        customTerms: snapshot.customTerms,
        snapshotAt: snapshot.snapshotAt,
      },
    },
  };
}

/**
 * Admin dispute view (#759): full snapshot plus the prompt's *current* terms,
 * so a reviewer can see exactly what changed after the purchase.
 */
export async function getLicenseSnapshotForDispute(
  promptId: string,
  buyerWallet: string,
): Promise<{ ok: boolean; status: number; dispute?: Record<string, unknown>; error?: string }> {
  await connectDb();

  const wallet = String(buyerWallet || "").toLowerCase();
  const purchase = await Purchase.findOne({
    promptId: String(promptId),
    buyerWallet: wallet,
  })
    .sort({ createdAt: -1 })
    .lean();
  if (!purchase) {
    return { ok: false, status: 404, error: "Purchase not found for this wallet." };
  }

  const snapshot = purchase.licenseSnapshotId
    ? await LicenseSnapshot.findById(purchase.licenseSnapshotId).lean()
    : await LicenseSnapshot.findOne({ purchaseId: String(purchase._id) }).lean();

  const prompt = await Prompt.findOne({ onChainId: String(promptId) })
    .select(
      "licenseVersionIndex licenseSummary licenseTermsText licenseCustomTerms",
    )
    .lean<PromptLicenseState | null>();

  return {
    ok: true,
    status: 200,
    dispute: {
      purchaseId: String(purchase._id),
      purchaseStatus: purchase.status,
      snapshot: snapshot ?? null,
      currentPromptLicense: prompt
        ? {
            licenseVersionIndex: prompt.licenseVersionIndex ?? 1,
            summary: prompt.licenseSummary ?? "",
            termsText: prompt.licenseTermsText ?? "",
            customTerms: prompt.licenseCustomTerms ?? "",
          }
        : null,
    },
  };
}
