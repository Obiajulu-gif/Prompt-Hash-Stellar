import "dotenv/config";
import mongoose from "mongoose";
import { runMigrations } from "./migrationRunner";

async function main() {
  const args = process.argv.slice(2);
  const command = args[0] || "up";
  const targetIndex = args.indexOf("--target");
  const targetVersion = targetIndex !== -1 ? parseInt(args[targetIndex + 1], 10) : undefined;

  if (command !== "up" && command !== "down") {
    console.error("Usage: ts-node migrateCli.ts [up|down] [--target <version>]");
    process.exit(1);
  }

  console.log(`[migration-cli] Running database migrations in direction: ${command.toUpperCase()}${targetVersion !== undefined ? ` (target: ${targetVersion})` : ""}`);

  try {
    await runMigrations(undefined, command, targetVersion);
    console.log("[migration-cli] Completed migrations successfully.");
    await mongoose.disconnect();
    process.exit(0);
  } catch (err) {
    console.error("[migration-cli] Fatal error during migrations:", err);
    try {
      await mongoose.disconnect();
    } catch {}
    process.exit(1);
  }
}

main();
