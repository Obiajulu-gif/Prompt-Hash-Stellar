/**
 * Notification delivery router.
 *
 * Every notification in the product flows through `deliverNotification`:
 *
 *   1. Classify the type as optional or mandatory.
 *   2. Resolve channels from the recipient's durable preferences. Mandatory
 *      lifecycle/security alerts always resolve to enabled (preferences can
 *      not mute them) and can never be lost to a preferences read failure.
 *   3. Persist one durable in-app row (unique per `dedupeKey`, so retries and
 *      duplicate event projections deliver exactly once).
 *   4. Mandatory deliveries are recorded through the tamper-evident audit
 *      trail with a stable reason code, so "was the user warned?" is always
 *      answerable during incident review.
 *
 * Failures are contained: a preferences read error degrades to defaults
 * (optional types may then over-deliver — preferred over silently dropping a
 * mandatory alert), and an audit write failure never blocks delivery
 * (`recordAuditEvent` is fire-and-forget by contract).
 */

import Notification, {
  isMandatoryNotificationType,
  type NotificationType,
} from "../models/Notification";
import { recordAuditEvent } from "./auditTrail";
import {
  defaultEffectivePreferences,
  getEffectivePreferences,
  type EffectivePreferences,
} from "./notificationPreferences";
import type { ChannelPreference } from "../models/NotificationPreference";

export interface DeliveryPlan {
  type: NotificationType;
  mandatory: boolean;
  channels: ChannelPreference;
  suppressed: boolean;
}

export interface DeliverNotificationInput {
  recipientWallet: string;
  type: NotificationType;
  message: string;
  promptId?: string;
  promptTitle?: string;
  versionIndex?: number;
  changeNote?: string;
  dedupeKey?: string;
  requestId?: string | null;
  /** Pre-resolved preferences (tests / batch callers); loaded when omitted. */
  preferences?: EffectivePreferences;
}

export interface DeliveryReceipt {
  delivered: boolean;
  alreadyDelivered: boolean;
  mandatory: boolean;
  channels: ChannelPreference;
  notificationId?: string;
  suppressionReason?: "preference_disabled";
}

/**
 * Pure routing decision. Exported so preference-class policy can be tested
 * without any database or network dependency.
 */
export function planNotificationDelivery(
  type: NotificationType,
  preferences: EffectivePreferences,
): DeliveryPlan {
  const mandatory = isMandatoryNotificationType(type);
  const stored = preferences[type];
  const channels: ChannelPreference = mandatory
    ? { inApp: true, email: true }
    : { inApp: stored.inApp, email: stored.email };
  return {
    type,
    mandatory,
    channels,
    suppressed: !channels.inApp,
  };
}

async function resolvePreferences(
  wallet: string,
  provided?: EffectivePreferences,
): Promise<EffectivePreferences> {
  if (provided) return provided;
  try {
    return await getEffectivePreferences(wallet);
  } catch {
    // Degrade to defaults: an outage in the preferences collection must not
    // silence mandatory alerts, and optional types default to opt-in.
    return defaultEffectivePreferences();
  }
}

function isDuplicateKeyError(err: unknown): boolean {
  return (err as { code?: number } | null)?.code === 11000;
}

/**
 * Route and persist one notification. Safe to call multiple times for the
 * same logical event when `dedupeKey` is supplied.
 */
export async function deliverNotification(
  input: DeliverNotificationInput,
): Promise<DeliveryReceipt> {
  const wallet = input.recipientWallet.trim().toLowerCase();
  const preferences = await resolvePreferences(wallet, input.preferences);
  const plan = planNotificationDelivery(input.type, preferences);

  if (plan.suppressed) {
    return {
      delivered: false,
      alreadyDelivered: false,
      mandatory: plan.mandatory,
      channels: plan.channels,
      suppressionReason: "preference_disabled",
    };
  }

  let notificationId: string | undefined;
  let alreadyDelivered = false;

  try {
    const created = await Notification.create({
      recipientWallet: wallet,
      promptId: input.promptId ?? "",
      promptTitle: input.promptTitle ?? "",
      type: input.type,
      message: input.message,
      versionIndex: input.versionIndex ?? 0,
      changeNote: input.changeNote ?? "",
      mandatory: plan.mandatory,
      dedupeKey: input.dedupeKey ?? null,
      read: false,
    });
    notificationId = String((created as { _id?: unknown })._id ?? "");
  } catch (err) {
    if (!isDuplicateKeyError(err) || !input.dedupeKey) throw err;
    // Exactly-once delivery: the same logical event was already persisted.
    alreadyDelivered = true;
    const existing = await Notification.findOne({
      recipientWallet: wallet, type: input.type, dedupeKey: input.dedupeKey,
    }).lean();
    if (!existing) throw err;
    notificationId = existing
      ? String((existing as { _id?: unknown })._id ?? "")
      : undefined;
  }

  if (plan.mandatory) {
    await recordAuditEvent({
      action: "notification_mandatory_delivered",
      result: "success",
      promptId: input.promptId ?? null,
      walletAddress: wallet,
      requestId: input.requestId ?? null,
      reason: `type=${input.type}${input.dedupeKey ? ` dedupeKey=${input.dedupeKey}` : ""}${
        alreadyDelivered ? " duplicate=true" : ""
      }`,
    });
  }

  return {
    delivered: !alreadyDelivered,
    alreadyDelivered,
    mandatory: plan.mandatory,
    channels: plan.channels,
    notificationId,
  };
}
