import "dotenv/config";
import { createApp } from "./app.ts";
import { isDemoMode } from "./lib/demoMode.ts";

const PORT = Number(process.env.PORT ?? 3001);

const app = createApp();

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
