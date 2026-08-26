/**
 * Build-time safety check: Fails if any mock-related code appears in production bundles.
 * Prevents accidental production deployments with stubbed contract methods.
 */

import fs from "fs";
import path from "path";

const MOCK_PATTERNS = [
  /warnMockUse/,
  /USING MOCK/,
  /mock_hash_/,
  /tx_mock/,
  /tx_pass_mock/,
  /tx_bundle_mock/,
];

const FILES_TO_CHECK = [
  "src/lib/stellar/promptHashClient.ts",
  "src/lib/stellar/contractMethods.ts",
];

let hasErrors = false;

FILES_TO_CHECK.forEach((file) => {
  const filePath = path.resolve(file);

  if (!fs.existsSync(filePath)) {
    console.warn(`⚠️  File not found: ${file}`);
    return;
  }

  const content = fs.readFileSync(filePath, "utf-8");

  MOCK_PATTERNS.forEach((pattern) => {
    if (pattern.test(content)) {
      console.error(`❌ Mock code detected in ${file}:`);
      console.error(`   Pattern: ${pattern}`);
      hasErrors = true;
    }
  });
});

if (hasErrors) {
  console.error(
    "\n❌ Build failed: Mock implementation detected in production files.",
  );
  console.error(
    "   Ensure all contract methods are using real Soroban transactions.",
  );
  process.exit(1);
}

console.log("✅ No mock code detected in production files.");
process.exit(0);
