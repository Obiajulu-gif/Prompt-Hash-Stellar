import { Router, type Response } from "express";
import { requireAdminScope, type AdminRequest } from "../middleware/adminAuth";
import { recordAuditEvent } from "../services/auditTrail";
import {
  ALLOW_LIST_POLICIES,
  CONTENT_ALLOW_LIST_POLICIES,
  FILE_TYPE_ALLOW_LIST,
  checkContentAgainstPolicy,
  checkFileType,
  checkUrlAgainstPolicy,
  clearRuntimeAllowListOverride,
  describeAllowListPolicies,
  getRuntimeAllowListOverride,
  setRuntimeAllowListOverride,
  type AllowListMode,
  type AllowListPolicyName,
  type ContentPolicyName,
  type FileKind,
} from "../services/allowListPolicy";

/**
 * Operator view and runtime control of destination and content allow-list policies (#1025, #1177).
 *
 * GET    /api/admin/allow-list           — effective policies, content rules, and enforcement mode (`allowlist:read`)
 * POST   /api/admin/allow-list/check     — dry-run a URL, file descriptor, or content payload (`allowlist:read`)
 * PUT    /api/admin/allow-list/override  — set audited runtime mode/host allow-list overrides (`allowlist:write`)
 * DELETE /api/admin/allow-list/override  — roll back runtime overrides to environment defaults (`allowlist:write`)
 */
export const allowListRouter = Router();

allowListRouter.get("/", requireAdminScope("allowlist:read"), (_req: AdminRequest, res: Response) => {
  res.json(describeAllowListPolicies());
});

allowListRouter.post("/check", requireAdminScope("allowlist:read"), (req: AdminRequest, res: Response) => {
  const { policy, url, expectedKind, file, content } = req.body ?? {};

  if (content !== undefined) {
    const contentPolicy = content?.policy as ContentPolicyName;
    if (!(contentPolicy in CONTENT_ALLOW_LIST_POLICIES)) {
      return res.status(400).json({
        error: `content.policy must be one of: ${Object.keys(CONTENT_ALLOW_LIST_POLICIES).join(", ")}`,
      });
    }
    return res.json(
      checkContentAgainstPolicy(
        {
          content: content.value,
          contentType: typeof content.contentType === "string" ? content.contentType : undefined,
        },
        contentPolicy,
      ),
    );
  }

  if (file !== undefined) {
    const kind = file?.kind as FileKind;
    if (!(kind in FILE_TYPE_ALLOW_LIST)) {
      return res.status(400).json({ error: `file.kind must be one of: ${Object.keys(FILE_TYPE_ALLOW_LIST).join(", ")}` });
    }
    const bytes =
      typeof file.base64Prefix === "string" ? new Uint8Array(Buffer.from(file.base64Prefix, "base64")) : undefined;
    return res.json(
      checkFileType({
        kind,
        filename: typeof file.filename === "string" ? file.filename : undefined,
        contentType: typeof file.contentType === "string" ? file.contentType : undefined,
        bytes,
      }),
    );
  }

  if (!(policy in ALLOW_LIST_POLICIES)) {
    return res.status(400).json({ error: `policy must be one of: ${Object.keys(ALLOW_LIST_POLICIES).join(", ")}` });
  }
  if (expectedKind !== undefined && !(expectedKind in FILE_TYPE_ALLOW_LIST)) {
    return res.status(400).json({ error: "expectedKind is not a known file kind." });
  }
  // Always the pure check: the dry run reports what enforce mode would do,
  // regardless of the current ALLOWLIST_MODE.
  return res.json(
    checkUrlAgainstPolicy(url, policy as AllowListPolicyName, { expectedKind: expectedKind as FileKind | undefined }),
  );
});

allowListRouter.put("/override", requireAdminScope("allowlist:write"), (req: AdminRequest, res: Response) => {
  const { mode, hostAllowLists, reason } = req.body ?? {};
  if (typeof reason !== "string" || reason.trim().length < 4) {
    return res.status(400).json({ error: "A reason (at least 4 characters) is required for allow-list overrides." });
  }
  if (mode !== undefined && mode !== null && mode !== "enforce" && mode !== "report") {
    return res.status(400).json({ error: "mode must be 'enforce', 'report', or null." });
  }
  if (hostAllowLists !== undefined && (typeof hostAllowLists !== "object" || hostAllowLists === null || Array.isArray(hostAllowLists))) {
    return res.status(400).json({ error: "hostAllowLists must be an object keyed by policy name." });
  }
  if (hostAllowLists) {
    for (const key of Object.keys(hostAllowLists)) {
      if (!(key in ALLOW_LIST_POLICIES)) {
        return res.status(400).json({
          error: `Unknown policy '${key}'. Must be one of: ${Object.keys(ALLOW_LIST_POLICIES).join(", ")}`,
        });
      }
    }
  }

  const beforeState = getRuntimeAllowListOverride();
  const actor = req.admin?.sub ?? "admin";
  const updated = setRuntimeAllowListOverride({
    mode: mode as AllowListMode | null | undefined,
    hostAllowLists,
    actor,
    reason: reason.trim(),
  });

  void recordAuditEvent({
    action: "admin_config_change",
    result: "success",
    actor,
    target: "system_config:allow_list_override",
    targetType: "admin_config",
    beforeState,
    afterState: updated,
    reason: reason.trim(),
    requestId: req.requestId ?? null,
  });

  return res.json(describeAllowListPolicies());
});

allowListRouter.delete("/override", requireAdminScope("allowlist:write"), (req: AdminRequest, res: Response) => {
  const beforeState = getRuntimeAllowListOverride();
  const actor = req.admin?.sub ?? "admin";
  const reason = typeof req.body?.reason === "string" && req.body.reason.trim() ? req.body.reason.trim() : "Rollback runtime allow-list override";
  const cleared = clearRuntimeAllowListOverride(actor, reason);

  void recordAuditEvent({
    action: "admin_config_change",
    result: "success",
    actor,
    target: "system_config:allow_list_override",
    targetType: "admin_config",
    beforeState,
    afterState: cleared,
    reason,
    requestId: req.requestId ?? null,
  });

  return res.json(describeAllowListPolicies());
});
