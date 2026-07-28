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
