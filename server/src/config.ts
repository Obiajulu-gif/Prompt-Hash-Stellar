import dotenv from "dotenv";
import path from "path";

// Load environment variables from .env file
dotenv.config({ path: path.resolve(__dirname, "../../.env") });

export const config = {
  port: process.env.PORT || 5000,
  ai: {
    providerUrl: process.env.AI_PROVIDER_URL || "",
    apiKey: process.env.AI_API_KEY || "",
    timeoutMs: parseInt(process.env.AI_TIMEOUT_MS || "30000", 10),
    maxRetries: parseInt(process.env.AI_MAX_RETRIES || "3", 10),
    enabled: process.env.ENABLE_AI !== "false",
  },
  db: {
    uri: process.env.MONGODB_URI || "mongodb://localhost:27017/prompthash",
  },
};

export function validateConfig() {
  const missingConfigs: string[] = [];

  if (!config.ai.providerUrl && config.ai.enabled) {
    missingConfigs.push("AI_PROVIDER_URL");
  }

  if (missingConfigs.length > 0) {
    console.warn(`[WARNING] Missing configuration: ${missingConfigs.join(", ")}`);
    if (config.ai.enabled) {
      console.warn("[WARNING] AI features might not work correctly.");
    }
  }

  console.log("[INFO] Configuration validated.");
  console.log(`[INFO] AI Provider: ${config.ai.enabled ? config.ai.providerUrl : "DISABLED"}`);
}
