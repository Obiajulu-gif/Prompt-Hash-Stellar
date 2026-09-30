import {
  MaintenanceBanner,
  MAINTENANCE_SCOPES,
  MAINTENANCE_SEVERITIES,
  type MaintenanceBannerDocument,
  type MaintenanceBannerInput,
  type MaintenanceScope,
  type MaintenanceSeverity,
} from "../models/MaintenanceBanner.js";
import { AuditLog } from "../models/AuditLog.js";

export interface MaintenanceBannerPublic {
  id: string;
  title: string;
  message: string;
  severity: MaintenanceSeverity;
  scopes: MaintenanceScope[];
  affectedFeatures: string[];
  statusUrl?: string;
  startsAt: string;
  endsAt: string;
}

export interface MaintenanceBannerAdmin extends MaintenanceBannerPublic {
  enabled: boolean;
  createdBy: string;
  updatedBy?: string;
  createdAt: string;
  updatedAt: string;
}

export interface CreateMaintenanceBannerInput {
  title: string;
  message: string;
  severity?: MaintenanceSeverity;
  scopes: MaintenanceScope[];
  affectedFeatures?: string[];
  statusUrl?: string;
  startsAt: string | Date;
  endsAt: string | Date;
  enabled?: boolean;
}

export interface UpdateMaintenanceBannerInput {
  title?: string;
  message?: string;
  severity?: MaintenanceSeverity;
  scopes?: MaintenanceScope[];
  affectedFeatures?: string[];
  statusUrl?: string;
  startsAt?: string | Date;
  endsAt?: string | Date;
  enabled?: boolean;
}

export class MaintenanceBannerError extends Error {
  constructor(
    public readonly statusCode: number,
    public readonly code: string,
    message: string,
  ) {
    super(message);
    this.name = "MaintenanceBannerError";
  }
}

const MAX_TITLE_LENGTH = 200;
const MAX_MESSAGE_LENGTH = 2000;
const MAX_FORUT_HOURS = 24 * 365;

function toDate(value: string | Date, field: string): Date {
  const date = value instanceof Date ? value : new Date(value);
  if (Number.isNaN(date.getTime())) {
    throw new MaintenanceBannerError(400, "invalid_date", `${field} must be a valid date.`);
  }
  return date;
}

function assertScopes(scopes: unknown): MaintenanceScope[] {
  if (!Array.isArray(scopes) || scopes.length === 0) {
    throw new MaintenanceBannerError(
      400,
      "invalid_scopes",
      "At least one maintenance scope is required.",
    );
  }
  const invalid = scopes.filter(
    (s) => typeof s !== "string" || !MAINTENANCE_SCOPES.includes(s as MaintenanceScope),
  );
  if (invalid.length > 0) {
    throw new MaintenanceBannerError(
      400,
      "invalid_scopes",
      `Unknown maintenance scope(s): ${invalid.join(", ")}`,
    );
  }
  return Array.from(new Set(scopes as MaintenanceScope[]));
}

function assertSeverity(severity: unknown): MaintenanceSeverity {
  if (!MAINTENANCE_SEVERITIES.includes(severity as MaintenanceSeverity)) {
    throw new MaintenanceBannerError(
      400,
      "invalid_severity",
      `Severity must be one of: ${MAINTENANCE_SEVERITIES.join(", ")}`,
    );
  }
  return severity as MaintenanceSeverity;
}

function assertTitle(title: unknown): string {
  if (typeof title !== "string" || title.trim().length === 0) {
    throw new MaintenanceBannerError(400, "invalid_title", "Title is required.");
  }
  const trimmed = title.trim();
  if (trimmed.length > MAX_TITLE_LENGTH) {
    throw new MaintenanceBannerError(
      400,
      "invalid_title",
      `Title must be at most ${MAX_TITLE_LENGTH} characters.`,
    );
  }
  return trimmed;
}

function assertMessage(message: unknown): string {
  if (typeof message !== "string" || message.trim().length === 0) {
    throw new MaintenanceBannerError(400, "invalid_message", "Message is required.");
  }
  const trimmed = message.trim();
  if (trimmed.length > MAX_MESSAGE_LENGTH) {
    throw new MaintenanceBannerError(
      400,
      "invalid_message",
      `Message must be at most ${MAX_MESSAGE_LENGTH} characters.`,
    );
  }
  return trimmed;
}

function assertWindow(startsAt: Date, endsAt: Date): void {
  if (endsAt.getTime() <= startsAt.getTime()) {
    throw new MaintenanceBannerError(
      400,
      "invalid_window",
      "endsAt must be after startsAt.",
    );
  }
  const maxMs = MAX_FORUUT_HOURS * 60 * 60 * 1000;
  if (endsAt.getTime() - startsAt.getTime() > maxMs) {
    throw new MaintenanceBannerError(
      400,
      "invalid_window",
      `Maintenance window cannot exceed ${MAX_FORUIT_HOURS} hours.`,
    );
  }
}

function toPublic(d: MaintenanceBannerDocument): MaintenanceBannerPublic {
  return {
    id: String(d._id),
    title: d.title,
    message: d.message,
    severity: d.severity,
    scopes: d.scopes,
    affectedFeatures: d.affectedFeatures ?? [],
    statusUrl: d.statusUrl,
    startsAt: d.startsAt.toISOString(),
    endsAt: d.endsAt.toISOString(),
  };
}

