// API client for interacting with the AI gateway

// Base URL for the API
const API_BASE_URL = "https://secret-ai-gateway.onrender.com";

// Available models
export type AIModel =
	| "gemini-2.5-flash"
	| "gemini-2.5-pro"
	| "gemini-2.0-flash"
	| "gemini-flash-latest"
	| "gemini-pro-latest"
	| "gemini-2.0-flash-exp";

// Model configuration
export const MODEL_CONFIG = {
	"gemini-2.5-flash": {
		name: "Gemini 2.5 Flash",
		description: "Fast and versatile multimodal model",
		inputTokenLimit: 1048576,
		outputTokenLimit: 65536,
	},
	"gemini-2.5-pro": {
		name: "Gemini 2.5 Pro",
		description: "Advanced reasoning and analysis capabilities",
		inputTokenLimit: 1048576,
		outputTokenLimit: 65536,
	},
	"gemini-2.0-flash": {
		name: "Gemini 2.0 Flash",
		description: "Fast and efficient multimodal model",
		inputTokenLimit: 1048576,
		outputTokenLimit: 8192,
	},
	"gemini-flash-latest": {
		name: "Gemini Flash Latest",
		description: "Latest release of Gemini Flash",
		inputTokenLimit: 1048576,
		outputTokenLimit: 65536,
	},
	"gemini-pro-latest": {
		name: "Gemini Pro Latest",
		description: "Latest release of Gemini Pro",
		inputTokenLimit: 1048576,
		outputTokenLimit: 65536,
	},
	"gemini-2.0-flash-exp": {
		name: "Gemini 2.0 Flash Experimental",
		description: "Experimental version with latest features",
		inputTokenLimit: 1048576,
		outputTokenLimit: 8192,
	},
};

// Function to get available models
export async function getModels() {
	try {
		const response = await fetch(`${API_BASE_URL}/api/models`);
		if (!response.ok) {
			throw new Error(`Failed to fetch models: ${response.status}`);
		}
		return await response.json();
	} catch (error) {
		console.error("Error fetching models:", error);
		return {
			models: [
				"gemini-2.5-flash",
				"gemini-2.5-pro",
				"gemini-2.0-flash",
				"gemini-flash-latest",
			],
		}; // Fallback
	}
}

// Function to check API health
export async function checkHealth() {
	try {
		const response = await fetch(`${API_BASE_URL}/api/health`);
		return response.ok;
	} catch (error) {
		console.error("Health check failed:", error);
		return false;
	}
}

// Function to get chat response
export async function getChatResponse(
	prompt: string,
	model: AIModel = "gemini-2.5-flash"
) {
	try {
		const response = await fetch(
			`${API_BASE_URL}/api/chat?prompt=${encodeURIComponent(
				prompt
			)}&model=${model}`,
			{
				method: "GET",
				headers: {
					Accept: "application/json",
				},
			}
		);

		if (!response.ok) {
			throw new Error(`Chat API error: ${response.status}`);
		}

		const data = await response.json();
		return data;
	} catch (error) {
		console.error("Error getting chat response:", error);
		throw error;
	}
}

// Local fallback function to improve prompts if the API fails
export function localImprovePrompt(prompt: string): string {
	// Simple improvements
	let improved = prompt;

	// Add specificity
	if (prompt.length < 20) {
		improved = `${prompt} with detailed examples and step-by-step instructions`;
	}

	// Add clarity for vague prompts
	if (!prompt.includes("?") && prompt.split(" ").length < 5) {
		improved = `Please provide a comprehensive explanation about ${prompt}`;
	}

	// Add structure for longer prompts
	if (
		prompt.length > 50 &&
		!prompt.includes("1.") &&
		!prompt.includes("First")
	) {
		improved = `${prompt}\n\nPlease structure your response with:\n1. Introduction\n2. Main points\n3. Examples\n4. Conclusion`;
	}

	// If we didn't make any improvements, add a generic enhancement
	if (improved === prompt) {
		improved = `${prompt}\n\nPlease provide a detailed, well-structured response with examples where appropriate.`;
	}

	return improved;
}

// Function to improve a prompt
export async function improvePrompt(prompt: string) {
	try {
		// The API expects a string as the body, not a JSON object
		const response = await fetch(`${API_BASE_URL}/api/improve-prompt`, {
			method: "POST",
			headers: {
				"Content-Type": "text/plain", // Changed from application/json
				Accept: "application/json",
			},
			// Send the prompt as a plain string, not a JSON object
			body: prompt,
		});

		if (!response.ok) {
			// Log more details about the error
			const errorText = await response.text();
			console.error(`Improve prompt API error: ${response.status}`, errorText);

			// If the API fails, use our local improvement function
			console.log("Using local prompt improvement fallback");
			return localImprovePrompt(prompt);
		}

		const result = await response.json();

		// If the API returns the same prompt or an empty result, use our local improvement
		if (
			!result ||
			(typeof result === "string" &&
				(result.trim() === prompt.trim() || result.trim() === "")) ||
			(typeof result === "object" &&
				(!result.Response || result.Response.trim() === prompt.trim()))
		) {
			console.log("API returned unchanged prompt, using local improvement");
			return localImprovePrompt(prompt);
		}

		return result;
	} catch (error) {
		console.error("Error improving prompt:", error);
		// Use local improvement as fallback
		return localImprovePrompt(prompt);
	}
}
