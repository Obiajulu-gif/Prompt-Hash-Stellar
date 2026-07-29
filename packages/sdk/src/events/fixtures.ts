/**
 * Golden fixtures — Issue #424 (scoped slice).
 *
 * One fixture per event schema in `schema.ts`. Each fixture's `raw` shape
 * matches what `scValToNative(event.value)` produces for that event today
 * (address/option fields as strings, wide integers as `bigint`), and
 * `expected` is what `decodeEvent` must return for it. These are meant to
 * be imported by the SDK's own tests here, and — per acceptance criterion 3
 * ("golden fixtures decode identically in the indexer, SDK, and frontend")
 * — by indexer/frontend test suites once they adopt this decoder; that
 * adoption is left as follow-up (see docs/event-versioning.md).
 */
import type { DecodedEvent } from "./decode.js";

const ADDR_A = "GAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAWHF";
const ADDR_B = "GBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBEUY";
const ADDR_C = "GCCCCCCCCCCCCCCCCCCCCCCCCCCCCCCCCCCCCCCCCCCCCCCCCCCCC5AU";
const HASHED_CODE = new Uint8Array(32).fill(7);

export interface EventFixture {
  type: string;
  raw: Record<string, unknown>;
  expected: DecodedEvent;
}

export const EVENT_FIXTURES: EventFixture[] = [
  {
    type: "PromptCreated",
    raw: { prompt_id: 42n, creator: ADDR_A, price_stroops: 5_000_0000000n, asset: ADDR_B },
    expected: {
      recognized: true,
      type: "PromptCreated",
      version: 1,
      data: { prompt_id: 42n, creator: ADDR_A, price_stroops: 5_000_0000000n, asset: ADDR_B },
    },
  },
  {
    type: "PromptSaleStatusUpdated",
    raw: { prompt_id: 42n, active: false },
    expected: {
      recognized: true,
      type: "PromptSaleStatusUpdated",
      version: 1,
      data: { prompt_id: 42n, active: false },
    },
  },
  {
    type: "PromptAdminModerated",
    raw: { prompt_id: 42n, admin: ADDR_C, active: false },
    expected: {
      recognized: true,
      type: "PromptAdminModerated",
      version: 1,
      data: { prompt_id: 42n, admin: ADDR_C, active: false },
    },
  },
  {
    type: "PromptPriceUpdated",
    raw: { prompt_id: 42n, price_stroops: 6_000_0000000n },
    expected: {
      recognized: true,
      type: "PromptPriceUpdated",
      version: 1,
      data: { prompt_id: 42n, price_stroops: 6_000_0000000n },
    },
  },
  {
    type: "PromptPurchased",
    raw: {
      prompt_id: 42n,
      buyer: ADDR_B,
      creator: ADDR_A,
      price_stroops: 5_000_0000000n,
      referrer: undefined,
    },
    expected: {
      recognized: true,
      type: "PromptPurchased",
      version: 1,
      data: {
        prompt_id: 42n,
        buyer: ADDR_B,
        creator: ADDR_A,
        price_stroops: 5_000_0000000n,
        referrer: undefined,
      },
    },
  },
  {
    type: "LicenseTransferred",
    raw: {
      prompt_id: 42n,
      seller: ADDR_B,
      buyer: ADDR_C,
      creator: ADDR_A,
      resale_price: 3_000_0000000n,
      royalty_amount: 300_0000000n,
    },
    expected: {
      recognized: true,
      type: "LicenseTransferred",
      version: 1,
      data: {
        prompt_id: 42n,
        seller: ADDR_B,
        buyer: ADDR_C,
        creator: ADDR_A,
        resale_price: 3_000_0000000n,
        royalty_amount: 300_0000000n,
      },
    },
  },
  {
    type: "PromptTipped",
    raw: { prompt_id: 42n, buyer: ADDR_B, amount_tipped: 100_0000000n },
    expected: {
      recognized: true,
      type: "PromptTipped",
      version: 1,
      data: { prompt_id: 42n, buyer: ADDR_B, amount_tipped: 100_0000000n },
    },
  },
  {
    type: "VoucherAdded",
    raw: { prompt_id: 42n, hashed_code: HASHED_CODE, discount_bps: 1000 },
    expected: {
      recognized: true,
      type: "VoucherAdded",
      version: 1,
      data: { prompt_id: 42n, hashed_code: HASHED_CODE, discount_bps: 1000 },
    },
  },
  {
    type: "VoucherRemoved",
    raw: { prompt_id: 42n, hashed_code: HASHED_CODE },
    expected: {
      recognized: true,
      type: "VoucherRemoved",
      version: 1,
      data: { prompt_id: 42n, hashed_code: HASHED_CODE },
    },
  },
  {
    type: "ContractPausedStateChanged",
    raw: { is_paused: true },
    expected: {
      recognized: true,
      type: "ContractPausedStateChanged",
      version: 1,
      data: { is_paused: true },
    },
  },
  {
    type: "FeeUpdated",
    raw: { new_fee_percentage: 250 },
    expected: {
      recognized: true,
      type: "FeeUpdated",
      version: 1,
      data: { new_fee_percentage: 250 },
    },
  },
  {
    type: "FeeWalletUpdated",
    raw: { new_fee_wallet: ADDR_A },
    expected: {
      recognized: true,
      type: "FeeWalletUpdated",
      version: 1,
      data: { new_fee_wallet: ADDR_A },
    },
  },
  {
    type: "PlatformFeeUpdated",
    raw: { old_fee: 250, new_fee: 300, admin: ADDR_A },
    expected: {
      recognized: true,
      type: "PlatformFeeUpdated",
      version: 1,
      data: { old_fee: 250, new_fee: 300, admin: ADDR_A },
    },
  },
  {
    type: "ListingExtended",
    raw: { prompt_id: 42n, new_expires_at: 1_800_000_000n },
    expected: {
      recognized: true,
      type: "ListingExtended",
      version: 1,
      data: { prompt_id: 42n, new_expires_at: 1_800_000_000n },
    },
  },
  {
    type: "ListingRevised",
    raw: { prompt_id: 42n, new_revision: 2 },
    expected: {
      recognized: true,
      type: "ListingRevised",
      version: 1,
      data: { prompt_id: 42n, new_revision: 2 },
    },
  },
  {
    type: "SplitsUpdated",
    raw: { prompt_id: 42n },
    expected: {
      recognized: true,
      type: "SplitsUpdated",
      version: 1,
      data: { prompt_id: 42n },
    },
  },
  {
    type: "DisputeOpened",
    raw: { prompt_id: 42n, buyer: ADDR_B },
    expected: {
      recognized: true,
      type: "DisputeOpened",
      version: 1,
      data: { prompt_id: 42n, buyer: ADDR_B },
    },
  },
  {
    type: "DisputeResolved",
    raw: { prompt_id: 42n, buyer: ADDR_B, refunded: true },
    expected: {
      recognized: true,
      type: "DisputeResolved",
      version: 1,
      data: { prompt_id: 42n, buyer: ADDR_B, refunded: true },
    },
  },
  {
    type: "BundleCreated",
    raw: { bundle_id: 7n, creator: ADDR_A, price_stroops: 9_000_0000000n },
    expected: {
      recognized: true,
      type: "BundleCreated",
      version: 1,
      data: { bundle_id: 7n, creator: ADDR_A, price_stroops: 9_000_0000000n },
    },
  },
  {
    type: "BundlePurchased",
    raw: {
      bundle_id: 7n,
      buyer: ADDR_B,
      creator: ADDR_A,
      price_stroops: 9_000_0000000n,
      prompt_ids: [1n, 2n, 3n],
    },
    expected: {
      recognized: true,
      type: "BundlePurchased",
      version: 1,
      data: {
        bundle_id: 7n,
        buyer: ADDR_B,
        creator: ADDR_A,
        price_stroops: 9_000_0000000n,
        prompt_ids: [1n, 2n, 3n],
      },
    },
  },
  {
    type: "AccessPassCreated",
    raw: { pass_id: 3n, creator: ADDR_A, duration_secs: 2_592_000n, price_stroops: 2_000_0000000n },
    expected: {
      recognized: true,
      type: "AccessPassCreated",
      version: 1,
      data: { pass_id: 3n, creator: ADDR_A, duration_secs: 2_592_000n, price_stroops: 2_000_0000000n },
    },
  },
  {
    type: "AccessPassPurchased",
    raw: { pass_id: 3n, buyer: ADDR_B, creator: ADDR_A, expires_at: 1_900_000_000n },
    expected: {
      recognized: true,
      type: "AccessPassPurchased",
      version: 1,
      data: { pass_id: 3n, buyer: ADDR_B, creator: ADDR_A, expires_at: 1_900_000_000n },
    },
  },
  {
    type: "ContractUpgraded",
    raw: { old_wasm_hash: HASHED_CODE, new_wasm_hash: HASHED_CODE, admin: ADDR_C },
    expected: {
      recognized: true,
      type: "ContractUpgraded",
      version: 1,
      data: { old_wasm_hash: HASHED_CODE, new_wasm_hash: HASHED_CODE, admin: ADDR_C },
    },
  },
  {
    type: "PromptCreated",
    raw: { prompt_id: 100n, creator: ADDR_A, price_stroops: 10_000_0000000n, asset: ADDR_B, version: 2 },
    expected: {
      recognized: true,
      type: "PromptCreated",
      version: 2,
      data: { prompt_id: 100n, creator: ADDR_A, price_stroops: 10_000_0000000n, asset: ADDR_B, version: 2 },
    },
  },
  {
    type: "PromptPurchased",
    raw: { prompt_id: 100n, buyer: ADDR_B, creator: ADDR_A, price_stroops: 10_000_0000000n, referrer: undefined, version: 2 },
    expected: {
      recognized: true,
      type: "PromptPurchased",
      version: 2,
      data: { prompt_id: 100n, buyer: ADDR_B, creator: ADDR_A, price_stroops: 10_000_0000000n, referrer: undefined, version: 2 },
    },
  },
  {
    type: "ContractUpgraded",
    raw: { old_wasm_hash: HASHED_CODE, new_wasm_hash: HASHED_CODE, admin: ADDR_C, version: 2 },
    expected: {
      recognized: true,
      type: "ContractUpgraded",
      version: 2,
      data: { old_wasm_hash: HASHED_CODE, new_wasm_hash: HASHED_CODE, admin: ADDR_C, version: 2 },
    },
  },
];

