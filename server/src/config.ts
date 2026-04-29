import dotenv from "dotenv";

// Load environment variables from .env file
dotenv.config();

export interface AiConfig {
  providerUrl: string;
  enabled: boolean;
  timeoutMs: number;
  maxRetries: number;
  apiKey?: string;
}

export interface Config {
  port: number;
  mongoUri: string;
  ai: AiConfig;
}

export const config: Config = {
  port: parseInt(process.env.PORT || "5000", 10),
  mongoUri: process.env.MONGO_URI || "mongodb://localhost:27017/prompthash",
  ai: {
    providerUrl: process.env.AI_PROVIDER_URL || "",
    enabled: process.env.ENABLE_AI !== "false",
    timeoutMs: parseInt(process.env.AI_TIMEOUT_MS || "30000", 10),
    maxRetries: parseInt(process.env.AI_MAX_RETRIES || "3", 10),
    apiKey: process.env.AI_API_KEY,
  },
};

export const validateConfig = () => {
  if (config.ai.enabled && !config.ai.providerUrl) {
    console.warn("WARNING: AI service is enabled but AI_PROVIDER_URL is not configured.");
    // We don't throw here to allow the server to start, but the service will throw 503 on use.
  }
};

export default config;
