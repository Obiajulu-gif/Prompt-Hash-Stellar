import { describe, it, expect } from "vitest";
import fs from "fs";
import path from "path";

describe("Route architecture — read-projection boundary (#543)", () => {
  const promptRoutesPath = path.resolve(__dirname, "../routes/promptRoutes.ts");

  it("does not import any prohibited mutation controllers as real imports", () => {
    const content = fs.readFileSync(promptRoutesPath, "utf-8");

    // Collect all import specifiers from the file.
    const importMatches = content.matchAll(/import\s*\{([^}]+)\}\s*from\s*["']/g);
    const allImports: string[] = [];
    for (const match of importMatches) {
      const specifiers = match[1].split(",").map((s) => s.trim());
      allImports.push(...specifiers);
    }

    // These are authoritative mutation controllers that must not be importable.
    const prohibitedImports = [
      "CreatePrompt",
      "PublishPrompt",
      "ArchivePrompt",
    ];

    for (const name of prohibitedImports) {
      expect(allImports).not.toContain(name);
    }
  });

  it("does not register any POST routes for authoritative mutations", () => {
    const content = fs.readFileSync(promptRoutesPath, "utf-8");

    // Extract the route path from every POST registration (single- or multi-line).
    const postRoutes = [
      ...content.matchAll(/promptRouter\.post\(\s*["'`]([^"'`]+)["'`]/g),
    ].map((m) => m[1] as string);

    // All POST routes must correspond to non-authoritative operations.
    // Adding an entry here requires a conscious decision that the route does
    // not originate authoritative state changes (those belong to the contract).
    const allowedPostRoutes = [
      "/buyer/save",
      "/buyer/unsave",
      "/preview",
      "/reports",
      "/similarity/check", // advisory anti-plagiarism check
      "/admin/integrity-check",
      "/moderation/:promptId/override", // #758 maintainer decision on scanner queue
      "/licensing/update", // #759 license terms are off-chain metadata; purchases snapshot them
      "/transfers/request", // #708 off-chain two-phase handoff
      "/transfers/:transferId/respond",
      "/transfers/:transferId/cancel",
    ];

    for (const route of postRoutes) {
      const isAllowed = allowedPostRoutes.includes(route);
      expect(
        isAllowed,
        `POST ${route} is not in the non-authoritative allowlist`,
      ).toBe(true);
    }
  });

  it("marks GET routes as projection reads", () => {
    const content = fs.readFileSync(promptRoutesPath, "utf-8");

    // Extract the route path from every GET registration (single- or multi-line).
    const getRoutes = [
      ...content.matchAll(/promptRouter\.get\(\s*["'`]([^"'`]+)["'`]/g),
    ].map((m) => m[1] as string);

    const requiredProjectionReads = [
      "/buyer/:walletAddress/owned",
      "/buyer/:walletAddress/saved",
      "/buyer/:walletAddress/transactions",
      "/creator/:walletAddress/analytics",
      "/creator/:walletAddress/payout-statement",
      "/creator/:walletAddress/drafts",
    ];

    for (const route of requiredProjectionReads) {
      expect(
        getRoutes,
        `GET ${route} must be registered as a projection read`,
      ).toContain(route);
    }
  });
});
