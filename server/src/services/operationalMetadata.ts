/**
 * Allow-listed operational metadata. User content, credentials, raw requests,
 * and payment details must never be copied into operational event metadata.
 */
export type OperationalMetadata = Record<string, string | number | boolean>;

export const OPERATIONAL_METADATA_FIELDS = [
  "requestId",
  "jobId",
  "resourceType",
  "resourceId",
  "operation",
  "status",
  "attempt",
  "durationMs",
  "errorCode",
] as const;

const STRING_LIMITS: Partial<
  Record<(typeof OPERATIONAL_METADATA_FIELDS)[number], number>
> = {
  requestId: 128,
  jobId: 128,
  resourceType: 64,
  resourceId: 128,
  operation: 64,
  status: 32,
  errorCode: 64,
};

const MAX_ATTEMPT = 10_000;
const MAX_DURATION_MS = 60 * 60 * 1_000;
const SAFE_IDENTIFIER = /^[A-Za-z0-9][A-Za-z0-9._:-]*$/;
const SENSITIVE_VALUE =
  /^(?:[GC][A-Z2-7]{55}|[^\s@]+@[^\s@]+\.[^\s@]+|\d{1,3}(?:\.\d{1,3}){3}|Bearer\s|sha256=|eyJ[A-Za-z0-9_-]+\.)/i;

function isSafeString(
  key: (typeof OPERATIONAL_METADATA_FIELDS)[number],
  value: unknown,
): value is string {
  const maxLength = STRING_LIMITS[key];
  return (
    typeof value === "string" &&
    value.length > 0 &&
    value.length <= (maxLength ?? 0) &&
    SAFE_IDENTIFIER.test(value) &&
    !SENSITIVE_VALUE.test(value)
  );
}

function isAllowedValue(
  key: (typeof OPERATIONAL_METADATA_FIELDS)[number],
  value: unknown,
): value is string | number | boolean {
  if (key === "attempt") {
    return (
      typeof value === "number" &&
      Number.isSafeInteger(value) &&
      value >= 0 &&
      value <= MAX_ATTEMPT
    );
  }
  if (key === "durationMs") {
    return (
      typeof value === "number" &&
      Number.isFinite(value) &&
      value >= 0 &&
      value <= MAX_DURATION_MS
    );
  }
  return isSafeString(key, value);
}

export function minimizeOperationalMetadata(
  metadata: Record<string, unknown> | undefined,
): OperationalMetadata {
  if (!metadata) return {};
  const minimized: OperationalMetadata = {};
  for (const [key, value] of Object.entries(metadata)) {
    if (
      (OPERATIONAL_METADATA_FIELDS as readonly string[]).includes(key) &&
      isAllowedValue(key as (typeof OPERATIONAL_METADATA_FIELDS)[number], value)
    ) {
      minimized[key] = value;
    }
  }
  return minimized;
}

export const OPERATIONAL_RETENTION_WINDOWS = {
  timelineEventsDays: 90,
  promptEventsDays: 30,
  exportMetadataDays: 30,
  supportEvidenceDays: 365,
} as const;
