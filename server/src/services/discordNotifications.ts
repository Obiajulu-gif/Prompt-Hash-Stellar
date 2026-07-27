/**
 * discordNotifications.ts — Discord Bot for Marketplace Announcements
 *
 * Service for posting rich embed messages to Discord channels when high-quality
 * prompts are published. Uses Discord webhooks for secure, rate-limited posting.
 *
 * Configuration (env vars):
 *   DISCORD_WEBHOOK_URL - Webhook URL for the announcements channel
 *   DISCORD_RATE_LIMIT_MINUTES - Minimum minutes between announcements (default: 5)
 */

interface PromptData {
  title: string;
  price: number;
  promptId: string;
  category: string;
  description?: string;
  imageUrl?: string;
  creator: string;
}

interface DiscordEmbed {
  title: string;
  description: string;
  url: string;
  color: number;
  fields: Array<{ name: string; value: string; inline: boolean }>;
  image?: { url: string };
  footer: { text: string };
  timestamp: string;
}

interface DiscordWebhookPayload {
  embeds: DiscordEmbed[];
}

// Rate limiting state
let lastAnnouncementTime = 0;
const RATE_LIMIT_MS = 5 * 60 * 1000; // 5 minutes default

/**
 * Check if enough time has passed since the last announcement
 */
function isRateLimited(): boolean {
  const now = Date.now();
  const rateLimitMs = Number(process.env.DISCORD_RATE_LIMIT_MINUTES || 5) * 60 * 1000;
  const timeSinceLastAnnouncement = now - lastAnnouncementTime;
  
  if (timeSinceLastAnnouncement < rateLimitMs) {
    console.log(
      `[discord] Rate limited. ${Math.ceil(
        (rateLimitMs - timeSinceLastAnnouncement) / 1000
      )}s remaining until next announcement`
    );
    return true;
  }
  
  return false;
}

/**
 * Build a rich embed for Discord
 */
function buildDiscordEmbed(prompt: PromptData): DiscordEmbed {
  const appUrl = process.env.APP_URL || "https://prompthash.io";
  const priceXlm = (prompt.price / 10000000).toFixed(2);
  
  return {
    title: `🚀 New Prompt Published: ${prompt.title}`,
    description: prompt.description 
      ? prompt.description.slice(0, 200) + (prompt.description.length > 200 ? "..." : "")
      : "Check out this new AI prompt on PromptHash Stellar!",
    url: `${appUrl}/prompts/${prompt.promptId}`,
    color: 0x00ffff, // Cyan color matching the brand
    fields: [
      {
        name: "💰 Price",
        value: `${priceXlm} XLM`,
        inline: true,
      },
      {
        name: "📂 Category",
        value: prompt.category,
        inline: true,
      },
      {
        name: "👤 Creator",
        value: `\`${prompt.creator.slice(0, 8)}…${prompt.creator.slice(-4)}\``,
        inline: true,
      },
    ],
    image: prompt.imageUrl ? { url: prompt.imageUrl } : undefined,
    footer: {
      text: "PromptHash Stellar Marketplace",
    },
    timestamp: new Date().toISOString(),
  };
}

/**
 * Send a Discord webhook notification
 */
async function sendDiscordWebhook(webhookUrl: string, payload: DiscordWebhookPayload): Promise<void> {
  try {
    const response = await fetch(webhookUrl, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
      },
      body: JSON.stringify(payload),
    });

    if (!response.ok) {
      const errorText = await response.text();
      throw new Error(`Discord webhook failed: ${response.status} ${errorText}`);
    }

    console.log("[discord] Successfully sent announcement to Discord");
  } catch (error) {
    console.error("[discord] Failed to send webhook:", error);
    throw error;
  }
}

/**
 * Announce a new prompt to Discord
 * 
 * @param prompt - Prompt data to announce
 * @param force - Bypass rate limiting (use with caution)
 */
export async function announceNewPrompt(prompt: PromptData, force = false): Promise<void> {
  const webhookUrl = process.env.DISCORD_WEBHOOK_URL;
  
  if (!webhookUrl) {
    console.warn("[discord] DISCORD_WEBHOOK_URL not configured — skipping announcement");
    return;
  }

  // Check rate limit unless forced
  if (!force && isRateLimited()) {
    return;
  }

  try {
    const embed = buildDiscordEmbed(prompt);
    const payload: DiscordWebhookPayload = {
      embeds: [embed],
    };

    await sendDiscordWebhook(webhookUrl, payload);
    lastAnnouncementTime = Date.now();
  } catch (error) {
    console.error("[discord] Failed to announce new prompt:", error);
    // Don't throw - we don't want to fail the prompt creation if Discord is down
  }
}

/**
 * Reset the rate limit timer (useful for testing or manual triggers)
 */
export function resetRateLimit(): void {
  lastAnnouncementTime = 0;
}
