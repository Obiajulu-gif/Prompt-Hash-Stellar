import { Router, type Request, type Response, type NextFunction } from "express";
import {
  maintenanceBannerService,
  MaintenanceBannerError,
  type CreateMaintenanceBannerInput,
  type UpdateMaintenanceBannerInput,
} from "../services/maintenanceBannerService.js";
import {
  MAINTENANCE_SCOPES,
  MAINTENANCE_SEVERITIES,
  type MaintenanceScope,
} from "../models/MaintenanceBanner.js";
import { requireAdmin } from "../middleware/requireAdmin.js";

export const maintenanceBannerRouter = Router();

function handleError(err: unknown, res: Response, next: NextFunction): void {
  if (err instanceof MaintenanceBannerError) {
    res.status(err.statusCode).json({ error: err.code, message: err.message });
    return;
  }
  next(err);
}

/**
 * Public: list active maintenance banners for a scope.
 * GET /api/maintenance-banners/active?scope=marketplace
 */
maintenanceBannerRouter.get(
  "/active",
  async (req: Request, res: Response, next: NextFunction) => {
    try {
      const scopeParam = (req.query.scope as string | undefined) ?? "global";
      if (!MAINTENANCE_SCOPES.includes(scopeParam as MaintenanceScope)) {
        res.status(400).json({
          error: "invalid_scope",
          message: `Unknown scope. Allowed: ${MAINTENANCE_SCOPES.join(", ")}`,
        });
        return;
      }
      const banners = await maintenanceBannerService.getActiveBanners(scopeParam as MaintenanceScope);
      res.json({ scope: scopeParam, banners: banners });
    } catch (err) {
      handleError(err, res, next);
    }
  },
);

/**
 * Public: metadata about available scopes and severities.
 */
maintenanceBannerRouter.get("/metadata", (_req, res) => {
  res.json({
    scopes: MAINTENANCE_SCOPES,
    severities: MAINTENANCE_SEVERITIES,
  });
});

/**
 * Admin: list all banners.
 */
maintenanceBannerRouter.get(
  "/",
  requireAdmin,
  async (_req: Request, res: Response, next: NextFunction) => {
    try {
      const banners = await maintenanceBannerService.listAll();
      res.json({ banners: banners });
    } catch (err) {
      handleError(err, res, next);
    }
  },
);

/**
 * Admin: get a single banner.
 */
maintenanceBannerRouter.get(
  "/:id",
  requireAdmin,
  async (req: Request, res: Response, next: NextFunction) => {
    try {
      const banner = await maintenanceBannerService.getById(req.params.id);
      if (!banner) {
        res.status(404).json({ error: "not_found", message: "Maintenance banner not found." });
        return;
      }
      res.json({ banner });
    } catch (err) {
      handleError(err, res, next);
    }
  },
);

/**
 * Admin: create a banner.
 */
maintenanceBannerRouter.post(
  "/",
  requireAdmin,
  async (req: Request, res: Response, next: NextFunction) => {
    try {
      const actor = req.adminWallet ?? (req.body?.createdBy as string);
      if (!actor) {
        res.status(401).json({ error: "unauthorized", message: "Admin identity required." });
        return;
      }
      const input = req.body as CreateMaintenanceBannerInput;
      const banner = await maintenanceBannerService.create(input, actor);
      res.status(201).json({ banner });
    } catch (err) {
      handleError(err, res, next);
    }
  },
);

/**
 * Admin: update a banner.
 */
maintenanceBannerRouter.patch(
  "/:id",
  requireAdmin,
  async (req: Request, res: Response, next: NextFunction) => {
    try {
      const actor = req.adminWallet ?? (req.body?.updatedBy as string);
      if (!actor) {
        res.status(401).json({ error: "unauthorized", message: "Admin identity required." });
        return;
      }
      const input = req.body as UpdateMaintenanceBannerInput;
      const banner = await maintenanceBannerService.update(req.params.id, input, actor);
      res.json({ banner });
    } catch (err) {
      handleError(err, res, next);
    }
  },
);

/**
 * Admin: enable or disable a banner.
 */
maintenanceBannerRouter.post(
  "/:id/enabled",
  requireAdmin,
  async (req: Request, res: Response, next: NextFunction) => {
    try {
      const actor = req.adminWallet ?? (req.body?.updatedBy as string);
      if (!actor) {
        res.status(401).json({ error: "unauthorized", message: "Admin identity required." });
        return;
      }
      const enabled = Boolean(req.body?.enabled);
      const banner = await maintenanceBannerService.setEnabled(req.params.id, enabled, actor);
      res.json({ banner });
    } catch (err) {
      handleError(err, res, next);
    }
  },
);

/**
 * Admin: delete a banner.
 */
maintenanceBannerRouter.delete(
  "/:id",
  requireAdmin,
  async (req: Request, res: Response, next: NextFunction) => {
    try {
      const actor = req.adminWallet ?? (req.body?.updatedBy as string);
      if (!actor) {
        res.status(401).json({ error: "unauthorized", message: "Admin identity required." });
        return;
      }
      await maintenanceBannerService.remove(req.params.id, actor);
      res.status(204).send();
    } catch (err) {
      handleError(err, res, next);
    }
  },
);

export default maintenanceBannerRouter;
