import { chatApiBase } from "./env";

export type AIModel =
  | "gemini-2.5-flash"
  | "gemini-2.5-pro"
  | "gemini-2.0-flash"
  | "gemini-flash-latest"
  | "gemini-pro-latest"
  | "gemini-2.0-flash-exp";

export const MODEL_CONFIG = {
  "gemini-2.5-flash": {
    name: "Gemini 2.5 Flash",
    description: "Fast and versatile multimodal model",
    inputTokenLimit: 1_048_576,
    outputTokenLimit: 65_536,
  },
  "gemini-2.5-pro": {
    name: "Gemini 2.5 Pro",
    description: "Advanced reasoning and analysis capabilities",
    inputTokenLimit: 1_048_576,
    outputTokenLimit: 65_536,
  },
  "gemini-2.0-flash": {
    name: "Gemini 2.0 Flash",
    description: "Fast and efficient multimodal model",
    inputTokenLimit: 1_048_576,
    outputTokenLimit: 8_192,
  },
  "gemini-flash-latest": {
    name: "Gemini Flash Latest",
    description: "Latest release of Gemini Flash",
    inputTokenLimit: 1_048_576,
    outputTokenLimit: 65_536,
  },
  "gemini-pro-latest": {
    name: "Gemini Pro Latest",
    description: "Latest release of Gemini Pro",
    inputTokenLimit: 1_048_576,
    outputTokenLimit: 65_536,
  },
  "gemini-2.0-flash-exp": {
    name: "Gemini 2.0 Flash Experimental",
    description: "Experimental version with latest features",
    inputTokenLimit: 1_048_576,
    outputTokenLimit: 8_192,
  },
};

async function fetchJson<T>(input: string, init?: RequestInit): Promise<T> {
  const response = await fetch(input, init);
  if (!response.ok) {
    const text = await response.text();
    throw new Error(text || `Request failed with status ${response.status}.`);
  }

  return response.json() as Promise<T>;
}

export async function getModels() {
  try {
    return await fetchJson<{ models: string[] }>(`${chatApiBase}/api/models`);
  } catch {
    return {
      models: [
        "gemini-2.5-flash",
        "gemini-2.5-pro",
        "gemini-2.0-flash",
        "gemini-flash-latest",
      ],
    };
  }
}

export async function checkHealth() {
  try {
    const response = await fetch(`${chatApiBase}/api/health`);
    return response.ok;
  } catch {
    return false;
  }
}

export async function getChatResponse(
  prompt: string,
  model: AIModel = "gemini-2.5-flash",
) {
  return fetchJson<unknown>(
    `${chatApiBase}/api/chat?prompt=${encodeURIComponent(prompt)}&model=${model}`,
    {
      method: "GET",
      headers: {
        Accept: "application/json",
      },
    },
  );
}

export function localImprovePrompt(prompt: string) {
  let improved = prompt;

  if (prompt.length < 20) {
    improved = `${prompt} with detailed examples and step-by-step instructions`;
  }

  if (!prompt.includes("?") && prompt.split(" ").length < 5) {
    improved = `Please provide a comprehensive explanation about ${prompt}`;
  }

  if (
    prompt.length > 50 &&
    !prompt.includes("1.") &&
    !prompt.includes("First")
  ) {
    improved = `${prompt}\n\nPlease structure your response with:\n1. Introduction\n2. Main points\n3. Examples\n4. Conclusion`;
  }

  if (improved === prompt) {
    improved = `${prompt}\n\nPlease provide a detailed, well-structured response with examples where appropriate.`;
  }

  return improved;
}

export async function improvePrompt(prompt: string) {
  try {
    const result = await fetchJson<unknown>(`${chatApiBase}/api/improve-prompt`, {
      method: "POST",
      headers: {
        "Content-Type": "text/plain",
        Accept: "application/json",
      },
      body: prompt,
    });

    if (typeof result === "string") {
      return result || localImprovePrompt(prompt);
    }

    if (result && typeof result === "object") {
      const candidate =
        "improved" in result
          ? result.improved
          : "Response" in result
            ? result.Response
            : "response" in result
              ? result.response
              : null;
      return typeof candidate === "string" && candidate.trim()
        ? candidate
        : localImprovePrompt(prompt);
    }

    return localImprovePrompt(prompt);
  } catch {
    return localImprovePrompt(prompt);
  }
}
