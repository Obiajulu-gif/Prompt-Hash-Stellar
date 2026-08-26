/**
 * IPFS integration for off-chain storage of large encrypted prompt payloads.
 *
 * - `reference` — pure helpers for the `ipfs://<cid>` reference format.
 * - `gateway`   — fetch ciphertext back from an HTTP gateway (browser + Node).
 * - `upload`    — client-side Pinata upload (browser only).
 *
 * The unlock service should import from `./gateway` directly to avoid pulling in
 * the browser-only upload helpers.
 */
export * from "./reference";
export * from "./gateway";
export * from "./upload";
