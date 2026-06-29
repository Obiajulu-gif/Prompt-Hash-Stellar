import { xlmToStroops } from "@/lib/stellar/format";

export const LISTING_LIMITS = {
  imageUrl: 512,
  title: 120,
  category: 40,
  preview: 280,
  fullPrompt: 50_000,
  encryptedPayload: 4096,
  wrappedKey: 256,
  encryptionIv: 64,
  maxCoCreators: 10,
  maxSplitBps: 9_500,
} as const;

export const ESTIMATED_ENCRYPTION_OVERHEAD = 1.37;

export type RevenueSplitFormInput = {
  address: string;
  sharePercent: string;
};

export type ListingFormInput = {
  imageUrl: string;
  title: string;
  category: string;
  previewText: string;
  fullPrompt: string;
  priceXlm: string;
  coCreators: RevenueSplitFormInput[];
};

export type ListingValidationErrors = Partial<
  Record<keyof ListingFormInput, string>
>;

export interface ListingValidationOptions {
  /**
   * When true, large encrypted payloads are stored off-chain (IPFS) and only a
   * compact reference is kept on-chain, so the on-chain payload size cap no
   * longer constrains how long the full prompt can be.
   */
  offChainStorage?: boolean;
}

export type ChecklistStatus = "pass" | "fail" | "warn" | "info";

export interface ListingChecklistItem {
  id: string;
  label: string;
  status: ChecklistStatus;
  hint?: string;
}

const STELLAR_ADDRESS_PATTERN = /^[GC][A-Z2-7]{20,}$/i;

function trim(value: string) {
  return value.trim();
}

