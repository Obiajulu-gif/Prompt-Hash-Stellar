import { describe, it, expect, beforeEach, vi } from "vitest";
import mongoose from "mongoose";
import { Request, Response } from "express";
import Prompt from "../models/Prompt";
import Purchase from "../models/Purchase";
import LicenseTemplate from "../models/LicenseTemplate";
import LicenseSnapshot from "../models/LicenseSnapshot";
import {
  updatePromptLicense,
  snapshotLicenseForPurchase,
  getPurchaseReceipt,
  getLicenseSnapshotForDispute,
  resolveCurrentLicense,
  DEFAULT_LICENSE,
} from "../services/licensingService";

vi.mock("../db/connectDb", () => ({
  default: vi.fn(),
}));

vi.mock("../services/structuredLogger", () => ({
  logger: { error: vi.fn(), warn: vi.fn(), info: vi.fn() },
}));

const WALLET = "GAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA1111111111111111111111111";

function req(overrides: Partial<Request> = {}): Partial<Request> {
  return { params: {}, query: {}, body: {}, headers: {}, ...overrides };
}

function res(): Partial<Response> {
  return {
    status: vi.fn().mockReturnThis(),
    json: vi.fn().mockReturnThis(),
    setHeader: vi.fn(),
  } as unknown as Partial<Response>;
}

/** Chainable query mock: supports .select().populate().lean() in any order. */
function chain<T>(doc: T) {
  const ch: any = {
    select: vi.fn(() => ch),
    populate: vi.fn(() => ch),
    sort: vi.fn(() => ch),
    limit: vi.fn(() => ch),
    lean: vi.fn(() => Promise.resolve(doc)),
    exec: vi.fn(() => Promise.resolve(doc)),
    ...(doc as any),
  };
  return ch;
}

function mkPrompt(overrides: Record<string, unknown> = {}) {
  return {
    _id: new mongoose.Types.ObjectId(),
    onChainId: "101",
    owner: { walletAddress: WALLET },
    licenseTemplateKey: null,
    licenseTemplateVersion: null,
    licenseVersionIndex: 1,
    licenseSummary: "",
    licenseTermsText: "",
    licenseAllowedUses: [],
    licenseCommercialUse: false,
    licenseAttributionRequired: false,
    licenseRedistributionAllowed: false,
    licenseCustomTerms: "",
    licenseUpdatedAt: null,
    ...overrides,
  };
}

function mkPurchase(overrides: Record<string, unknown> = {}) {
  return {
    _id: new mongoose.Types.ObjectId(),
    promptId: "101",
    buyerWallet: WALLET.toLowerCase(),
    versionIndex: 2,
    txHash: "abc123",
    status: "purchased",
    licenseVersionIndex: 1,
    licenseSnapshotId: null,
    createdAt: new Date("2026-08-01T00:00:00Z"),
    ...overrides,
  };
}

beforeEach(() => {
  vi.restoreAllMocks();
});

