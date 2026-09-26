import dotenv from "dotenv";
import mongoose from "mongoose";
import Prompt from "../src/models/Prompt.js";
import User from "../src/models/User.js";

dotenv.config();

const purchaseSchema = new mongoose.Schema({ promptId: { type: String, required: true, index: true }, buyerWallet: { type: String, required: true, lowercase: true, index: true }, versionIndex: { type: Number, required: true }, txHash: { type: String, default: "" }, saved: { type: Boolean, default: false, index: true } }, { timestamps: true });
purchaseSchema.index({ promptId: 1, buyerWallet: 1 });
const Purchase = mongoose.models.Purchase || mongoose.model("Purchase", purchaseSchema);

const PREVIEW_SEED_TAG = "preview-seed-v1";
const blockedEnvironments = new Set(["production", "prod", "mainnet"]);

const creators = [
  {
    walletAddress: "gpreviewcreator000000000000000000000000000000000000000000000001",
    username: "preview-strategist",
    displayName: "Preview Strategist",
    bio: "Synthetic creator profile for preview deployments.",
    avatarUrl: "https://placehold.co/256x256/064e3b/ecfdf5?text=PS",
    socialLinks: { twitter: "", github: "", website: "https://example.com/preview-strategist" },
    rating: 5,
  },
  {
    walletAddress: "gpreviewcreator000000000000000000000000000000000000000000000002",
    username: "demo-automation",
    displayName: "Demo Automation Lab",
    bio: "Builds synthetic automation prompts for reviewer demos.",
    avatarUrl: "https://placehold.co/256x256/1e293b/c7d2fe?text=DA",
    socialLinks: { twitter: "", github: "https://github.com/example", website: "" },
    rating: 4.8,
  },
];

const prompts = [
  {
    onChainId: "preview-seed-launch-plan",
    ownerWallet: creators[0].walletAddress,
    image: "https://placehold.co/1200x675/022c22/a7f3d0?text=Launch+Plan",
    title: "Board-ready Launch Plan",
    content: "SYNTHETIC_ENCRYPTED_PAYLOAD_preview_launch_plan_001",
    description: "Demo listing with public metadata, category, price, and synthetic encrypted payload markers only.",
    tags: [PREVIEW_SEED_TAG, "go-to-market", "strategy"],
    onChainReference: "preview:launch-plan",
    rating: 5,
    price: 12,
    category: "Marketing",
    listingStatus: "published",
    isActive: true,
    salesCount: 7,
    previewCount: 32,
    currentVersionIndex: 1,
  },
  {
    onChainId: "preview-seed-code-review",
    ownerWallet: creators[1].walletAddress,
    image: "https://placehold.co/1200x675/172554/bfdbfe?text=Code+Review",
    title: "Secure Code Review Assistant",
    content: "SYNTHETIC_ENCRYPTED_PAYLOAD_preview_code_review_002",
    description: "Synthetic programming prompt metadata for preview buyers and creator dashboards.",
    tags: [PREVIEW_SEED_TAG, "security", "programming"],
    onChainReference: "preview:code-review",
    rating: 4.7,
    price: 8,
    category: "Programming",
    listingStatus: "published",
    isActive: true,
    salesCount: 3,
    previewCount: 19,
    currentVersionIndex: 1,
  },
];

const purchases = [
  { promptId: "preview-seed-launch-plan", buyerWallet: "gbuyerpreview000000000000000000000000000000000000000000000001", versionIndex: 1, txHash: "preview_tx_launch_001", saved: true },
  { promptId: "preview-seed-code-review", buyerWallet: "gbuyerpreview000000000000000000000000000000000000000000000002", versionIndex: 1, txHash: "preview_tx_code_002", saved: false },
];

function assertPreviewEnvironment() {
  const envName = (process.env.APP_ENV || process.env.VERCEL_ENV || process.env.NODE_ENV || "").toLowerCase();
  const explicitlyAllowed = process.env.ALLOW_PREVIEW_SEED === "true";

  if (blockedEnvironments.has(envName) || (!explicitlyAllowed && envName !== "preview" && envName !== "development")) {
    throw new Error(`Refusing to seed preview data in environment "${envName || "unknown"}". Set APP_ENV=preview and ALLOW_PREVIEW_SEED=true for preview deployments.`);
  }
}

async function main() {
  assertPreviewEnvironment();

  const mongoUri = process.env.MONGODB_URI || process.env.MONGO_URI;
  if (!mongoUri) {
    throw new Error("Missing MONGODB_URI or MONGO_URI.");
  }

  await mongoose.connect(mongoUri);

  const usersByWallet = new Map();
  for (const creator of creators) {
    const user = await User.findOneAndUpdate(
      { walletAddress: creator.walletAddress },
      { $set: creator },
      { upsert: true, new: true, setDefaultsOnInsert: true },
    );
    usersByWallet.set(creator.walletAddress, user);
  }

  for (const prompt of prompts) {
    const owner = usersByWallet.get(prompt.ownerWallet);
    await Prompt.findOneAndUpdate(
      { onChainId: prompt.onChainId },
      { $set: { ...prompt, owner: owner._id } },
      { upsert: true, new: true, setDefaultsOnInsert: true },
    );
  }

  for (const purchase of purchases) {
    await Purchase.findOneAndUpdate(
      { promptId: purchase.promptId, buyerWallet: purchase.buyerWallet },
      { $set: purchase },
      { upsert: true, new: true, setDefaultsOnInsert: true },
    );
  }

  console.log(`Seeded ${creators.length} creators, ${prompts.length} prompts, and ${purchases.length} purchase states for preview.`);
  await mongoose.disconnect();
}

main().catch(async (error) => {
  console.error(error instanceof Error ? error.message : String(error));
  await mongoose.disconnect();
  process.exit(1);
});