export function validateListingForm(
  input: ListingFormInput,
  options: ListingValidationOptions = {},
): ListingValidationErrors {
  const errors: ListingValidationErrors = {};
  const imageUrl = trim(input.imageUrl);
  const title = trim(input.title);
  const category = trim(input.category);
  const previewText = trim(input.previewText);
  const fullPrompt = trim(input.fullPrompt);
  const priceXlm = trim(input.priceXlm);
  const coCreators = input.coCreators ?? [];

  if (!imageUrl) {
    errors.imageUrl = "Add an image URL so your listing has a cover on browse cards.";
  } else if (imageUrl.length > LISTING_LIMITS.imageUrl) {
    errors.imageUrl = `Shorten the image URL to ${LISTING_LIMITS.imageUrl} characters or fewer.`;
  } else if (!/^https?:\/\/.+/i.test(imageUrl)) {
    errors.imageUrl =
      "Use a full URL starting with http:// or https:// so the cover image loads correctly.";
  }

  if (!title) {
    errors.title = "Add a title that tells buyers what your prompt does.";
  } else if (title.length < 3) {
    errors.title = "Use at least 3 characters so the title is descriptive enough.";
  } else if (title.length > LISTING_LIMITS.title) {
    errors.title = `Shorten the title to ${LISTING_LIMITS.title} characters or fewer.`;
  }

  if (!category) {
    errors.category = "Select a category so buyers can filter to your listing.";
  } else if (category.length > LISTING_LIMITS.category) {
    errors.category = `Choose a shorter category (max ${LISTING_LIMITS.category} characters).`;
  }

  if (!previewText) {
    errors.previewText =
      "Add preview text â€” this public snippet appears on browse cards before purchase.";
  } else if (previewText.length < 10) {
    errors.previewText =
      "Write at least 10 characters of preview text so buyers know what they are getting.";
  } else if (previewText.length > LISTING_LIMITS.preview) {
    errors.previewText = `Shorten the preview to ${LISTING_LIMITS.preview} characters or fewer.`;
  }

  if (!fullPrompt) {
    errors.fullPrompt =
      "Paste the full prompt content â€” it is encrypted in your browser before submission.";
  } else if (fullPrompt.length < 10) {
    errors.fullPrompt =
      "Add at least 10 characters of prompt content so buyers receive meaningful value.";
  } else if (fullPrompt.length > LISTING_LIMITS.fullPrompt) {
    errors.fullPrompt = `Shorten the prompt to ${LISTING_LIMITS.fullPrompt.toLocaleString()} characters or fewer.`;
  } else if (!options.offChainStorage && wouldExceedPayloadLimit(fullPrompt.length)) {
    const maxPlaintext = Math.floor(
      LISTING_LIMITS.encryptedPayload / ESTIMATED_ENCRYPTION_OVERHEAD,
    );
    errors.fullPrompt =
      `This prompt will exceed the ${LISTING_LIMITS.encryptedPayload.toLocaleString()}-character ` +
      `on-chain encrypted payload limit after encryption. ` +
      `Keep the prompt under ~${maxPlaintext.toLocaleString()} characters.`;
  }

  if (!priceXlm) {
    errors.priceXlm = "Enter a price in XLM â€” use a value greater than zero.";
  } else {
    try {
      const price = xlmToStroops(priceXlm);
      if (price <= 0n) {
        errors.priceXlm = "Set a price greater than zero XLM.";
      }
    } catch (error) {
      errors.priceXlm =
        error instanceof Error
          ? error.message
          : "Enter a valid XLM amount with up to 7 decimal places.";
    }
  }

  if (coCreators.length > LISTING_LIMITS.maxCoCreators) {
    errors.coCreators =
      `Add up to ${LISTING_LIMITS.maxCoCreators} co-creators per listing.`;
  } else if (coCreators.length > 0) {
    const seenAddresses = new Set<string>();
    let totalSplitBps = 0;

    for (const coCreator of coCreators) {
      const address = trim(coCreator.address).toUpperCase();
      const sharePercent = trim(coCreator.sharePercent);
      const parsedSharePercent = Number(sharePercent);

      if (!address) {
        errors.coCreators = "Enter a Stellar address for each co-creator.";
        break;
      }

      if (!STELLAR_ADDRESS_PATTERN.test(address)) {
        errors.coCreators =
          "Use a valid Stellar public key for each co-creator address.";
        break;
      }

      if (seenAddresses.has(address)) {
        errors.coCreators =
          "Each co-creator address can only appear once per listing.";
        break;
      }

      if (!sharePercent || Number.isNaN(parsedSharePercent)) {
        errors.coCreators =
          "Enter a valid revenue share percentage for each co-creator.";
        break;
      }

      if (parsedSharePercent <= 0) {
        errors.coCreators =
          "Each co-creator share must be greater than 0%.";
        break;
      }

      totalSplitBps += Math.round(parsedSharePercent * 100);
      seenAddresses.add(address);
    }

    if (!errors.coCreators && totalSplitBps > LISTING_LIMITS.maxSplitBps) {
      errors.coCreators =
        `Co-creator shares cannot exceed ${(LISTING_LIMITS.maxSplitBps / 100).toFixed(2)}% in total.`;
    }
  }

  return errors;
}

export interface EncryptedPayloadInput {
  encryptedPrompt: string;
  wrappedKey: string;
  encryptionIv: string;
}

export type PayloadValidationErrors = Partial<
  Record<keyof EncryptedPayloadInput, string>
>;

export function estimateEncryptedSize(plaintextLength: number): number {
  return Math.ceil(plaintextLength * ESTIMATED_ENCRYPTION_OVERHEAD);
}

export function wouldExceedPayloadLimit(plaintextLength: number): boolean {
  return estimateEncryptedSize(plaintextLength) > LISTING_LIMITS.encryptedPayload;
}

