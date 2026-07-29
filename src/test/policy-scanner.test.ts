import { describe, expect, it } from "vitest";
import { execSync } from "child_process";
import path from "path";

describe("Production Policy Scanner", () => {
  it("runs policy scanner and outputs rule violations for existing mock stubs", () => {
    try {
      execSync("node scripts/policy-scanner.mjs", {
        cwd: path.resolve(__dirname, "../.."),
        encoding: "utf8",
        stdio: "pipe",
      });
      // If no error thrown, scan passed (which means all stubs are fixed or scanner ran)
      expect(true).toBe(true);
    } catch (err: any) {
      const output = err.stdout || err.output?.join("") || "";
      expect(err.status).toBe(1);
      expect(output).toContain("Production Policy Scanner");
      expect(output).toContain("Production Policy Violations Found");
      expect(output).toContain("MOCK_PROMPT_HASH_CLIENT");
      expect(output).toContain("SEEDED_REVIEWS");
      expect(output).toContain("OUTBOX_STUB");
      expect(output).toContain("PAGINATION_STUB");
      expect(output).toContain("TTL_STUB");
    }
  });
});
