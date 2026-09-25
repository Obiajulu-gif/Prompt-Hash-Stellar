/**
 * Event Version Registry
 * 
 * Maintains a registry of supported contract event versions and provides
 * utilities for version detection, validation, and conformance checking.
 */

/**
 * Registry of supported event versions by event type.
 * 
 * Keys are event type names (from contract events.rs).
 * Values are arrays of supported version numbers.
 */
export const SUPPORTED_VERSIONS: Record<string, number[]> = {
  PromptCreated: [1],
  PromptPurchased: [1],
  PromptAdminModerated: [1, 2], // V2 adds reason and policy_reference
  DisputeOpened: [1],
  DisputeResolved: [1],
  PromptPriceUpdated: [1],
  LicenseTransferred: [1],
  PromptTipped: [1],
  VoucherAdded: [1],
  VoucherRemoved: [1],
};

/**
 * Check if a specific event version is supported by this consumer.
 * 
 * @param eventType - The contract event type name
 * @param version - The event version number
 * @returns true if supported, false otherwise
 */
export function isSupportedVersion(eventType: string, version: number): boolean {
  const supported = SUPPORTED_VERSIONS[eventType];
  if (!supported) {
    return false; // Unknown event type
  }
  return supported.includes(version);
}

/**
 * Detect the version of an event from its data structure.
 * 
 * For V1 events (no explicit version field), returns 1.
 * For V2+ events, extracts the version field.
 * 
 * @param topic - The event topic name
 * @param data - The decoded event data
 * @returns The detected version number
 */
export function detectEventVersion(topic: string, data: any): number {
  // V2+ events have explicit version field
  if (data && typeof data.version === "number") {
    return data.version;
  }

  // V1 events have no version field (implicit V1)
  return 1;
}

/**
 * Get the latest supported version for an event type.
 * 
 * @param eventType - The contract event type name
 * @returns The highest supported version number, or 0 if unknown
 */
export function getLatestSupportedVersion(eventType: string): number {
  const supported = SUPPORTED_VERSIONS[eventType];
  if (!supported || supported.length === 0) {
    return 0;
  }
  return Math.max(...supported);
}

/**
 * Check if a consumer needs to upgrade to support a detected version.
 * 
 * @param eventType - The contract event type name
 * @param detectedVersion - The version detected from the event
 * @returns true if consumer must upgrade, false if already supported
 */
export function requiresUpgrade(eventType: string, detectedVersion: number): boolean {
  return !isSupportedVersion(eventType, detectedVersion);
}

/**
 * Get the list of all registered event types.
 * 
 * @returns Array of event type names
 */
export function getRegisteredEventTypes(): string[] {
  return Object.keys(SUPPORTED_VERSIONS);
}

/**
 * Validate that an event structure conforms to its version spec.
 * 
 * This is a basic structural validation. For comprehensive validation,
 * use conformance tests with snapshot comparisons.
 * 
 * @param eventType - The contract event type name
 * @param version - The event version number
 * @param data - The event data to validate
 * @returns Validation result with errors if any
 */
export interface EventValidationResult {
  valid: boolean;
  errors: string[];
}

export function validateEventStructure(
  eventType: string,
  version: number,
  data: any
): EventValidationResult {
  const errors: string[] = [];

  // Check if event type is known
  if (!SUPPORTED_VERSIONS[eventType]) {
    errors.push(`Unknown event type: ${eventType}`);
    return { valid: false, errors };
  }

  // Check if version is supported
  if (!isSupportedVersion(eventType, version)) {
    errors.push(`Unsupported version ${version} for event type ${eventType}`);
    return { valid: false, errors };
  }

  // Version-specific structural validation
  switch (eventType) {
    case "PromptCreated":
      validatePromptCreated(version, data, errors);
      break;
    case "PromptAdminModerated":
      validatePromptAdminModerated(version, data, errors);
      break;
    case "PromptPurchased":
      validatePromptPurchased(version, data, errors);
      break;
    // Add other event types as needed
  }

  return {
    valid: errors.length === 0,
    errors,
  };
}

/**
 * Validate PromptCreated event structure
 */
function validatePromptCreated(version: number, data: any, errors: string[]): void {
  if (version === 1) {
    if (!data.prompt_id) errors.push("Missing required field: prompt_id");
    if (!data.creator) errors.push("Missing required field: creator");
    if (data.price_stroops === undefined) errors.push("Missing required field: price_stroops");
    if (!data.asset) errors.push("Missing required field: asset");
  }
}

/**
 * Validate PromptAdminModerated event structure
 */
