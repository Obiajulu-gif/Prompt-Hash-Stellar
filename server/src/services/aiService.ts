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
  /**
   * Redacts sensitive content (like prompts) from logs or error messages.
   */
  private static redact(text: string): string {
    if (!text) return text;
    if (text.length <= 20) return "***";
    return `${text.substring(0, 10)}...[REDACTED]...${text.substring(text.length - 10)}`;
  }

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

    if (!config.ai.providerUrl) {
      throw new AIServiceError("AI service is unconfigured (missing provider URL)", 503);
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
        
        // If it's a client error (4xx) other than 429/408, don't retry
        if (error instanceof AIServiceError && error.status >= 400 && error.status < 500) {
          if (error.status !== 429 && error.status !== 408) {
            throw error;
          }
        }

        const redactedBody = body ? (typeof body === "string" ? this.redact(body) : "[OBJECT]") : "none";
        console.warn(
          `AI Service request failed (attempt ${attempt + 1}/${config.ai.maxRetries + 1}) for ${method} ${path}. Body snippet: ${redactedBody}. Error: ${error instanceof Error ? error.message : String(error)}`
        );
        
        if (attempt === config.ai.maxRetries) {
          break;
        }
        
        // Exponential backoff for retries
        const delay = Math.min(1000 * Math.pow(2, attempt), 5000);
        await new Promise(resolve => setTimeout(resolve, delay));
      }
    }

    throw lastError instanceof AIServiceError 
      ? lastError 
      : new AIServiceError(lastError instanceof Error ? lastError.message : String(lastError));
  }

  public static async improvePrompt(promptText: string): Promise<any> {
    return this.request("/api/improve-prompt", "POST", promptText);
  }

  public static async chat(messages: AiMessage[], model?: string): Promise<any> {
    // Standardize on POST for chat boundary
    return this.request("/api/chat", "POST", { messages, model });
  }

  public static async getModels(): Promise<string[]> {
    try {
      const data = await this.request<{ models: string[] }>("/api/models");
      return data.models;
    } catch (error) {
      console.error("Failed to fetch AI models:", error instanceof Error ? error.message : String(error));
      return ["gemini-2.5-flash", "gemini-2.5-pro", "gemini-2.0-flash"];
    }
  }

  public static async checkHealth(): Promise<boolean> {
    if (!config.ai.enabled || !config.ai.providerUrl) return false;
    try {
      await this.request("/api/health");
      return true;
    } catch {
      return false;
    }
  }
}
