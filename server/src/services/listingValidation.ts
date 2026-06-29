const CATEGORY_ALIASES: Record<string, string> = {
  marketing: "Marketing",
  "creative writing": "Creative Writing",
  programming: "Programming",
  music: "Music",
  gaming: "Gaming",
  other: "Other",
};

const LISTING_LIMITS = {
  image: 512,
  title: 100,
  content: 50_000,
  category: 40,
  encryptedPayload: 4096,
  wrappedKey: 256,
  encryptionIv: 64,
};

type ListingInput = {
  image?: unknown;
  title?: unknown;
  content?: unknown;
  price?: unknown;
  category?: unknown;
};

export type ListingValidationErrors = Record<string, string>;

export type NormalizedListing = {
  image: string;
  title: string;
  content: string;
  price: number;
  category: string;
};

const asTrimmedString = (value: unknown) =>
  typeof value === "string" ? value.trim() : "";

const normalizeCategory = (value: unknown) => {
  const trimmed = asTrimmedString(value);
  if (!trimmed) return "Other";

  const alias = CATEGORY_ALIASES[trimmed.toLowerCase()];
  if (alias) return alias;

  return trimmed
    .split(/[\s_-]+/)
    .filter(Boolean)
    .map((part) => part.charAt(0).toUpperCase() + part.slice(1).toLowerCase())
    .join(" ");
};

export function normalizeListingMetadata(input: ListingInput): NormalizedListing {
  const image = asTrimmedString(input.image);
  const title = asTrimmedString(input.title).replace(/\s+/g, " ");
  const content = asTrimmedString(input.content);
  const category = normalizeCategory(input.category);
  const parsedPrice =
    typeof input.price === "number"
      ? input.price
      : typeof input.price === "string"
        ? Number(input.price.trim())
        : Number.NaN;

  return {
    image,
    title,
    content,
    price: parsedPrice,
    category,
  };
}

export function validateListingMetadata(
  input: ListingInput,
): {
  normalized: NormalizedListing;
  errors: ListingValidationErrors;
} {
  const normalized = normalizeListingMetadata(input);
  const errors: ListingValidationErrors = {};

  if (!normalized.image) {
    errors.image = "Image URL is required.";
  } else if (normalized.image.length > LISTING_LIMITS.image) {
    errors.image = `Image URL must be ${LISTING_LIMITS.image} characters or fewer.`;
  } else if (!/^https?:\/\/.+/i.test(normalized.image)) {
    errors.image = "Image URL must start with http:// or https://.";
  }

  if (!normalized.title) {
    errors.title = "Title is required.";
  } else if (normalized.title.length < 3) {
    errors.title = "Title must be at least 3 characters long.";
  } else if (normalized.title.length > LISTING_LIMITS.title) {
    errors.title = `Title must be ${LISTING_LIMITS.title} characters or fewer.`;
  }

  if (!normalized.content) {
    errors.content = "Content is required.";
  } else if (normalized.content.length < 10) {
    errors.content = "Content must be at least 10 characters long.";
  } else if (normalized.content.length > LISTING_LIMITS.content) {
    errors.content = `Content must be ${LISTING_LIMITS.content} characters or fewer.`;
  }

  if (!normalized.category) {
    errors.category = "Category is required.";
  } else if (normalized.category.length > LISTING_LIMITS.category) {
    errors.category = `Category must be ${LISTING_LIMITS.category} characters or fewer.`;
  }

  if (!Number.isFinite(normalized.price)) {
    errors.price = "Price must be a valid number.";
  } else if (normalized.price <= 0) {
    errors.price = "Price must be greater than zero.";
  }

  return { normalized, errors };
}

export type EncryptedPayloadInput = {
  encryptedPrompt?: unknown;
  wrappedKey?: unknown;
  encryptionIv?: unknown;
};

export type PayloadValidationErrors = Record<string, string>;

export function validateEncryptedPayload(
  input: EncryptedPayloadInput,
): PayloadValidationErrors {
  const errors: PayloadValidationErrors = {};
  const encryptedPrompt = asTrimmedString(input.encryptedPrompt);
  const wrappedKey = asTrimmedString(input.wrappedKey);
  const encryptionIv = asTrimmedString(input.encryptionIv);

  if (!encryptedPrompt) {
    errors.encryptedPrompt = "Encrypted prompt payload is required.";
  } else if (encryptedPrompt.length > LISTING_LIMITS.encryptedPayload) {
    errors.encryptedPrompt =
      `Encrypted payload is ${encryptedPrompt.length} characters, ` +
      `exceeding the limit of ${LISTING_LIMITS.encryptedPayload}.`;
  }

  if (!wrappedKey) {
    errors.wrappedKey = "Wrapped encryption key is required.";
  } else if (wrappedKey.length > LISTING_LIMITS.wrappedKey) {
    errors.wrappedKey =
      `Wrapped key is ${wrappedKey.length} characters, ` +
      `exceeding the limit of ${LISTING_LIMITS.wrappedKey}.`;
  }

  if (!encryptionIv) {
    errors.encryptionIv = "Encryption IV is required.";
  } else if (encryptionIv.length > LISTING_LIMITS.encryptionIv) {
    errors.encryptionIv =
      `Encryption IV is ${encryptionIv.length} characters, ` +
      `exceeding the limit of ${LISTING_LIMITS.encryptionIv}.`;
  }

  return errors;
}