function validatePromptAdminModerated(version: number, data: any, errors: string[]): void {
  if (version === 1) {
    if (!data.prompt_id) errors.push("Missing required field: prompt_id");
    if (!data.admin) errors.push("Missing required field: admin");
    if (!data.status) errors.push("Missing required field: status");
  }

  if (version === 2) {
    // V2 adds mandatory reason and policy_reference
    if (!data.prompt_id) errors.push("Missing required field: prompt_id");
    if (!data.admin) errors.push("Missing required field: admin");
    if (!data.status) errors.push("Missing required field: status");
    if (data.reason === undefined) errors.push("Missing required field: reason (V2)");
    if (!data.policy_reference) errors.push("Missing required field: policy_reference (V2)");
  }
}

/**
 * Validate PromptPurchased event structure
 */
function validatePromptPurchased(version: number, data: any, errors: string[]): void {
  if (version === 1) {
    if (!data.prompt_id) errors.push("Missing required field: prompt_id");
    if (!data.buyer) errors.push("Missing required field: buyer");
    if (!data.creator) errors.push("Missing required field: creator");
    if (data.price_stroops === undefined) errors.push("Missing required field: price_stroops");
    // referrer is optional (Option<Address>)
  }
}

/**
 * Format a quarantine reason for an unsupported event version.
 * 
 * @param eventType - The contract event type name
 * @param detectedVersion - The version detected from the event
 * @returns A standardized quarantine reason string
 */
export function formatQuarantineReason(eventType: string, detectedVersion: number): string {
  const latestSupported = getLatestSupportedVersion(eventType);
  if (detectedVersion > latestSupported) {
    return `unsupported_version_${detectedVersion}_requires_consumer_upgrade`;
  }
  return `unsupported_version_${detectedVersion}`;
}

/**
 * Get upgrade instructions for a consumer to support a new event version.
 * 
 * @param eventType - The contract event type name
 * @param targetVersion - The version to upgrade to
 * @returns Human-readable upgrade instructions
 */
export function getUpgradeInstructions(eventType: string, targetVersion: number): string {
  const current = getLatestSupportedVersion(eventType);

  if (targetVersion <= current) {
    return `Version ${targetVersion} is already supported for ${eventType}.`;
  }

  return `
To support ${eventType} version ${targetVersion}:

1. Review the contract event schema changes in contracts/prompt-hash/src/events.rs
2. Add version ${targetVersion} to SUPPORTED_VERSIONS["${eventType}"] array
3. Implement decode${eventType}V${targetVersion}() decoder function
4. Add version-specific validation in validateEventStructure()
5. Write conformance tests with snapshot comparisons
6. Update documentation in docs/event-versioning.md
7. Deploy consumer before contract upgrade (for breaking changes)
8. Monitor quarantine for misclassified events after deployment

Breaking change checklist:
- [ ] Field removal or renaming
- [ ] Type changes
- [ ] Semantic meaning changes
- [ ] Required fields added

If any checklist item is true, this is a BREAKING change.
Consumer MUST be deployed before contract upgrade.
  `.trim();
}

/**
 * Event version metadata for documentation and auditing
 */
export interface EventVersionMetadata {
  version: number;
  introduced: string; // ISO date
  deprecated?: string; // ISO date
  breaking: boolean;
  changes: string[];
}

/**
 * Registry of event version metadata for documentation
 */
export const VERSION_METADATA: Record<string, Record<number, EventVersionMetadata>> = {
  PromptAdminModerated: {
    1: {
      version: 1,
      introduced: "2024-01-01",
      breaking: false,
      changes: ["Initial version with prompt_id, admin, status"],
    },
    2: {
      version: 2,
      introduced: "2024-02-01",
      breaking: false, // Backward compatible (added fields)
      changes: [
        "Added reason field (ModerationReason enum)",
        "Added policy_reference field (String)",
        "Enhanced audit trail for compliance",
      ],
    },
  },
  // Add other events as they evolve
};

/**
 * Get metadata for a specific event version
 * 
 * @param eventType - The contract event type name
 * @param version - The event version number
 * @returns Metadata object or null if not found
 */
export function getVersionMetadata(
  eventType: string,
  version: number
): EventVersionMetadata | null {
  const eventMetadata = VERSION_METADATA[eventType];
  if (!eventMetadata) return null;
  return eventMetadata[version] || null;
}

/**
 * Check if a version transition is breaking
 * 
 * @param eventType - The contract event type name
 * @param fromVersion - The old version number
 * @param toVersion - The new version number
 * @returns true if transition is breaking, false otherwise
 */
export function isBreakingTransition(
  eventType: string,
  fromVersion: number,
  toVersion: number
): boolean {
  const metadata = getVersionMetadata(eventType, toVersion);
  return metadata ? metadata.breaking : false;
}
