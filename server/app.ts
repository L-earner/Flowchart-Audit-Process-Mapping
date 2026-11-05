import express from "express";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";
import { existsSync } from "node:fs";
import { extractRouter } from "./routes/extract.ts";
import { diagramsRouter } from "./routes/diagrams.ts";
import { liveRouter } from "./routes/live.ts";
import { isDemoMode } from "./lib/demoMode.ts";
import { geminiApiKey } from "./lib/providers/gemini.ts";

const __dirname = dirname(fileURLToPath(import.meta.url));

/**
 * Build the Express app without binding a port, so tests can mount it on an
 * ephemeral port. `serveClient` serves the built `dist/` when it exists.
 */
export function createApp(opts: { serveClient?: boolean } = {}) {
  const app = express();
  app.use(express.json({ limit: "50mb" }));

  app.get("/api/health", (_req, res) => {
    res.json({
      ok: true,
      hasGeminiKey: Boolean(geminiApiKey()),
      hasOpenRouterKey: Boolean(process.env.OPENROUTER_API_KEY),
      demoMode: isDemoMode(),
    });
  });

  app.use("/api/extract", extractRouter);
  app.use("/api/diagrams", diagramsRouter);
  app.use("/api/live", liveRouter);

  // Unknown API routes get a JSON 404 instead of falling through to the SPA.
  app.use("/api", (_req, res) => {
    res.status(404).json({ error: "Not found." });
  });

  // In production, serve the built client from dist/.
  const distDir = join(__dirname, "..", "dist");
  if (opts.serveClient !== false && existsSync(distDir)) {
    app.use(express.static(distDir));
    app.get("*", (_req, res) => res.sendFile(join(distDir, "index.html")));
  }

  return app;
}
