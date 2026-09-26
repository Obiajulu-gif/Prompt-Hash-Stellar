/**
 * @prompthash/schema — Issue #502
 *
 * Shared, versioned prompt metadata schema for frontend forms, server
 * validation, and the indexer's Mongo model.
 */
export {
  PROMPT_METADATA_SCHEMA_VERSION,
  PROMPT_CATEGORIES,
  PROMPT_LICENCES,
  PROMPT_STATUSES,
  PROMPT_METADATA_LIMITS,
  promptMetadataSchema,
  validatePromptMetadata,
} from "./promptMetadata.js";
export type {
  PromptMetadata,
  PromptCategory,
  PromptLicence,
  PromptStatus,
  PromptMetadataErrors,
} from "./promptMetadata.js";
export {
  LIFECYCLE_STATES,
  LIFECYCLE_TRANSITIONS,
  PUBLIC_LIFECYCLE_STATES,
  LifecycleTransitionError,
  findTransition,
  canTransition,
  assertTransition,
  availableTransitions,
  deriveLifecycleState,
} from "./lifecycle.js";
export type { LifecycleState, LifecycleActorRole, LifecycleTransition } from "./lifecycle.js";