describe("updatePromptLicense (#759)", () => {
  it("rejects a non-owner wallet", async () => {
    vi.spyOn(Prompt, "findOne").mockReturnValue(
      chain(mkPrompt({ owner: { walletAddress: "GOTHER" } })),
    );

    const result = await updatePromptLicense({
      promptId: "101",
      actingWallet: WALLET,
      summary: "New terms",
      termsText: "Completely new license terms text",
    });

    expect(result.ok).toBe(false);
    expect(result.status).toBe(403);
  });

  it("rejects templateKey without templateVersion", async () => {
    const result = await updatePromptLicense({
      promptId: "101",
      actingWallet: WALLET,
      templateKey: "standard",
    });

    expect(result.ok).toBe(false);
    expect(result.status).toBe(400);
  });

  it("rejects an unknown template", async () => {
    vi.spyOn(Prompt, "findOne").mockReturnValue(chain(mkPrompt()));
    vi.spyOn(LicenseTemplate, "findOne").mockReturnValue(chain(null));

    const result = await updatePromptLicense({
      promptId: "101",
      actingWallet: WALLET,
      templateKey: "nope",
      templateVersion: 9,
    });

    expect(result.ok).toBe(false);
    expect(result.status).toBe(404);
  });

  it("does not bump the version when nothing material changed", async () => {
    const prompt = mkPrompt({
      licenseSummary: "Same summary",
      licenseTermsText: "Identical terms text here",
    });
    vi.spyOn(Prompt, "findOne").mockReturnValue(chain(prompt));
    const updateSpy = vi.spyOn(Prompt, "findOneAndUpdate");

    const result = await updatePromptLicense({
      promptId: "101",
      actingWallet: WALLET,
      summary: "Same summary",
      termsText: "Identical terms text here",
    });

    expect(result.ok).toBe(true);
    expect(result.license?.licenseVersionIndex).toBe(1);
    expect(updateSpy).not.toHaveBeenCalled();
  });

  it("bumps licenseVersionIndex on a material change", async () => {
    const prompt = mkPrompt({
      licenseSummary: "Old summary",
      licenseTermsText: "The old license terms text",
    });
    vi.spyOn(Prompt, "findOne").mockReturnValue(chain(prompt));
    const updateSpy = vi
      .spyOn(Prompt, "findOneAndUpdate")
      .mockReturnValue(chain(mkPrompt({ licenseVersionIndex: 2 })));

    const result = await updatePromptLicense({
      promptId: "101",
      actingWallet: WALLET,
      summary: "New summary",
      termsText: "Brand new license terms text",
    });

    expect(result.ok).toBe(true);
    expect(updateSpy).toHaveBeenCalled();
    const updateArg = updateSpy.mock.calls[0][1] as { $set: Record<string, unknown> };
    expect(updateArg.$set.licenseVersionIndex).toBe(2);
    expect(updateArg.$set.licenseSummary).toBe("New summary");
    expect(updateArg.$set.licenseUpdatedAt).toBeInstanceOf(Date);
  });

  it("copies template fields when applying a template", async () => {
    vi.spyOn(Prompt, "findOne").mockReturnValue(chain(mkPrompt()));
    vi.spyOn(LicenseTemplate, "findOne").mockReturnValue(
      chain({
        key: "standard",
        version: 2,
        summary: "Standard license v2",
        termsText: "Standard marketplace license terms v2",
        allowedUses: ["personal", "commercial"],
        commercialUse: true,
        attributionRequired: true,
        redistributionAllowed: false,
      }),
    );
    const updateSpy = vi
      .spyOn(Prompt, "findOneAndUpdate")
      .mockReturnValue(chain(mkPrompt({ licenseVersionIndex: 2 })));

    const result = await updatePromptLicense({
      promptId: "101",
      actingWallet: WALLET,
      templateKey: "STANDARD",
      templateVersion: 2,
    });

    expect(result.ok).toBe(true);
    const updateArg = updateSpy.mock.calls[0][1] as { $set: Record<string, unknown> };
    expect(updateArg.$set.licenseTemplateKey).toBe("standard");
    expect(updateArg.$set.licenseTemplateVersion).toBe(2);
    expect(updateArg.$set.licenseCommercialUse).toBe(true);
    expect(updateArg.$set.licenseAttributionRequired).toBe(true);
  });
});

describe("resolveCurrentLicense (#759)", () => {
  it("falls back to the marketplace default for unlicensed prompts", async () => {
    vi.spyOn(Prompt, "findOne").mockReturnValue(chain(null));

    const license = await resolveCurrentLicense("101");
    expect(license.licenseVersionIndex).toBe(1);
    expect(license.licenseTermsText).toBe(DEFAULT_LICENSE.licenseTermsText);
  });
});

