import { describe, it, expect } from "vitest";
import {
  isLicensePermitted,
  isApprovedException,
  generateDependencyInventory,
  PERMITTED_LICENSES,
} from "../../../scripts/validate-dependencies-and-licenses.mjs";

describe("Dependency & License Inventory Validation (#1097)", () => {
  it("approves permissive open-source licenses", () => {
    const safeLicenses = ["MIT", "Apache-2.0", "BSD-3-Clause", "ISC", "0BSD", "CC0-1.0", "MPL-2.0"];
    for (const lic of safeLicenses) {
      const result = isLicensePermitted(lic);
      expect(result.permitted).toBe(true);
    }
  });

  it("approves dual licenses containing at least one permissive identifier", () => {
    const dual = ["(MIT OR GPL-3.0)", "Apache-2.0 / AGPL-3.0", "(BSD-3-Clause OR Proprietary)"];
    for (const lic of dual) {
      const result = isLicensePermitted(lic);
      expect(result.permitted).toBe(true);
    }
  });

  it("detects and rejects disallowed copyleft and non-commercial licenses", () => {
    const banned = ["GPL-3.0", "AGPL-3.0-only", "SSPL-1.0", "CC-BY-NC-4.0", "EUPL-1.2"];
    for (const lic of banned) {
      const result = isLicensePermitted(lic);
      expect(result.permitted).toBe(false);
    }
  });

  it("identifies documented approved exceptions", () => {
    expect(isApprovedException("@walletconnect/types")).not.toBeNull();
    expect(isApprovedException("@trezor/connect-common")).not.toBeNull();
    expect(isApprovedException("@reown/appkit")).not.toBeNull();
    expect(isApprovedException("@lobstrco/signer-extension-api")).not.toBeNull();
    expect(isApprovedException("unapproved-malicious-package")).toBeNull();
  });

  it("generates a valid, complete machine-readable inventory of workspace dependencies", () => {
    const inventory = generateDependencyInventory();

    expect(inventory).toHaveProperty("generatedAt");
    expect(inventory).toHaveProperty("summary");
    expect(inventory.summary.totalPackages).toBeGreaterThan(100);
    expect(inventory.summary.directCount).toBeGreaterThan(10);
    expect(inventory.summary.status).toBe("compliant");
    expect(inventory.violations).toHaveLength(0);

    // License distribution should track licenses
    expect(inventory.summary.licenseDistribution).toHaveProperty("MIT");
    expect(inventory.summary.licenseDistribution).toHaveProperty("Apache-2.0");
  });
});
