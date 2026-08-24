/**
 * emailNotifications.ts — Issue #112 / #426
 *
 * Email notification service for PromptPurchased and PromptUpdated events.
 * Uses nodemailer with any SMTP provider (SendGrid, Postmark, SES, etc.).
 * Users opt-in/out per notification type via User model preferences.
 *
 * Configuration (env vars):
 *   SMTP_HOST, SMTP_PORT, SMTP_USER, SMTP_PASS  (preferred)
 *   EMAIL_SMTP_HOST, etc. (legacy fallback)
 *   EMAIL_FROM_ADDRESS (e.g. "PromptHash <noreply@prompthash.io>")
 *   APP_URL (for links in emails, defaults to https://prompthash.io)
 */

import nodemailer from "nodemailer";
import User from "../models/User.js";

// ── Types ──────────────────────────────────────────────────────────────────────

export type NotificationEvent = "PromptPurchased" | "PromptUpdated";

export interface PurchasePayload {
  buyerWallet: string;
  promptTitle: string;
  promptId: string;
  txHash?: string;
}

export interface UpdatePayload {
  ownerWallet: string;
  promptTitle: string;
  promptId: string;
  versionIndex: number;
}

// ── Transport ─────────────────────────────────────────────────────────────────

function createTransport() {
  const host = process.env.SMTP_HOST ?? process.env.EMAIL_SMTP_HOST;
  const port = Number(process.env.SMTP_PORT ?? process.env.EMAIL_SMTP_PORT ?? 587);
  const user = process.env.SMTP_USER ?? process.env.EMAIL_SMTP_USER;
  const pass = process.env.SMTP_PASS ?? process.env.EMAIL_SMTP_PASS;

  return nodemailer.createTransport({
    host,
    port,
    secure: port === 465,
    auth: user && pass ? { user, pass } : undefined,
  });
}

const FROM = process.env.EMAIL_FROM_ADDRESS ?? "PromptHash <noreply@prompthash.io>";

// ── Template builders ─────────────────────────────────────────────────────────

function buildPurchaseEmail(payload: PurchasePayload): { subject: string; html: string } {
  return {
    subject: `🎉 Your prompt "${payload.promptTitle}" was purchased`,
    html: `
      <h2>Congratulations!</h2>
      <p>A buyer (<code>${payload.buyerWallet.slice(0, 8)}…</code>) just purchased
         your prompt <strong>${payload.promptTitle}</strong>.</p>
      ${payload.txHash ? `<p>Transaction: <code>${payload.txHash}</code></p>` : ""}
      <p><a href="${process.env.APP_URL ?? "https://prompthash.io"}/prompts/${payload.promptId}">
        View prompt
      </a></p>
      <hr/>
      <small>To manage your notification preferences visit your account settings.</small>
    `,
  };
}

function buildUpdateEmail(payload: UpdatePayload): { subject: string; html: string } {
  return {
    subject: `📦 Prompt updated: "${payload.promptTitle}" (v${payload.versionIndex + 1})`,
    html: `
      <h2>Prompt Updated</h2>
      <p>The prompt <strong>${payload.promptTitle}</strong> you purchased has been updated
         to version ${payload.versionIndex + 1}.</p>
      <p><a href="${process.env.APP_URL ?? "https://prompthash.io"}/prompts/${payload.promptId}">
        View updated prompt
      </a></p>
      <hr/>
      <small>To manage your notification preferences visit your account settings.</small>
    `,
  };
}

// ── Core send helper ──────────────────────────────────────────────────────────

async function sendEmail(to: string, subject: string, html: string): Promise<void> {
  if (!process.env.SMTP_HOST && !process.env.EMAIL_SMTP_HOST) {
    console.warn("[email] SMTP not configured — skipping email to", to);
    return;
  }
  const transport = createTransport();
  await transport.sendMail({ from: FROM, to, subject, html });
  console.log(`[email] Sent "${subject}" to ${to}`);
}

// ── User preference helpers ───────────────────────────────────────────────────

async function getEmailForWallet(wallet: string): Promise<string | null> {
  const user = await User.findOne({ walletAddress: wallet.toLowerCase() }).lean();
  return (user as { email?: string } | null)?.email ?? null;
}

async function hasOptedIn(wallet: string, event: NotificationEvent): Promise<boolean> {
  const user = await User.findOne({ walletAddress: wallet.toLowerCase() }).lean();
  if (!user) return false;
  const prefs = (user as { notificationPreferences?: Partial<Record<NotificationEvent, boolean>> })
    .notificationPreferences;
  // Default opt-in when prefs not explicitly set
  return prefs?.[event] !== false;
}

// ── Public API ────────────────────────────────────────────────────────────────

/**
 * Notify a prompt creator when their prompt is purchased.
 * Looks up the creator wallet from the User collection.
 */
export async function notifyPromptPurchased(
  creatorWallet: string,
  payload: PurchasePayload
): Promise<void> {
  try {
    if (!(await hasOptedIn(creatorWallet, "PromptPurchased"))) return;
    const email = await getEmailForWallet(creatorWallet);
    if (!email) return;
    const { subject, html } = buildPurchaseEmail(payload);
    await sendEmail(email, subject, html);
  } catch (err) {
    console.error("[email] notifyPromptPurchased failed:", err);
  }
}

/**
 * Notify buyers of a prompt that a new version has been published.
 */
export async function notifyPromptUpdated(
  buyerWallets: string[],
  payload: UpdatePayload
): Promise<void> {
  const { subject, html } = buildUpdateEmail(payload);
  await Promise.allSettled(
    buyerWallets.map(async (wallet) => {
      try {
        if (!(await hasOptedIn(wallet, "PromptUpdated"))) return;
        const email = await getEmailForWallet(wallet);
        if (!email) return;
        await sendEmail(email, subject, html);
      } catch (err) {
        console.error(`[email] notifyPromptUpdated failed for ${wallet}:`, err);
      }
    })
  );
}