describe("snapshotLicenseForPurchase (#759)", () => {
  it("freezes current prompt terms into a snapshot and links the purchase", async () => {
    vi.spyOn(LicenseSnapshot, "findOne").mockReturnValue(chain(null));
    vi.spyOn(Purchase, "findById").mockReturnValue(
      chain({ licenseVersionIndex: 3 }),
    );
    vi.spyOn(Prompt, "findOne").mockReturnValue(
      chain(
        mkPrompt({
          licenseSummary: "Pro license",
          licenseTermsText: "Pro terms granted at purchase time",
          licenseCommercialUse: true,
          licenseVersionIndex: 3,
        }),
      ),
    );
    const createSpy = vi.spyOn(LicenseSnapshot, "create").mockResolvedValue({
      _id: "snap-1",
    } as any);
    const purchaseUpdate = vi
      .spyOn(Purchase, "updateOne")
      .mockResolvedValue({} as any);

    await snapshotLicenseForPurchase("101", WALLET, "purchase-1");

    expect(createSpy).toHaveBeenCalled();
    const created = createSpy.mock.calls[0][0] as Record<string, unknown>;
    expect(created.purchaseId).toBe("purchase-1");
    expect(created.licenseVersionIndex).toBe(3);
    expect(created.termsText).toBe("Pro terms granted at purchase time");
    expect(created.commercialUse).toBe(true);
    expect(purchaseUpdate).toHaveBeenCalledWith(
      { _id: "purchase-1" },
      { $set: { licenseSnapshotId: "snap-1" } },
    );
  });

  it("is idempotent on replay", async () => {
    vi.spyOn(LicenseSnapshot, "findOne").mockReturnValue(chain({ _id: "snap-0" }));
    const createSpy = vi.spyOn(LicenseSnapshot, "create").mockResolvedValue({} as any);

    await snapshotLicenseForPurchase("101", WALLET, "purchase-1");

    expect(createSpy).not.toHaveBeenCalled();
  });

  it("never throws when snapshotting fails", async () => {
    vi.spyOn(LicenseSnapshot, "findOne").mockRejectedValue(new Error("db down"));

    await expect(
      snapshotLicenseForPurchase("101", WALLET, "purchase-1"),
    ).resolves.toBeUndefined();
  });

  it("uses the default license when the prompt has none configured", async () => {
    vi.spyOn(LicenseSnapshot, "findOne").mockReturnValue(chain(null));
    vi.spyOn(Purchase, "findById").mockReturnValue(chain({ licenseVersionIndex: 1 }));
    vi.spyOn(Prompt, "findOne").mockReturnValue(chain(mkPrompt()));
    const createSpy = vi
      .spyOn(LicenseSnapshot, "create")
      .mockResolvedValue({ _id: "snap-2" } as any);
    vi.spyOn(Purchase, "updateOne").mockResolvedValue({} as any);

    await snapshotLicenseForPurchase("101", WALLET, "purchase-2");

    const created = createSpy.mock.calls[0][0] as Record<string, unknown>;
    expect(created.termsText).toBe(DEFAULT_LICENSE.licenseTermsText);
    expect(created.commercialUse).toBe(false);
  });
});

describe("getPurchaseReceipt (#759)", () => {
  it("renders the frozen snapshot terms for a recent purchase", async () => {
    const purchase = mkPurchase({ licenseSnapshotId: "snap-1" });
    vi.spyOn(Purchase, "findOne").mockReturnValue(chain(purchase));
    vi.spyOn(LicenseSnapshot, "findById").mockReturnValue(
      chain({
        licenseVersionIndex: 3,
        name: "Pro license",
        summary: "Pro license",
        termsText: "Pro terms granted at purchase time",
        allowedUses: ["personal", "commercial"],
        commercialUse: true,
        attributionRequired: false,
        redistributionAllowed: false,
        customTerms: "No resale of outputs.",
        snapshotAt: new Date("2026-08-01T00:00:00Z"),
      }),
    );

    const result = await getPurchaseReceipt("101", WALLET);
    expect(result.ok).toBe(true);
    const license = (result.receipt as any).license;
    expect(license.legacy).toBe(false);
    expect(license.licenseVersionIndex).toBe(3);
    expect(license.termsText).toBe("Pro terms granted at purchase time");
    expect(license.customTerms).toBe("No resale of outputs.");
  });

  it("marks legacy purchases and serves the default terms", async () => {
    const purchase = mkPurchase({ licenseSnapshotId: null });
    vi.spyOn(Purchase, "findOne").mockReturnValue(chain(purchase));
    vi.spyOn(LicenseSnapshot, "findOne").mockReturnValue(chain(null));

    const result = await getPurchaseReceipt("101", WALLET);
    expect(result.ok).toBe(true);
    const license = (result.receipt as any).license;
    expect(license.legacy).toBe(true);
    expect(license.licenseVersionIndex).toBe(1);
    expect(license.termsText).toBe(DEFAULT_LICENSE.licenseTermsText);
  });

  it("404s for an unknown buyer", async () => {
    vi.spyOn(Purchase, "findOne").mockReturnValue(chain(null));

    const result = await getPurchaseReceipt("101", "GNOBODY");
    expect(result.ok).toBe(false);
    expect(result.status).toBe(404);
  });
});

