import "dotenv/config";
import express from "express";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";
import { existsSync } from "node:fs";
import { extractRouter } from "./routes/extract.ts";
import { diagramsRouter } from "./routes/diagrams.ts";
import { liveRouter } from "./routes/live.ts";
import { isDemoMode } from "./lib/demoMode.ts";

const __dirname = dirname(fileURLToPath(import.meta.url));
const PORT = Number(process.env.PORT ?? 3001);

const app = express();
app.use(express.json({ limit: "50mb" }));

app.get("/api/health", (_req, res) => {
  res.json({
    ok: true,
    hasAnthropicKey: Boolean(process.env.ANTHROPIC_API_KEY),
    hasOpenRouterKey: Boolean(process.env.OPENROUTER_API_KEY),
    demoMode: isDemoMode(),
  });
});

app.use("/api/extract", extractRouter);
app.use("/api/diagrams", diagramsRouter);
app.use("/api/live", liveRouter);

// In production, serve the built client from dist/.
const distDir = join(__dirname, "..", "dist");
if (existsSync(distDir)) {
  app.use(express.static(distDir));
  app.get("*", (_req, res) => res.sendFile(join(distDir, "index.html")));
}

app.listen(PORT, () => {
  console.log(`[server] listening on http://localhost:${PORT}`);
  if (isDemoMode()) {
    console.log("[server] DEMO_MODE is on — saving, deleting, and AI extraction are disabled.");
  } else if (!process.env.ANTHROPIC_API_KEY && !process.env.OPENROUTER_API_KEY) {
    console.warn(
      "[server] WARNING: no ANTHROPIC_API_KEY or OPENROUTER_API_KEY set — extraction will fail until one is.",
    );
  }
});
