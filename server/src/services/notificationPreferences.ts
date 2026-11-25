/**
 * Durable notification preferences (#notification-routing).
 *
 * Splits notification types into two delivery classes:
 *
 *  - Optional  — delivered unless the recipient opted the type/channel off.
 *  - Mandatory — lifecycle/security alerts that are always routed and audited,
 *                regardless of any stored preference (see
 *                `MANDATORY_NOTIFICATION_TYPES` in `models/Notification.ts`).
 *
 * Preferences are persisted per wallet in `NotificationPreference`. Reads
 * fall back to the legacy `User.notificationPreferences` email opt-outs
 * (`PromptPurchased` / `PromptUpdated`) so existing users keep the choices
 * they already made before this model existed. Writes only ever touch the
 * new document; the legacy field stays untouched for backward compatibility.
 */

import NotificationPreference, {
  type ChannelPreference,
} from "../models/NotificationPreference";
import User from "../models/User";
import {
  MANDATORY_NOTIFICATION_TYPES,
  NOTIFICATION_TYPES,
  OPTIONAL_NOTIFICATION_TYPES,
  isMandatoryNotificationType,
  type NotificationType,
} from "../models/Notification";
import { recordAuditEvent } from "./auditTrail";

export type EffectivePreferences = Record<NotificationType, ChannelPreference>;

export type PreferenceUpdateErrorCode =
  | "unknown_notification_type"
  | "mandatory_type_not_configurable"
  | "invalid_channel_value";

export class NotificationPreferenceError extends Error {
  constructor(
    public readonly code: PreferenceUpdateErrorCode,
    message: string,
  ) {
    super(message);
    this.name = "NotificationPreferenceError";
  }
}

export interface PreferencePatch {
  [type: string]: Partial<ChannelPreference>;
}

const DEFAULT_CHANNEL: ChannelPreference = { inApp: true, email: true };

/**
 * Legacy email opt-outs stored on `User.notificationPreferences` map onto the
 * new type names. `PromptPurchased` notifications are delivered as purchase
 * receipts; `PromptUpdated` maps to `prompt_update`.
 */
const LEGACY_EMAIL_PREFERENCE_TYPES: Record<string, NotificationType> = {
  PromptPurchased: "purchase_receipt",
  PromptUpdated: "prompt_update",
};

export function defaultEffectivePreferences(): EffectivePreferences {
  const result = {} as EffectivePreferences;
  for (const type of NOTIFICATION_TYPES) {
    result[type] = { ...DEFAULT_CHANNEL };
  }
  return result;
}

function coerceStoredChannel(value: unknown): Partial<ChannelPreference> {
  if (!value || typeof value !== "object") return {};
  const raw = value as Record<string, unknown>;
  const result: Partial<ChannelPreference> = {};
  if (typeof raw.inApp === "boolean") result.inApp = raw.inApp;
  if (typeof raw.email === "boolean") result.email = raw.email;
  return result;
}

/**
 * Merge defaults, legacy email opt-outs, and the persisted document into the
 * effective preference map used by the delivery router. Mandatory types are
 * always forced on — a tampered/unexpected stored value cannot mute them.
 */
export function buildEffectivePreferences(input: {
  stored?: Record<string, unknown> | Map<string, unknown> | null;
  legacyEmailOptOuts?: Record<string, boolean> | null;
}): EffectivePreferences {
  const effective = defaultEffectivePreferences();

  for (const [legacyEvent, type] of Object.entries(
    LEGACY_EMAIL_PREFERENCE_TYPES,
  )) {
    if (input.legacyEmailOptOuts?.[legacyEvent] === false) {
      effective[type].email = false;
    }
  }

  if (input.stored) {
    const entries =
      input.stored instanceof Map
        ? [...input.stored.entries()]
        : Object.entries(input.stored as Record<string, unknown>);
    for (const [type, value] of entries) {
      if (!(NOTIFICATION_TYPES as string[]).includes(type)) continue;
      if (isMandatoryNotificationType(type)) continue; // never honor mutes for mandatory types
      const channel = coerceStoredChannel(value);
      if (typeof channel.inApp === "boolean")
        effective[type as NotificationType].inApp = channel.inApp;
      if (typeof channel.email === "boolean")
        effective[type as NotificationType].email = channel.email;
    }
  }

  for (const type of MANDATORY_NOTIFICATION_TYPES) {
    effective[type] = { inApp: true, email: true };
  }

  return effective;
}