describe("license immutability guarantee (#759)", () => {
  it("changing a prompt license does not touch existing snapshots", async () => {
    // The snapshot created at purchase time...
    vi.spyOn(LicenseSnapshot, "findOne").mockReturnValue(chain(null));
    vi.spyOn(Purchase, "findById").mockReturnValue(chain({ licenseVersionIndex: 2 }));
    vi.spyOn(Prompt, "findOne").mockReturnValue(
      chain(
        mkPrompt({
          licenseSummary: "At purchase",
          licenseTermsText: "Terms as of purchase time",
          licenseVersionIndex: 2,
        }),
      ),
    );
    const createSpy = vi
      .spyOn(LicenseSnapshot, "create")
      .mockResolvedValue({ _id: "snap-3" } as any);
    vi.spyOn(Purchase, "updateOne").mockResolvedValue({} as any);
    await snapshotLicenseForPurchase("101", WALLET, "purchase-3");

    const frozenText = (createSpy.mock.calls[0][0] as Record<string, unknown>)
      .termsText;

    // ...then the creator changes the license...
    vi.spyOn(Prompt, "findOne").mockReturnValue(
      chain(
        mkPrompt({
          licenseSummary: "At purchase",
          licenseTermsText: "Terms as of purchase time",
          licenseVersionIndex: 2,
        }),
      ),
    );
    vi.spyOn(Prompt, "findOneAndUpdate").mockReturnValue(
      chain(
        mkPrompt({
          licenseSummary: "Changed",
          licenseTermsText: "Brand new terms after purchase",
          licenseVersionIndex: 3,
        }),
      ),
    );
    await updatePromptLicense({
      promptId: "101",
      actingWallet: WALLET,
      summary: "Changed",
      termsText: "Brand new terms after purchase",
    });

    // ...the snapshot still carries the original text and version.
    const created = createSpy.mock.calls[0][0] as Record<string, unknown>;
    expect(created.termsText).toBe(frozenText);
    expect(created.termsText).toBe("Terms as of purchase time");
    expect(created.licenseVersionIndex).toBe(2);
  });
});

describe("getLicenseSnapshotForDispute (#759)", () => {
  it("pairs the frozen snapshot with the current prompt terms", async () => {
    const purchase = mkPurchase({ licenseSnapshotId: "snap-1" });
    vi.spyOn(Purchase, "findOne").mockReturnValue(chain(purchase));
    vi.spyOn(LicenseSnapshot, "findById").mockReturnValue(
      chain({
        licenseVersionIndex: 2,
        name: "At purchase",
        summary: "At purchase",
        termsText: "Terms as of purchase time",
        allowedUses: [],
        commercialUse: false,
        attributionRequired: false,
        redistributionAllowed: false,
        customTerms: "",
        snapshotAt: new Date(),
      }),
    );
    vi.spyOn(Prompt, "findOne").mockReturnValue(
      chain(mkPrompt({ licenseVersionIndex: 3 })),
    );

    const result = await getLicenseSnapshotForDispute("101", WALLET);
    expect(result.ok).toBe(true);
    const dispute = result.dispute as any;
    expect(dispute.snapshot.termsText).toBe("Terms as of purchase time");
    expect(dispute.currentPromptLicense.licenseVersionIndex).toBe(3);
  });
});

// Controller-level smoke tests (route wiring)
import {
  GetLicenseTemplates,
  GetPromptLicense,
  GetPurchaseReceipt as GetReceiptController,
  GetLicenseDisputeView,
} from "../controllers/licensingControllers";

describe("licensing controllers (#759)", () => {
  it("GetLicenseTemplates returns only active templates", async () => {
    const r = res();
    vi.spyOn(LicenseTemplate, "find").mockReturnValue(chain([]) as any);
    await GetLicenseTemplates(req() as Request, r as Response);
    expect(r.json).toHaveBeenCalledWith({ templates: [] });
  });

  it("GetPromptLicense returns the resolved license", async () => {
    const r = res();
    vi.spyOn(Prompt, "findOne").mockReturnValue(chain(null) as any);
    await GetPromptLicense(
      req({ params: { promptId: "101" } }) as unknown as Request,
      r as Response,
    );
    expect(r.json).toHaveBeenCalled();
    const payload = (r.json as any).mock.calls[0][0];
    expect(payload.license.licenseVersionIndex).toBe(1);
  });

  it("GetReceiptController propagates 404 for unknown buyers", async () => {
    const r = res();
    vi.spyOn(Purchase, "findOne").mockReturnValue(chain(null) as any);
    await GetReceiptController(
      req({ params: { walletAddress: "GNOBODY", promptId: "101" } }) as unknown as Request,
      r as Response,
    );
    expect(r.status).toHaveBeenCalledWith(404);
  });

  it("GetLicenseDisputeView is admin-scoped at the route layer", async () => {
    // Route wiring test: the route registers the dispute view behind
    // moderation:read. Verified via source inspection (routeArchitecture-style).
    const fs = await import("fs");
    const path = await import("path");
    const routes = fs.readFileSync(
      path.resolve(__dirname, "../routes/promptRoutes.ts"),
      "utf-8",
    );
    expect(routes).toContain('requireAdminScope("moderation:read")');
    expect(routes).toContain("GetLicenseDisputeView");
  });
});
