import Notification from "../models/Notification";

const DUPLICATE_KEY_CODE = 11000;

export type PromptUpdatePurchase = {
  buyerWallet: string;
};

export type PromptUpdatePrompt = {
  _id: unknown;
  title: string;
};

export type PromptUpdateNotificationInput = {
  recipientWallet: string;
  promptId: string;
  promptTitle: string;
  versionIndex: number;
  changeNote?: string;
  sourceEventId: string;
};

export type NotificationDeliveryResult = {
  recipientWallet: string;
  dedupeKey: string;
  created: boolean;
};

function isDuplicateKeyError(error: unknown): boolean {
  return (
    typeof error === "object" &&
    error !== null &&
    "code" in error &&
    (error as { code?: number }).code === DUPLICATE_KEY_CODE
  );
}

function normalizeWallet(wallet: string): string {
  return wallet.trim().toLowerCase();
}

export function buildPromptUpdateDedupeKey(input: PromptUpdateNotificationInput): string {
  return [
    "prompt_update",
    input.promptId,
    normalizeWallet(input.recipientWallet),
    String(input.versionIndex),
  ].join(":");
}

export async function createNotificationOnce(
  input: PromptUpdateNotificationInput,
): Promise<NotificationDeliveryResult> {
  const recipientWallet = normalizeWallet(input.recipientWallet);
  const dedupeKey = buildPromptUpdateDedupeKey({ ...input, recipientWallet });

  try {
    await Notification.create({
      recipientWallet,
      promptId: input.promptId,
      promptTitle: input.promptTitle,
      type: "prompt_update",
      message: `"${input.promptTitle}" has been updated by the creator.`,
      versionIndex: input.versionIndex,
      changeNote: input.changeNote ?? "",
      sourceEventId: input.sourceEventId,
      dedupeKey,
      deliveryStatus: "delivered",
      attempts: 1,
      lastError: "",
      deliveredAt: new Date(),
      read: false,
    });

    return { recipientWallet, dedupeKey, created: true };
  } catch (error) {
    if (isDuplicateKeyError(error)) {
      return { recipientWallet, dedupeKey, created: false };
    }

    throw error;
  }
}

export async function notifyPromptUpdateBuyers(
  purchases: PromptUpdatePurchase[],
  prompt: PromptUpdatePrompt,
  versionIndex: number,
  changeNote = "",
): Promise<NotificationDeliveryResult[]> {
  const promptId = String(prompt._id);
  const sourceEventId = `prompt_update:${promptId}:${versionIndex}`;
  const uniqueWallets = Array.from(
    new Set(
      purchases
        .map((purchase) => purchase.buyerWallet)
        .filter((wallet): wallet is string => typeof wallet === "string" && wallet.trim().length > 0)
        .map(normalizeWallet),
    ),
  );

  return Promise.all(
    uniqueWallets.map((recipientWallet) =>
      createNotificationOnce({
        recipientWallet,
        promptId,
        promptTitle: prompt.title,
        versionIndex,
        changeNote,
        sourceEventId,
      }),
    ),
  );
}
