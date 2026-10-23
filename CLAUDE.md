# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## What this is

**Audit Process-Flow Mapper** — turns unstructured walkthrough material (pasted
transcripts, uploaded PDFs/Word docs/images, or live stakeholder conversation) into an
editable process-flow diagram on a canvas, for audit teams. Greenfield, runs on Replit
(Node.js 22).

## Commands

- `npm run dev` — run server (`tsx watch`, :3001) + Vite client (:5173, proxies `/api` → :3001) together.
- `npm run dev:server` / `npm run dev:client` — run either half alone.
- `npm run build` — Vite builds the client to `dist/`.
- `npm start` — production: serves the built `dist/` + API from Express on :3001.
- `npm run typecheck` — `tsc --noEmit` over server, client, shared, scripts.
- `npm run verify` — end-to-end extraction check against a fixture transcript.
- `npm run verify:live` — end-to-end live-mode check: replays the fixture in chunks through the incremental-ops pipeline (plus voice-command, undo, manual-edit, and compaction tests).

Both verify scripts **require the API key for the selected provider** (default model → `ANTHROPIC_API_KEY`); `LLM_MODEL=<id>` overrides the model. Run them when extraction, prompts, schemas, parsing, or providers change. Before submitting changes, run `npm run typecheck && npm run build`.

Replit run button uses `npm run build && npm start` (single port 3001 → external 80).

## Required configuration

Extraction runs through a **selectable model** (picker in the UI sidebar). You need a key
for whichever provider the chosen model belongs to:

- `ANTHROPIC_API_KEY` — for Claude models (`claude-opus-4-8`, `claude-sonnet-4-6`).
- `OPENROUTER_API_KEY` — for models via OpenRouter (OpenAI GPT / gpt-oss, DeepSeek, Llama, Qwen, Mistral).

Set as Replit secrets or in `.env` (see `.env.example`). `/api/health` reports
`hasAnthropicKey` / `hasOpenRouterKey`. `LLM_MODEL` sets the default model when the request
doesn't specify one; `DB_PATH` overrides the SQLite location.

`DEMO_MODE=true` puts the server in public read-only demo mode: `demoModeGuard`
(`server/lib/demoMode.ts`) returns 403 on diagram create/update/delete, extract, refine, and
live start/chunk, regardless of whether API keys are set.

## Architecture — the one thing to understand first

Everything flows through a single canonical data model, **`ProcessGraph`**, defined once
in **`shared/processGraph.ts`** along with its JSON Schema (`PROCESS_GRAPH_SCHEMA`):

- **Claude emits it** via structured outputs (`output_config.format` + the schema).
- **The DB stores it** as a JSON blob.
- **Both diagram views render from it** (flowchart and swimlane are two layouts of the same graph).
- **On-canvas edits mutate it** (helpers in `client/src/lib/graphEdit.ts`).

The schema and the TypeScript types live in the same file deliberately, so they can't drift.
`validateProcessGraph()` there is the shared runtime check used by both server routes and
the verify script.

### Server (`server/`, Express + tsx, ESM `.ts` imports)

**Pluggable LLM providers.** The model id selects the provider (`shared/models.ts` →
`providerFor`). All extraction goes through `lib/llm.ts` (`extractGraph(inputs, modelId?)`,
`refineGraph(graph, chunk, modelId?)`), which dispatches to:
- `lib/providers/anthropic.ts` — Anthropic SDK, adaptive thinking, **schema-enforced**
  structured output (`output_config.format`). Supports text, PDF, and images.
- `lib/providers/openrouter.ts` — OpenAI-compatible `chat/completions` over `fetch`, using
  `response_format: json_schema`; output is also parsed and validated locally.
  Text always; images only on vision-capable models; PDFs are rejected with a clear message.

Shared pieces: `lib/inputs.ts` (`ExtractInput`), `lib/prompts.ts` (system prompt + refine
addendum), `lib/parse.ts` (`parseGraphJson` — lenient parse, strips
code fences / extracts the outermost `{…}`, then `validateProcessGraph`).

The audit-grade system prompt (actors → lanes, decisions, optional **control points with the risk
each addresses**) lives in `lib/prompts.ts` and is shared by both providers.

