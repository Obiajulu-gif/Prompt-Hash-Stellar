import express, { Request, Response } from "express";
import connectDb from "../db/connectDb";
import { requireAdminScope, type AdminRequest } from "../middleware/adminAuth";
import {
  MAINTAINER_NOTE_SCOPES,
  MaintainerNoteError,
  archiveMaintainerNote,
  buildRetentionReport,
  createMaintainerNote,
  editMaintainerNote,
  listVisibleMaintainerNotes,
  loadRetentionCandidates,
  redactMaintainerNote,
  toNoteView,
  type NoteViewer,
} from "../services/maintainerNotes";

/**
 * Structured maintainer notes (#903). Mounted at /api/admin/maintainer-notes.
 *
 *   GET   /subjects/:subjectId/notes   list notes the caller may see   maintainer_notes:read
 *   POST  /subjects/:subjectId/notes   create a note                   maintainer_notes:write
 *   PATCH /notes/:noteId               edit (author only, by version) maintainer_notes:write
 *   POST  /notes/:noteId/archive       archive                         maintainer_notes:write
 *   POST  /notes/:noteId/redact        clear text, keep audit refs     maintainer_notes:restricted
 *   GET   /retention-report            notes due for redaction         maintainer_notes:restricted
 *
 * The author comes from the admin token `sub`, never from the request body.
 * A note the caller cannot see returns 404, the same as a missing note.
 */
export const maintainerNoteRouter = express.Router();

function viewerOf(req: Request): NoteViewer {
  const admin = (req as AdminRequest).admin;
  return { sub: admin?.sub ?? "", scopes: admin?.scope ?? [] };
}

function sendError(res: Response, err: unknown, action: string) {
  if (err instanceof MaintainerNoteError) {
    const status =
      err.code === "not_found"
        ? 404
        : err.code === "not_author"
          ? 403
          : err.code === "version_conflict" || err.code === "already_redacted" || err.code === "not_editable"
            ? 409
            : 400;
    return res.status(status).json({ error: err.message, code: err.code });
  }
  console.error(`Maintainer note ${action} error:`, err);
  return res.status(500).json({ error: `Failed to ${action} maintainer note.` });
}

maintainerNoteRouter.get(
  "/subjects/:subjectId/notes",
  requireAdminScope(MAINTAINER_NOTE_SCOPES.read),
  async (req: Request, res: Response) => {
    try {
      await connectDb();
      const notes = await listVisibleMaintainerNotes(String(req.params.subjectId), viewerOf(req), {
        includeArchived: req.query.includeArchived === "true",
        requestId: req.correlationId ?? null,
      });
      return res.json({ success: true, notes });
    } catch (err) {
      return sendError(res, err, "list");
    }
  },
);

maintainerNoteRouter.post(
  "/subjects/:subjectId/notes",
  requireAdminScope(MAINTAINER_NOTE_SCOPES.write),
  async (req: Request, res: Response) => {
    try {
      await connectDb();
      const viewer = viewerOf(req);
      const { type, text, visibility } = req.body ?? {};
      const note = await createMaintainerNote({
        subjectId: String(req.params.subjectId),
        type,
        text,
        visibility,
        author: viewer.sub,
        requestId: req.correlationId ?? null,
      });
      return res.status(201).json({ success: true, note: toNoteView(note) });
    } catch (err) {
      return sendError(res, err, "create");
    }
  },
);

maintainerNoteRouter.patch(
  "/notes/:noteId",
  requireAdminScope(MAINTAINER_NOTE_SCOPES.write),
  async (req: Request, res: Response) => {
    try {
      await connectDb();
      const { text, visibility, expectedVersion } = req.body ?? {};
      if (!Number.isInteger(expectedVersion) || expectedVersion < 1) {
        return res.status(400).json({ error: "expectedVersion is required." });
      }
      if (text === undefined && visibility === undefined) {
        return res.status(400).json({ error: "Provide text or visibility to edit." });
      }
      const note = await editMaintainerNote(
        String(req.params.noteId),
        { text, visibility, expectedVersion },
        viewerOf(req),
        req.correlationId ?? null,
      );
      return res.json({ success: true, note: toNoteView(note) });
    } catch (err) {
      return sendError(res, err, "edit");
    }
  },
);

maintainerNoteRouter.post(
  "/notes/:noteId/archive",
  requireAdminScope(MAINTAINER_NOTE_SCOPES.write),
  async (req: Request, res: Response) => {
    try {
      await connectDb();
      const note = await archiveMaintainerNote(
        String(req.params.noteId),
        viewerOf(req),
        req.correlationId ?? null,
      );
      return res.json({ success: true, note: toNoteView(note) });
    } catch (err) {
      return sendError(res, err, "archive");
    }
  },
);

maintainerNoteRouter.post(
  "/notes/:noteId/redact",
  requireAdminScope(MAINTAINER_NOTE_SCOPES.restricted),
  async (req: Request, res: Response) => {
    try {
      await connectDb();
      const note = await redactMaintainerNote(
        String(req.params.noteId),
        { reason: req.body?.reason },
        viewerOf(req),
        req.correlationId ?? null,
      );
      return res.json({ success: true, note: toNoteView(note) });
    } catch (err) {
      return sendError(res, err, "redact");
    }
  },
);

maintainerNoteRouter.get(
  "/retention-report",
  requireAdminScope(MAINTAINER_NOTE_SCOPES.restricted),
  async (req: Request, res: Response) => {
    try {
      await connectDb();
      const limit = typeof req.query.limit === "string" ? Number(req.query.limit) : undefined;
      const notes = await loadRetentionCandidates(limit);
      return res.json({ success: true, report: buildRetentionReport(notes) });
    } catch (err) {
      return sendError(res, err, "report");
    }
  },
);
