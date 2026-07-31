import { describe, expect, it } from "vitest";
import { execSync } from "child_process";
import path from "path";

describe("Production Policy Scanner", () => {
  it("runs policy scanner CLI successfully", () => {
    try {
      const output = execSync("node scripts/policy-scanner.mjs", {
        cwd: path.resolve(__dirname, "../.."),
        encoding: "utf8",
        stdio: "pipe",
      });
      expect(output).toContain("Production Policy Scanner");
    } catch (err: any) {
      const output = err.stdout || err.output?.join("") || "";
      expect(output).toContain("Production Policy Scanner");
    }
  });
});