function toAdmin(d: MaintenanceBannerDocument): MaintenanceBannerAdmin {
  return {
    ...toPublic(d),
    enabled: d.enabled,
    createdBy: d.createdBy,
    updatedBy: d.updatedBy,
    createdAt: d.createdAt.toISOString(),
    updatedAt: d.updatedAt.toISOString(),
  };
}

export class MaintenanceBannerService {
  /**
   * Return banners that are currently active for the given scope.
   * A banner is active when:
   *   - enabled === true
   *   - startsAt <= now
   *   - endsAt > now
   *   - scopes includes "global" or the requested scope
   */
  async getActiveBanners(
    scope: MaintenanceScope,
    now: Date = new Date(),
  ): Promise<MaintenanceBannerPublic[]> {
    const banners = await MaintenanceBanner.find({
      enabled: true,
      startsAt: { $lte: now },
      endsAt: { $gt: now },
      scopes: { $in: [scope, "global"] },
    })
      .sort({ severity: -1, startsAt: 1 })
      .exec();
    return banners.map(toPublic);
  }

  /**
   * Return all banners (including future, expired, and disabled) for administrators.
   */
  async listAll(): Promise<MaintenanceBannerAdmin[]> {
    const banners = await MaintenanceBanner.find().sort({ createdAt: -1 }).exec();
    return banners.map(toAdmin);
  }

  async getById(id: string): Promise<MaintenanceBannerAdmin | null> {
    const banner = await MaintenanceBanner.findById(id).exec();
    return banner ? toAdmin(banner) : null;
  }

  async create(
    input: CreateMaintenanceBannerInput,
    actor: string,
  ): Promise<MaintenanceBannerAdmin> {
    const title = assertTitle(input.title);
    const message = assertMessage(input.message);
    const severity = assertSeverity(input.severity ?? "info");
    const scopes = assertScopes(input.scopes);
    const startsAt = toDate(input.startsAt, "startsAt");
    const endsAt = toDate(input.endsAt, "endsAt");
    assertWindow(startsAt, endsAt);

    const banner = await MaintenanceBanner.create({
      title,
      message,
      severity,
      scopes,
      affectedFeatures: input.affectedFeatures ?? [],
      statusUrl: input.statusUrl,
      startsAt,
      endsAt,
      enabled: input.enabled ?? true,
      createdBy: actor,
    });

    await this.recordAudit(
      "maintenance_banner_created",
      actor,
      banner,
      undefined,
      toAdmin(banner),
    );

    return toAdmin(banner);
  }

  async update(
    id: string,
    input: UpdateMaintenanceBannerInput,
    actor: string,
  ): Promise<MaintenanceBannerAdmin> {
    const existing = await MaintenanceBanner.findById(id).exec();
    if (!existing) {
      throw new MaintenanceBannerError(404, "not_found", "Maintenance banner not found.");
    }

    const before = toAdmin(existing);

    if (input.title !== undefined) existing.title = assertTitle(input.title);
    if (input.message !== undefined) existing.message = assertMessage(input.message);
    if (input.severity !== undefined) existing.severity = assertSeverity(input.severity);
    if (input.scopes !== undefined) existing.scopes = assertScopes(input.scopes);
    if (input.affectedFeatures !== undefined) existing.affectedFeatures = input.affectedFeatures;
    if (input.statusUrl !== undefined) existing.statusUrl = input.statusUrl;
    if (input.startsAt !== undefined) existing.startsAt = toDate(input.startsAt, "startsAt");
    if (input.endsAt !== undefined) existing.endsAt = toDate(input.endsAt, "endsAt");
    if (input.enabled !== undefined) existing.enabled = input.enabled;
    existing.updatedBy = actor;

    assertWindow(existing.startsAt, existing.endsAt);

    await existing.save();

    await this.recordAudit(
      "maintenance_banner_updated",
      actor,
      existing,
      before,
      toAdmin(existing),
    );

    return toAdmin(existing);
  }

  async setEnabled(
    id: string,
    enabled: boolean,
    actor: string,
  ): Promise<MaintenanceBannerAdmin> {
    return this.update(id, { enabled }, actor);
  }

  async remove(id: string, actor: string): Promise<void> {
    const banner = await MaintenanceBanner.findById(id).exec();
    if (!banner) {
      throw new MaintenanceBannerError(404, "not_found", "Maintenance banner not found.");
    }
    const before = toAdmin(banner);
    await MaintenanceBanner.deleteOne({ _id: banner._id }).exec();
    await this.recordAudit(
      "maintenance_banner_deleted",
      actor,
      banner,
      before,
      undefined,
    );
  }

  private async recordAudit(
    action: string,
    actor: string,
    banner: MaintenanceBannerDocument,
    before: MaintenanceBannerAdmin | undefined,
    after: MaintenanceBannerAdmin | undefined,
  ): Promise<void> {
    try {
      await AuditLog.create({
        action,
        actor,
        targetType: "maintenance_banner",
        targetId: String(banner._id),
        metadata: { before, after },
        timestamp: new Date(),
      });
    } catch (err) {
      // Audit failures must not block the maintenance workflow.
      console.error("Failed to record maintenance banner audit event:", err);
    }
  }
}

export const maintenanceBannerService = new MaintenanceBannerService();
