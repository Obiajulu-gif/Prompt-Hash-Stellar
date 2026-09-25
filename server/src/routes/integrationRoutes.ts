import express, { type Request, type Response } from "express";
import User from "../models/User";
import { API_KEY_SCOPES, type ApiKeyScope } from "../models/ApiKey";
import {
  issueApiKey,
  listApiKeys,
  revokeApiKey,
  rotateApiKey,
} from "../services/apiKeys";
import { requireApiKeyScope, type ApiKeyRequest } from "../middleware/apiKeyAuth";
import { GetPrompts } from "../controllers/controllers";
import {
  GetCreatorSalesAnalytics,
  GetPurchaseTransactions,
} from "../controllers/purchaseControllers";
import { apiKeyManagementLimiter } from "../middleware/rateLimiter";

export const integrationRouter = express.Router();

function ownerWallet(req: Request): string | null {
  const wallet = req.header("x-wallet-address")?.trim().toLowerCase();
  return wallet || null;
}

async function requireExistingOwner(req: Request, res: Response): Promise<string | null> {
  const walletAddress = ownerWallet(req);
  if (!walletAddress) {
    res.status(401).json({ error: "x-wallet-address is required for API key management." });
    return null;
  }

  const user = await User.findOne({ walletAddress }).select("_id").lean();
  if (!user) {
    res.status(404).json({ error: "User account not found." });
    return null;
  }
  return walletAddress;
}

function validScopes(value: unknown): value is ApiKeyScope[] {
  return Array.isArray(value) && value.length > 0 && value.every((scope) =>
    (API_KEY_SCOPES as readonly string[]).includes(scope),
  );
}

integrationRouter.use(apiKeyManagementLimiter);

integrationRouter.post("/keys", async (req, res) => {
  const walletAddress = await requireExistingOwner(req, res);
  if (!walletAddress) return;

  const { name, scopes } = req.body ?? {};
  if (typeof name !== "string" || name.trim().length < 1 || name.trim().length > 80 || !validScopes(scopes)) {
    res.status(400).json({ error: "name and at least one supported scope are required.", scopes: API_KEY_SCOPES });
    return;
  }

  const issued = await issueApiKey({ walletAddress, name, scopes });
  res.status(201).json({ ...issued, warning: "Store this secret now. It will not be shown again." });
});

integrationRouter.get("/keys", async (req, res) => {
  const walletAddress = await requireExistingOwner(req, res);
  if (!walletAddress) return;
  res.json({ keys: await listApiKeys(walletAddress) });
});

integrationRouter.post("/keys/:keyId/rotate", async (req, res) => {
  const walletAddress = await requireExistingOwner(req, res);
  if (!walletAddress) return;
  const replacement = await rotateApiKey(walletAddress, req.params.keyId, req.body?.name);
  if (!replacement) {
    res.status(404).json({ error: "Active API key not found." });
    return;
  }
  res.json({ ...replacement, warning: "Store this secret now. It will not be shown again." });
});

integrationRouter.post("/keys/:keyId/revoke", async (req, res) => {
  const walletAddress = await requireExistingOwner(req, res);
  if (!walletAddress) return;
  const revoked = await revokeApiKey(walletAddress, req.params.keyId);
  if (!revoked) {
    res.status(404).json({ error: "Active API key not found." });
    return;
  }
  res.json({ key: revoked });
});

integrationRouter.get(
  "/listings",
  requireApiKeyScope("listings:read"),
  GetPrompts,
);

integrationRouter.get(
  "/purchases",
  requireApiKeyScope("purchases:read"),
  (req: ApiKeyRequest, res: Response) => {
    req.params.walletAddress = req.apiKey!.walletAddress;
    return GetPurchaseTransactions(req, res);
  },
);

integrationRouter.get(
  "/creator/analytics",
  requireApiKeyScope("creator:manage"),
  (req: ApiKeyRequest, res: Response) => {
    req.params.walletAddress = req.apiKey!.walletAddress;
    return GetCreatorSalesAnalytics(req, res);
  },
);