export function validateEncryptedPayload(
  input: EncryptedPayloadInput,
): PayloadValidationErrors {
  const errors: PayloadValidationErrors = {};

  if (!input.encryptedPrompt) {
    errors.encryptedPrompt = "Encrypted prompt payload is missing.";
  } else if (input.encryptedPrompt.length > LISTING_LIMITS.encryptedPayload) {
    errors.encryptedPrompt =
      `Encrypted payload is ${input.encryptedPrompt.length.toLocaleString()} characters, ` +
      `exceeding the on-chain limit of ${LISTING_LIMITS.encryptedPayload.toLocaleString()}. ` +
      `Shorten the full prompt and try again.`;
  }

  if (!input.wrappedKey) {
    errors.wrappedKey = "Wrapped encryption key is missing.";
  } else if (input.wrappedKey.length > LISTING_LIMITS.wrappedKey) {
    errors.wrappedKey =
      `Wrapped key is ${input.wrappedKey.length} characters, ` +
      `exceeding the limit of ${LISTING_LIMITS.wrappedKey}.`;
  }

  if (!input.encryptionIv) {
    errors.encryptionIv = "Encryption IV is missing.";
  } else if (input.encryptionIv.length > LISTING_LIMITS.encryptionIv) {
    errors.encryptionIv =
      `Encryption IV is ${input.encryptionIv.length} characters, ` +
      `exceeding the limit of ${LISTING_LIMITS.encryptionIv}.`;
  }

  return errors;
}

export function buildListingChecklistItems(
  input: ListingFormInput,
  options: ListingValidationOptions = {},
): ListingChecklistItem[] {
  const errors = validateListingForm(input, options);
  const items: ListingChecklistItem[] = [];

  const fieldChecks: Array<{
    id: keyof ListingFormInput;
    label: string;
  }> = [
    { id: "title", label: "Title" },
    { id: "category", label: "Category" },
    { id: "previewText", label: "Preview text" },
    { id: "fullPrompt", label: "Full prompt content" },
    { id: "priceXlm", label: "Price" },
    { id: "imageUrl", label: "Image URL" },
    { id: "coCreators", label: "Co-creators" },
  ];

  for (const { id, label } of fieldChecks) {
    const message = errors[id];
    items.push({
      id,
      label,
      status: message ? "fail" : "pass",
      hint: message,
    });
  }

  const titleWords = trim(input.title).split(/\s+/).filter(Boolean).length;
  if (!errors.title && titleWords < 3) {
    items.push({
      id: "title-words",
      label: "Title could be more descriptive",
      status: "warn",
      hint: "Aim for at least 3 words to help buyers find your listing",
    });
  }

  const previewLen = trim(input.previewText).length;
  if (!errors.previewText && previewLen > 0 && previewLen < 60) {
    items.push({
      id: "preview-length",
      label: "Preview text is short",
      status: "warn",
      hint: "A longer preview (60+ characters) improves buyer confidence",
    });
  }

  const promptLen = trim(input.fullPrompt).length;
  if (!errors.fullPrompt && promptLen > 0 && promptLen < 100) {
    items.push({
      id: "prompt-length",
      label: "Full prompt seems short",
      status: "warn",
      hint: "Buyers expect substantial prompt content â€” consider expanding it",
    });
  }

  let priceValue = Number.NaN;
  try {
    if (!errors.priceXlm && trim(input.priceXlm)) {
      priceValue = Number(trim(input.priceXlm));
    }
  } catch {
    // covered by validateListingForm
  }

  if (!errors.priceXlm && !Number.isNaN(priceValue) && priceValue > 0 && priceValue < 0.5) {
    items.push({
      id: "price-low",
      label: "Price is very low",
      status: "warn",
      hint: "Listings under 0.5 XLM may signal low quality to buyers",
    });
  }

  const totalRevenueSharePercent = (input.coCreators ?? []).reduce(
    (sum, coCreator) => sum + (Number(trim(coCreator.sharePercent)) || 0),
    0,
  );

  if (!errors.coCreators && totalRevenueSharePercent > 0) {
    items.push({
      id: "revenue-share",
      label: "Revenue sharing configured",
      status: "info",
      hint: `${totalRevenueSharePercent.toFixed(2)}% shared across co-creators.`,
    });
  }

  return items;
}
