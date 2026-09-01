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

    // Extract non-comment, non-blank lines containing .post(
    const lines = content.split("\n").filter(
      (line) => line.trim().startsWith("promptRouter.post(")
    );

    // All POST routes must correspond to non-authoritative operations
    const allowedPostKeywords = [
      "buyer/save",
      "buyer/unsave",
      "preview",
      "reports",
      "integrity-check",
      "similarity/check",
      "transfers",
    ];

    for (const route of lines) {
      const isAllowed = allowedPostKeywords.some((kw) => route.includes(kw));
      expect(isAllowed).toBe(true);
    }
  });

  it("marks GET routes as projection reads", () => {
    const content = fs.readFileSync(promptRoutesPath, "utf-8");

    const getRoutes = [
      "/buyer/:walletAddress/owned",
      "/buyer/:walletAddress/saved",
      "/buyer/:walletAddress/transactions",
      "/creator/:walletAddress/analytics",
      "/creator/:walletAddress/payout-statement",
      "/creator/:walletAddress/drafts",
    ];

    for (const route of getRoutes) {
      expect(content).toContain(`.get("${route}"`);
    }
  });
});
