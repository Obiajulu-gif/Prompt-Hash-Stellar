/**
 * Concurrent-edit conflict resolution controller (#1170).
 *
 * POST /api/concurrency/conflicts/resolve
 *
 * Wallet-authenticated. The actor is taken from the verified wallet session
 * (`req.sessionWallet`) and must own the edit (`body.ownerWallet`). A caller can
 * never resolve someone else's conflict by changing a body field.
 *
 * A genuine content conflict is a successful analysis (HTTP 200 with
 * `status: "conflict"` and markers), not an error. The client resolves it by
 * retrying with `resolutions`, then applies the merged content through the
 * existing optimistic version check.
 */

import type { Response } from "express";
import type { WalletSessionRequest } from "../middleware/walletSession";
import {
  EditConflictError,
  assertCanResolveEdits,
  editConflictRemedy,
  resolveEditConflict,
  type EditMergeStrategy,
  type EditConflictResolution,
} from "../services/editConflictResolver";

function statusFor(code: EditConflictError["code"]): number {
  if (code === "authorization_required") return 401;
  if (code === "not_edit_owner") return 403;
  return 400;
}

export const ResolveEditConflict = async (
  req: WalletSessionRequest,
  res: Response,
): Promise<Response> => {
  const body = (req.body ?? {}) as Record<string, any>;

  try {
    assertCanResolveEdits(req.sessionWallet, body.ownerWallet);

    const result = resolveEditConflict({
      base: body.base,
      mine: body.mine,
      theirs: body.theirs,
      strategy: body.strategy as EditMergeStrategy | undefined,
      resolutions: body.resolutions as EditConflictResolution[] | undefined,
    });

    return res.status(200).json({
      ...result,
      next:
        result.status === "conflict"
          ? "Review `conflicts` and retry with `resolutions: [{ index, choice: \"mine\" | \"theirs\" }]`."
          : "Apply `content` with the expected version; the write still uses the optimistic version check.",
    });
  } catch (err) {
    if (err instanceof EditConflictError) {
      return res.status(statusFor(err.code)).json({
        error: err.message,
        code: err.code,
        remedy: editConflictRemedy(err.code),
      });
    }
    return res.status(500).json({ error: "Failed to resolve edit conflict." });
  }
};
