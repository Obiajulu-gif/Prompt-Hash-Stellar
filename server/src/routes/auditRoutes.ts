import { Router, Response } from "express";
import connectDb from "../db/connectDb";
import { AUDIT_ACTIONS, AuditAction } from "../models/AuditLog";
import { AdminRequest, requireAdminScope } from "../middleware/adminAuth";
import { markPrivate } from "../middleware/etag";
import {
  AUDIT_EXPORT_MAX_LIMIT,
  AUDIT_EXPORT_SCOPES,
  AuditBundleExportFilter,
  AuditExportScope,
  exportAuditBundle,
  recordAuditEvent,
  verifyAuditExport,
} from "../services/auditTrail";

/**
 * Audit-grade admin activity export (#783).
 *
 * GET  /api/audit/export         — filtered, paged, tamper-evident export
 * POST /api/audit/export/verify  — verify a previously exported bundle
 *
 * Both require the `audit:export` admin scope. See
 * docs/operations/audit-log-usage.md for the export schema and the
 * verification procedure.
 */
export const auditRouter = Router();

function parseDate(value: unknown): Date | undefined | null {
  if (value === undefined || value === "") return undefined;
  const date = new Date(String(value));
  return Number.isNaN(date.getTime()) ? null : date;
}

function parseExportFilter(
  query: Record<string, unknown>,
): { filter: AuditBundleExportFilter } | { error: string } {
  const filter: AuditBundleExportFilter = {};

  if (query.actor) filter.actor = String(query.actor);
  if (query.promptId) filter.promptId = String(query.promptId);

  if (query.action) {
    const actions = String(query.action)
      .split(",")
      .map((a) => a.trim())
      .filter(Boolean);
    const unknown = actions.filter((a) => !(AUDIT_ACTIONS as readonly string[]).includes(a));
    if (unknown.length > 0) return { error: `Unknown action: ${unknown.join(", ")}` };
    filter.action = actions as AuditAction[];
  }

  if (query.scope) {
    const scope = String(query.scope);
    if (!(scope in AUDIT_EXPORT_SCOPES)) {
      return { error: `scope must be one of: ${Object.keys(AUDIT_EXPORT_SCOPES).join(", ")}` };
    }
    filter.scope = scope as AuditExportScope;
  }

  const since = parseDate(query.since);
  const until = parseDate(query.until);
  if (since === null || until === null) return { error: "since and until must be valid dates." };
  if (since && until && since > until) return { error: "since must not be after until." };
  filter.since = since;
  filter.until = until;

  if (query.limit !== undefined) {
    const limit = Number(query.limit);
    if (!Number.isInteger(limit) || limit < 1 || limit > AUDIT_EXPORT_MAX_LIMIT) {
      return { error: `limit must be an integer between 1 and ${AUDIT_EXPORT_MAX_LIMIT}.` };
    }
    filter.limit = limit;
  }

  if (query.after) filter.after = String(query.after);

  return { filter };
}

auditRouter.get(
  "/export",
  requireAdminScope("audit:export"),
  async (req: AdminRequest, res: Response) => {
    markPrivate(res);
    const parsed = parseExportFilter(req.query as Record<string, unknown>);
    if ("error" in parsed) {
      res.status(400).json({ error: parsed.error });
      return;
    }

    try {
      await connectDb();
      const bundle = await exportAuditBundle(parsed.filter);

      // The export itself is admin activity: record who pulled what, without
      // echoing a raw wallet actor filter into the trail.
      await recordAuditEvent({
        action: "audit_export",
        result: "success",
        actor: req.admin?.sub ?? null,
        promptId: parsed.filter.promptId ?? null,
        requestId: req.correlationId ?? null,
        reason: `records=${bundle.recordCount} scope=${parsed.filter.scope ?? "all"}`,
      });

      res.json(bundle);
    } catch (err) {
      if (err instanceof Error && err.message === "Invalid export cursor.") {
        res.status(400).json({ error: err.message });
        return;
      }
      throw err;
    }
  },
);

auditRouter.post(
  "/export/verify",
  requireAdminScope("audit:export"),
  async (req: AdminRequest, res: Response) => {
    const { records, integrityChecksum } = req.body ?? {};
    if (!Array.isArray(records) || typeof integrityChecksum !== "string") {
      res.status(400).json({ error: "An exported bundle with records and integrityChecksum is required." });
      return;
    }
    if (records.length > AUDIT_EXPORT_MAX_LIMIT) {
      res.status(413).json({ error: `A bundle may contain at most ${AUDIT_EXPORT_MAX_LIMIT} records.` });
      return;
    }

    await connectDb();
    res.json(await verifyAuditExport({ records, integrityChecksum }));
  },
);
