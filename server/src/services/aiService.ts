import { config } from "../config";

export interface AiMessage {
  role: "user" | "assistant" | "system";
  content: string;
}

export class AIServiceError extends Error {
  constructor(
    message: string,
    public status: number = 500,
    public details?: unknown
  ) {
    super(message);
    this.name = "AIServiceError";
  }
}

export class AIService {
  private static async fetchWithTimeout(
    url: string,
    options: RequestInit,
    timeoutMs: number = config.ai.timeoutMs
  ): Promise<Response> {
    const controller = new AbortController();
    const id = setTimeout(() => controller.abort(), timeoutMs);

    try {
      const response = await fetch(url, {
        ...options,
        signal: controller.signal,
      });
      clearTimeout(id);
      return response;
    } catch (error: unknown) {
      clearTimeout(id);
      if (error instanceof Error && error.name === "AbortError") {
        throw new AIServiceError("AI Service request timed out", 504);
      }
      throw error;
    }
  }

  private static async request<T>(
    path: string,
    method: string = "GET",
    body?: any
  ): Promise<T> {
    if (!config.ai.enabled) {
      throw new AIServiceError("AI service is currently disabled", 503);
    }

    const url = `${config.ai.providerUrl}${path}`;
    const headers: Record<string, string> = {
      "Accept": "application/json",
    };

    if (config.ai.apiKey) {
      headers["Authorization"] = `Bearer ${config.ai.apiKey}`;
    }

    if (body) {
      headers["Content-Type"] = typeof body === "string" ? "text/plain" : "application/json";
    }

    let lastError: any;
    for (let attempt = 0; attempt <= config.ai.maxRetries; attempt++) {
      try {
        const response = await this.fetchWithTimeout(url, {
          method,
          headers,
          body: body ? (typeof body === "string" ? body : JSON.stringify(body)) : undefined,
        });

        const responseData = await response.json().catch(() => null);

        if (!response.ok) {
          throw new AIServiceError(
            `AI Service responded with status ${response.status}`,
            response.status,
            responseData
          );
        }

        return responseData as T;
      } catch (error) {
        lastError = error;
        if (error instanceof AIServiceError && error.status < 500) {
          throw error;
        }
        console.warn(`AI Service request failed (attempt ${attempt + 1}):`, error);
      }
    }

    throw lastError;
  }

  public static async improvePrompt(promptText: string): Promise<any> {
    return this.request("/api/improve-prompt", "POST", promptText);
  }

  public static async chat(messages: AiMessage[], model?: string): Promise<any> {
    // To maintain compatibility with existing tests/frontend that might use query params
    // we could check if we should use GET or POST. 
    // But let's stick to POST for the service boundary as per modern standards.
    // If we need to support the legacy GET, we can do it here.
    
    // Check if it's a simple one-message chat that could be a GET
    if (messages.length === 1 && messages[0].role === "user") {
      const prompt = messages[0].content;
      return this.request(`/api/chat?prompt=${encodeURIComponent(prompt)}${model ? `&model=${model}` : ""}`, "GET");
    }

    return this.request("/api/chat", "POST", { messages, model });
  }

  public static async getModels(): Promise<string[]> {
    try {
      const data = await this.request<{ models: string[] }>("/api/models");
      return data.models;
    } catch {
      return ["gpt-4o", "gpt-3.5-turbo"];
    }
  }

  public static async checkHealth(): Promise<boolean> {
    if (!config.ai.enabled) return false;
    try {
      await this.request("/api/health");
      return true;
    } catch {
      return false;
    }
  }
}
