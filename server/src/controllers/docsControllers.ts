import { Request, Response } from "express";
import fs from "fs";
import path from "path";

/**
 * Serves the machine-readable OpenAPI schema for the marketplace API (#713).
 *
 * The authoritative document lives at docs/openapi.json next to the human
 * reference at docs/api-reference.md. It is served read-only at
 * GET /api/openapi.json so SDK consumers (hey-api, openapi-generator, postman)
 * can fetch and validate against a live schema, and an interactive
 * Redoc-powered explorer is available at GET /api/docs.
 */
const OPENAPI_PATH = path.resolve(
  __dirname,
  "../../../docs/openapi.json",
);

const REDOC_HTML = `<!DOCTYPE html>
<html lang="en">
  <head>
    <meta charset="utf-8" />
    <meta name="viewport" content="width=device-width, initial-scale=1" />
    <title>PromptHash Marketplace API — Reference</title>
    <style>
      body { margin: 0; font-family: system-ui, sans-serif; }
      #openapi { position: relative; }
    </style>
  </head>
  <body>
    <div id="openapi"></div>
    <script src="https://cdn.redoc.ly/redoc/latest/bundles/redoc.standalone.js"></script>
    <script>
      Redoc.init("/api/openapi.json", { hideDownloadButton: false, expandResponses: "200" }, document.getElementById("openapi"));
    </script>
  </body>
</html>`;

export const GetOpenApiSchema = (_req: Request, res: Response): Response => {
  try {
    const schema = fs.readFileSync(OPENAPI_PATH, "utf-8");
    res.setHeader("Cache-Control", "public, max-age=300");
    res.status(200).type("application/json").send(schema);
  } catch (err) {
    console.error("GetOpenApiSchema error:", err);
    return res
      .status(500)
      .json({ error: "OpenAPI schema not available" });
  }
  return res;
};

export const GetOpenApiExplorer = (_req: Request, res: Response): Response => {
  res.setHeader("Cache-Control", "public, max-age=300");
  return res.status(200).type("text/html").send(REDOC_HTML);
};