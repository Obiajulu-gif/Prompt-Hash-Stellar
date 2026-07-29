/**
 * Fixture examples for the prompt metadata schema — kept in lockstep with
 * PROMPT_METADATA_SCHEMA_VERSION. promptMetadata.test.ts fails if this file's
 * version tag drifts from the schema's without a matching update, so any
 * schema change forces a conscious fixture review.
 */
import { PROMPT_METADATA_SCHEMA_VERSION } from "./promptMetadata.js";

export const FIXTURES_SCHEMA_VERSION = PROMPT_METADATA_SCHEMA_VERSION;

export const VALID_PROMPT_METADATA_FIXTURES: unknown[] = [
  {
    title: "Board-ready launch plan",
    description: "A step-by-step go-to-market plan for a B2B SaaS launch.",
    category: "Marketing",
    tags: ["launch", "b2b", "saas"],
    image: "https://example.com/prompt-cover.png",
    price: 2.5,
    licence: "standard",
    status: "published",
  },
  {
    title: "Minimal metadata",
    category: "Other",
    image: "http://example.com/img.png",
    price: "0.5",
  },
];

export const INVALID_PROMPT_METADATA_FIXTURES: { input: unknown; reason: string }[] = [
  {
    input: { title: "ab", category: "Other", image: "https://x.com/i.png", price: 1 },
    reason: "title below minimum length",
  },
  {
    input: { title: "Valid title", category: "Not-A-Category", image: "https://x.com/i.png", price: 1 },
    reason: "category not in the canonical list",
  },
  {
    input: { title: "Valid title", category: "Other", image: "ftp://x.com/i.png", price: 1 },
    reason: "image URL missing http(s) scheme",
  },
  {
    input: { title: "Valid title", category: "Other", image: "https://x.com/i.png", price: 0 },
    reason: "price not greater than the minimum",
  },
  {
    input: {
      title: "Valid title",
      category: "Other",
      image: "https://x.com/i.png",
      price: 1,
      tags: Array.from({ length: 11 }, (_, i) => `tag-${i}`),
    },
    reason: "more than the maximum number of tags",
  },
];