- `lib/documents.ts` — maps an uploaded file to an `ExtractInput`: PDF → document block,
  `.docx` → text via `mammoth`, text/* → text, images → image block.
- `routes/extract.ts` — `POST /api/extract` (multipart: `text` + `files`), `POST /api/extract/refine` (JSON, used by the RefinePanel's full-graph update).
- `routes/diagrams.ts` + `db.ts` — diagram CRUD over `better-sqlite3` (`diagrams.db`, gitignored).
- `index.ts` — wires routes, serves `dist/` in production.

**Live mode (incremental ops).** The Live tab does NOT use refine. The model emits
small **graph operations** (`shared/graphOps.ts`: `GraphOp`, `LIVE_OPS_SCHEMA`,
`applyOps`, `diffGraphs`, `renderCompactGraph`) instead of regenerating the graph:

- `routes/live.ts` — `POST /api/live/start` (open a session seeded with the current
  graph), `POST /api/live/chunk` (`{sessionId, chunk, graph, model?}` → `{ops, note?,
  rejected, version, graph}`; unknown session → **410 `session_expired`**, the client
  transparently restarts), `POST /api/live/end`.
- `lib/liveSession.ts` — in-memory session store (TTL-swept; fine because the **client
  graph is the source of truth** and rides along on every chunk request). Holds the
  provider-neutral message history; `compactHistory` replaces old turns with a compact
  graph snapshot when the history exceeds `LIVE_COMPACT_TOKENS` (default 8000) — the
  graph IS the state, so no LLM summarization is needed.
- `lib/liveOps.ts` — per-chunk pipeline: `diffGraphs(sessionMirror, clientGraph)` turns
  manual canvas edits into model notices (so deleted nodes are never resurrected),
  rejected-op corrections are fed back the next turn, `applyOps` applies with per-op
  skip. The full graph JSON never enters model context — only compact notation.
- Providers expose `generateOps*` alongside `generateGraph*`; the Anthropic path uses
  prompt-cache breakpoints on the frozen `LIVE_SYSTEM_PROMPT` + last message, and
  `output_config.effort: "low"` for latency (bump to "medium" if narration gets
  under-extracted).
- Client (`App.tsx`): single-flight chunk sender (2.5s debounce, immediate flush over
  ~400 buffered chars); applies returned ops to the *current* graph so edits made while
  a request is in flight survive; a voice "undo that" comes back as a lone `undo_last`
  op and runs the existing snapshot undo stack.

### Client (`client/`, React + Vite + `@xyflow/react`)
- `lib/api.ts` — typed fetch wrappers for every endpoint.
- `lib/layout.ts` — dagre auto-layout. Flowchart = top-down; swimlane = LR rank order with
  nodes snapped into per-actor bands. **Swimlane lanes are rendered as background React Flow
  nodes** (ids prefixed `lane__`, non-interactive) so they pan/zoom with the content.
- `components/Canvas.tsx` — the React Flow canvas; persists node-drag positions and new
  connections back to the graph. Custom node types in `components/nodes/`.
- `components/InputPanel.tsx` — Paste / Upload / Live tabs.
- `components/NodeInspector.tsx` — edit the selected node (label, type, actor, control details).
- `lib/liveTranscribe.ts` — Web Speech API wrapper for the Live tab (Chrome/Edge only);
  transcript chunks feed the live-ops pipeline described above (not refine).
- `lib/graphDiff.ts` — client-side `summarizeChange(prev, next)`: a human-readable count of
  what an AI "Update current map" changed, shown so the user can keep or undo. **Not the same
  as `diffGraphs` in `shared/graphOps.ts`** (which produces model notices for live mode).
- `lib/graphQuality.ts` — `assessGraph`: heuristic quality score + warnings (start/end nodes,
  disconnected nodes, controls, decisions) surfaced in the UI.
- `App.tsx` — orchestrates state, extraction, view toggle, editing, save/load, export.

## Conventions / gotchas

- Imports use the `@shared/*` alias (tsconfig path + Vite alias). Server `.ts` imports keep
  explicit extensions (ESM + tsx).
- No formatter or linter is configured — match the surrounding style (two-space indent,
  double quotes, semicolons) and rely on `npm run typecheck`.
- Node positions are view-specific: toggling flowchart ⇄ swimlane clears stored positions
  (`clearPositions`) so the new view auto-lays out.
- `better-sqlite3` is a native module; a `postinstall` script (`npm rebuild better-sqlite3`)
  rebuilds it after install so it matches the running Node version.
- The Anthropic SDK must stay recent enough to type adaptive thinking + `output_config`
  (currently `^0.102.0`); older majors (≤0.40) will not typecheck.
- To add/replace an OpenRouter model, edit `shared/models.ts` (`MODELS`) — set `vision: true`
  only if the model accepts images. The client picker and server routing both read this list.
- Open models vary in JSON reliability; `parseGraphJson` is deliberately lenient. If a
  particular model returns malformed graphs often, prefer one known to support structured
  output, or switch to a Claude model.
