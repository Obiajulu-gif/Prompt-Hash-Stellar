import { config } from "../config";

export interface ChatMessage {
  role: "user" | "assistant" | "ai";
  content: string;
}

export interface AIResponse {
  response?: string;
  Response?: string;
  improved?: string;
  [key: string]: any;
}

export class AIService {
  private static async fetchWithRetry(
    url: string,
    options: RequestInit,
    retries: number = config.ai.maxRetries,
  ): Promise<Response> {
    let lastError: Error | null = null;

    for (let i = 0; i <= retries; i++) {
      const controller = new AbortController();
      const timeoutId = setTimeout(() => controller.abort(), config.ai.timeoutMs);

      try {
        if (i > 0) {
          console.log(`[INFO] Retrying AI request (${i}/${retries})...`);
        }

        const response = await fetch(url, {
          ...options,
          signal: controller.signal,
        });

        clearTimeout(timeoutId);
        return response;
      } catch (err: any) {
        clearTimeout(timeoutId);
        lastError = err;

        if (err.name === "AbortError") {
          console.warn(`[WARNING] AI request timed out after ${config.ai.timeoutMs}ms`);
        } else {
          console.error(`[ERROR] AI request failed: ${err.message}`);
        }

        if (i === retries) break;
        
        // Wait before retry (exponential backoff could be added here)
        await new Promise((resolve) => setTimeout(resolve, 1000 * (i + 1)));
      }
    }

    throw lastError || new Error("Failed to connect to AI provider");
  }

  static async chat(messages: ChatMessage[], model?: string): Promise<AIResponse> {
    if (!config.ai.enabled) {
      throw new Error("AI service is currently disabled");
    }

    console.log(`[INFO] AI Chat request - Messages count: ${messages.length}, Model: ${model || "default"}`);
    // DO NOT log messages content for privacy

    // For now, we support the external gateway's format
    // The gateway expects GET /api/chat?prompt=...&model=...
    // But we want to prefer POST for larger prompts and better security
    
    const lastMessage = messages[messages.length - 1]?.content || "";
    const url = new URL(`${config.ai.providerUrl}/api/chat`);
    url.searchParams.append("prompt", lastMessage);
    if (model) url.searchParams.append("model", model);

    const response = await this.fetchWithRetry(url.toString(), {
      method: "GET", // Current gateway uses GET
      headers: {
        Accept: "application/json",
      },
    });

    if (!response.ok) {
      const errorData = await response.json().catch(() => ({}));
      throw new Error(errorData.error || `AI Provider returned ${response.status}`);
    }

    return await response.json();
  }

  static async improvePrompt(prompt: string): Promise<AIResponse> {
    if (!config.ai.enabled) {
      throw new Error("AI service is currently disabled");
    }

    console.log(`[INFO] AI Improve Prompt request - Content length: ${prompt.length}`);
    // DO NOT log prompt content for privacy

    const response = await this.fetchWithRetry(`${config.ai.providerUrl}/api/improve-prompt`, {
      method: "POST",
      headers: {
        "Content-Type": "text/plain",
        Accept: "application/json",
      },
      body: prompt,
    });

    if (!response.ok) {
      const errorData = await response.json().catch(() => ({}));
      throw new Error(errorData.error || `AI Provider returned ${response.status}`);
    }

    return await response.json();
  }
}