export async function getEffectivePreferences(
  walletAddress: string,
): Promise<EffectivePreferences> {
  const wallet = String(walletAddress).toLowerCase();
  const [stored, user] = await Promise.all([
    NotificationPreference.findOne({ walletAddress: wallet }).lean(),
    User.findOne({ walletAddress: wallet }).lean(),
  ]);

  return buildEffectivePreferences({
    stored:
      (stored as { preferences?: Record<string, unknown> } | null)
        ?.preferences ?? null,
    legacyEmailOptOuts:
      (user as { notificationPreferences?: Record<string, boolean> } | null)
        ?.notificationPreferences ?? null,
  });
}

/**
 * Validate a partial preference patch. Returns the list of optional types the
 * patch is allowed to change; throws for unknown or mandatory types and for
 * non-boolean channel values. Pure function — used directly by tests and by
 * the update endpoint before any write is attempted.
 */
export function validatePreferencePatch(
  patch: PreferencePatch,
): NotificationType[] {
  const types = Object.keys(patch ?? {});
  for (const type of types) {
    if (!(NOTIFICATION_TYPES as string[]).includes(type)) {
      throw new NotificationPreferenceError(
        "unknown_notification_type",
        `Unknown notification type: ${type}`,
      );
    }
    if (isMandatoryNotificationType(type)) {
      throw new NotificationPreferenceError(
        "mandatory_type_not_configurable",
        `Notification type "${type}" is a mandatory lifecycle/security alert and cannot be disabled.`,
      );
    }
    const value = patch[type] ?? {};
    for (const channel of ["inApp", "email"]) {
      const channelValue = (value as Record<string, unknown>)[channel];
      if (channelValue !== undefined && typeof channelValue !== "boolean") {
        throw new NotificationPreferenceError(
          "invalid_channel_value",
          `Channel "${channel}" for "${type}" must be a boolean.`,
        );
      }
    }
  }
  return types as NotificationType[];
}

/**
 * Persist a partial preference update and record it in the audit trail.
 * Returns the merged effective preferences after the write.
 */
export async function updateNotificationPreferences(
  walletAddress: string,
  patch: PreferencePatch,
  context: { requestId?: string | null } = {},
): Promise<EffectivePreferences> {
  const wallet = String(walletAddress).toLowerCase();
  const types = validatePreferencePatch(patch);

  if (types.length > 0) {
    const setOperations: Record<string, ChannelPreference | boolean> = {};
    const current = await NotificationPreference.findOne({
      walletAddress: wallet,
    }).lean();
    const currentPrefs =
      (current as { preferences?: Record<string, unknown> } | null)
        ?.preferences ?? {};

    for (const type of types) {
      const existing = coerceStoredChannel(
        (currentPrefs as Record<string, unknown>)[type],
      );
      const merged: ChannelPreference = {
        inApp: patch[type]?.inApp ?? existing.inApp ?? DEFAULT_CHANNEL.inApp,
        email: patch[type]?.email ?? existing.email ?? DEFAULT_CHANNEL.email,
      };
      setOperations[`preferences.${type}.inApp`] = merged.inApp;
      setOperations[`preferences.${type}.email`] = merged.email;
    }

    await NotificationPreference.findOneAndUpdate(
      { walletAddress: wallet },
      { $set: setOperations },
      { upsert: true, new: true, setDefaultsOnInsert: true },
    );

    await recordAuditEvent({
      action: "notification_preference_updated",
      result: "success",
      promptId: null,
      walletAddress: wallet,
      requestId: context.requestId ?? null,
      reason: `types=${types.join(",")}`,
    });
  }

  return getEffectivePreferences(wallet);
}

export { OPTIONAL_NOTIFICATION_TYPES, MANDATORY_NOTIFICATION_TYPES };
