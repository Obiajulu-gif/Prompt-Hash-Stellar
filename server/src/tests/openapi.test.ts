import { describe, it, expect } from "vitest";
import fs from "fs";
import path from "path";

describe("OpenAPI reference schema (#713)", () => {
  const docsDir = path.resolve(__dirname, "../../../docs");
  const openApiPath = path.join(docsDir, "openapi.json");
  const spec = JSON.parse(fs.readFileSync(openApiPath, "utf-8"));

  it("is a valid OpenAPI 3.0 document", () => {
    expect(spec.openapi).toBe("3.0.3");
    expect(spec.info.title).toBe("PromptHash Marketplace API");
    expect(spec.info.version).toBe("1.0.0");
    expect(spec.paths).toBeDefined();
    expect(spec.components.schemas).toBeDefined();
  });

  it("documents every marketplace endpoint from promptRoutes.ts", () => {
    const promptRoutes = fs.readFileSync(
      path.resolve(__dirname, "../routes/promptRoutes.ts"),
      "utf-8",
    );

    // Extract route strings like "/buyer/:walletAddress/owned" from the router.
    const routeMatches = promptRoutes.matchAll(
      /(?:promptRouter\.(?:get|post|route)\()\s*["'`]([^"'`]+)["'`]/g,
    );
    const documented = new Set(Object.keys(spec.paths));
    const normalize = (p: string) =>
      p
        .replace(/\/$/, "")
        .replace(/\{[^}]+\}/g, ":param")
        .replace(/:[a-zA-Z_]+/g, ":param");

    for (const match of routeMatches) {
      const route = match[1] as string;
      const openApiPath = `/api/prompts${route}`.replace(/\/$/, "");
      const routeNormalized = normalize(openApiPath);
      let found = false;
      for (const candidate of documented) {
        if (normalize(candidate) === routeNormalized) {
          found = true;
          break;
        }
      }
      expect(found, `Route ${openApiPath} is not documented in docs/openapi.json`).toBe(true);
    }
  });

  it("documents admin-scoped endpoints as requiring the admin token", () => {
    const reportsPath = spec.paths["/api/prompts/reports"].get;
    expect(reportsPath.security).toEqual([{ adminToken: [] }]);

    const integrityPath = spec.paths["/api/prompts/admin/integrity-report"].get;
    expect(integrityPath.security).toEqual([{ adminToken: [] }]);
  });

  it("documents the #711 privacy-safe analytics endpoint with redaction", () => {
    const analyticsPath =
      spec.paths["/api/prompts/creator/{walletAddress}/analytics/support-metrics"].get;
    expect(analyticsPath).toBeDefined();
    const analyticsSchema = spec.components.schemas.SellerAnalytics;
    expect(analyticsSchema.properties.cohort.properties.buyerIdentitiesRedacted.enum).toEqual([true]);
  });

  it("covers prompts, purchase/unlock queue side-effects, reviews, webhooks, and reports", () => {
    const paths = Object.keys(spec.paths);
    expect(paths.some((p) => p === "/api/prompts")).toBe(true);
    expect(paths.some((p) => p.includes("transactions"))).toBe(true);
    expect(paths.some((p) => p.includes("reviews"))).toBe(true);
    expect(paths.some((p) => p.includes("webhooks"))).toBe(true);
    expect(paths.some((p) => p === "/api/prompts/reports")).toBe(true);
    expect(paths.some((p) => p.includes("price-history"))).toBe(true);
  });
});

describe("OpenAPI serving surface (#713)", () => {
  const serverSource = fs.readFileSync(
    path.resolve(__dirname, "../server.ts"),
    "utf-8",
  );

  it("serves the machine-readable schema at GET /api/openapi.json", () => {
    expect(serverSource).toContain('app.get("/api/openapi.json", GetOpenApiSchema)');
  });

  it("exposes an interactive explorer at GET /api/docs", () => {
    expect(serverSource).toContain('app.get("/api/docs", GetOpenApiExplorer)');
  });

  it("validates the served JSON with a Redoc init pointing at the schema", () => {
    const controllerSource = fs.readFileSync(
      path.resolve(__dirname, "../controllers/docsControllers.ts"),
      "utf-8",
    );
    expect(controllerSource).toContain("Redoc.init");
    expect(controllerSource).toContain('"/api/openapi.json"');
  });
});