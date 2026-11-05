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
- `npm run typecheck` — `tsc --noEmit` over server, client, shared, scripts, tests.
- `npm test` — offline test suite (`node:test` via `tsx --test`, files in `tests/`). **Needs no API keys**: the
  API tests mount `createApp()` on an ephemeral port with `DB_PATH=:memory:`, and the live-pipeline tests inject a
  stub model via `processChunk(session, opts, { generateOps })`.
- `npm run check:lockfile` — fails if `package-lock.json` pins packages to a private mirror (see gotchas).
- `npm run check` — everything CI runs: lockfile check, typecheck, tests, build.
- `npm run verify` — end-to-end extraction check against a fixture transcript.
- `npm run verify:live` — end-to-end live-mode check: replays the fixture in chunks through the incremental-ops pipeline (plus voice-command, undo, manual-edit, and compaction tests).

Both verify scripts **require the API key for the selected provider** (default model → `GEMINI_API_KEY`); `LLM_MODEL=<id>` overrides the model. Run them when extraction, prompts, schemas, parsing, or providers change. Before submitting changes, run `npm run check`
(GitHub Actions runs the same steps on Ubuntu and Windows for every push to `main` and every PR —
`.github/workflows/ci.yml`).

Replit run button uses `npm run build && npm start` (single port 3001 → external 80).

## Required configuration

Extraction runs through a **selectable model** (picker in the UI sidebar). You need a key
for whichever provider the chosen model belongs to:

- `GEMINI_API_KEY` (or `GOOGLE_API_KEY`) — for Google Gemini models (`gemini-3.8-flash` default, `gemini-4-argon`,
  `gemini-3.5-flash-lite`). Keys come from Google AI Studio (aistudio.google.com/apikey).
- `OPENROUTER_API_KEY` — for models via OpenRouter (OpenAI GPT / gpt-oss, DeepSeek, Llama, Qwen, Mistral).

Set as Replit secrets or in `.env` (see `.env.example`). `/api/health` reports
`hasGeminiKey` / `hasOpenRouterKey`. `LLM_MODEL` sets the default model when the request
doesn't specify one; `DB_PATH` overrides the SQLite location.

`DEMO_MODE=true` puts the server in public read-only demo mode: `demoModeGuard`
(`server/lib/demoMode.ts`) returns 403 on diagram create/update/delete, extract, refine, and
live start/chunk, regardless of whether API keys are set.

## Architecture — the one thing to understand first

Everything flows through a single canonical data model, **`ProcessGraph`**, defined once
in **`shared/processGraph.ts`** along with its JSON Schema (`PROCESS_GRAPH_SCHEMA`):

- **The model emits it** via structured outputs (Gemini `responseJsonSchema` / OpenRouter `json_schema` + the schema).
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
- `lib/providers/gemini.ts` — official `@google/genai` SDK; **schema-constrained** output
  (`responseMimeType: application/json` + `responseJsonSchema`), model-default thinking for extraction. Supports text,
  PDF, and images (`inlineData`). `GEMINI_BASE_URL` points the SDK at a fake server in tests — leave it unset.
  Errors (bad key, unknown model id, 429, MAX_TOKENS, safety blocks) are mapped to actionable messages.
- `lib/providers/openrouter.ts` — OpenAI-compatible `chat/completions` over `fetch`, using
  `response_format: json_schema`; output is also parsed and validated locally.
  Text always; images only on vision-capable models; PDFs are rejected with a clear message.

Shared pieces: `lib/inputs.ts` (`ExtractInput`), `lib/prompts.ts` (system prompt + refine
addendum), `lib/parse.ts` (`parseGraphJson` — lenient parse, strips
code fences / extracts the outermost `{…}`, then `validateProcessGraph`).

The audit-grade system prompt (actors → lanes, decisions, optional **control points with the risk
each addresses**) lives in `lib/prompts.ts` and is shared by both providers.

**Evidence + open points (extraction/refine only).** `PROCESS_GRAPH_SCHEMA` asks for an optional `source` per
node (short **verbatim** quote from the material) and a required `openPoints` list (`gap` / `ambiguity` /
`assumption`, each with `issue`, a follow-up `question` for the process owner, and `nodeId` or null). The guidance
is `REVIEW_GUIDELINES` in `prompts.ts`, appended to `SYSTEM_PROMPT` only — **not** to `CORE_GUIDELINES`, because
live mode emits ops that carry neither (and the live prompt is a cache prefix). `normalizeProcessGraph` tidies open
points (drops empties, nulls references to deleted steps). Older graphs simply have no `openPoints`; the UI hides
the panel for them. `npm run verify` now also checks quotes are verbatim and prints the open points.

- `lib/documents.ts` — maps an uploaded file to an `ExtractInput`: PDF → document block,
  `.docx` → text via `mammoth`, text/* → text, images → image block.
- `routes/extract.ts` — `POST /api/extract` (multipart: `text` + `files`), `POST /api/extract/refine` (JSON, used by the RefinePanel's full-graph update).
- `routes/diagrams.ts` + `db.ts` — diagram CRUD over `better-sqlite3` (`diagrams.db`, gitignored).
- `app.ts` — `createApp()` wires routes (unknown `/api/*` → JSON 404) and serves `dist/` when built; it does not
  listen, so tests can mount it. `index.ts` listens on `PORT`; `start.ts` is the production entry (`npm start`),
  which sets `NODE_ENV` in code so it works in Windows shells too.

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
- Providers expose `generateOps*` alongside `generateGraph*`; the Gemini path sends the history as
  `user`/`model` turns with `thinkingConfig.thinkingLevel: LOW` for latency (bump to MEDIUM if narration gets
  under-extracted). Gemini caches repeated prompt prefixes implicitly, so the frozen `LIVE_SYSTEM_PROMPT` is reused
  without explicit breakpoints; `cachedContentTokenCount` is reported as `cacheReadInputTokens`.
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
  **Camera framing:** there is no React Flow `fitView` on mount. `AutoFrame` frames the view whenever the
  `fitKey` prop changes (App bumps it on load, extract, and view toggle — not on edits) using
  `lib/viewport.ts` `readableViewport()`: fit the whole map only if the zoom stays ≥ 0.7, otherwise open at a
  readable zoom (0.85, or 0.65 on phone-width panes) on the lane names / start node. "Fit entire map" still
  shows everything. **`LaneRail`** pins lane names to the left edge when the in-diagram label column scrolls
  away or gets tiny; it sits outside `.react-flow__viewport`, so PNG export doesn't include it.
- `components/InputPanel.tsx` — Paste / Upload / Live tabs.
- `components/NodeInspector.tsx` — edit the selected node (label, type, actor, control details).
- `lib/liveTranscribe.ts` — Web Speech API wrapper for the Live tab (Chrome/Edge only);
  transcript chunks feed the live-ops pipeline described above (not refine).
- `lib/graphDiff.ts` — client-side `summarizeChange(prev, next)`: a human-readable count of
  what an AI "Update current map" changed, shown so the user can keep or undo. **Not the same
  as `diffGraphs` in `shared/graphOps.ts`** (which produces model notices for live mode).
- `lib/graphQuality.ts` — `assessGraph`: heuristic quality score + warnings (start/end nodes,
  disconnected nodes, controls, decisions) surfaced in the UI.
- **Audit outputs** (header **Export ▾** menu, `components/ExportMenu.tsx`), all generated from the graph with no
  model call:
  - `lib/flowOrder.ts` — `flowOrder(graph)`: steps in reading order (longest path from start, back-edges ignored,
    end last). Control numbering, the RCM, and the narrative all use it so they agree.
  - `lib/controlIds.ts` — `assignControlIds(graph, previous?)`: stable `control.controlId` refs (C-01…). Called in
    App's `update()` (so every edit path, including AI refine and live ops, keeps ids) and on extract/load/import.
    `controlId` is **not** in the model schemas — models never mint ids; `applyOps` `update_node` preserves the
    existing id, and `renderCompactGraph` shows it so a speaker can say "remove C-02".
  - `lib/rcm.ts` — Risk & Control Matrix rows + numbered step list; Excel (`write-excel-file`, lazy-loaded) and CSV.
  - `lib/narrative.ts` — written narrative (numbered steps, decisions with branches, key controls) → Word (`docx`,
    lazy-loaded).
  - `lib/importJson.ts` — header **Import** accepts the JSON export (bare graph) or `{ graph, viewMode }`.
  - `lib/exportImage.ts` — PNG renders the full map at 100% regardless of camera.
- `components/OpenPointsPanel.tsx` + `lib/openPoints.ts` — the open points log (ordered by process, "Copy
  questions" as a numbered list for the process owner, "Mark resolved" = undoable removal, step links pan the
  canvas via Canvas's `focusRequest`). Steps with open points get a "?" flag; the inspector shows the source quote.
  Open points also go into the Word narrative and a third "Open points" sheet (with a blank Response column) in the
  RCM workbook.
- `App.tsx` — orchestrates state, extraction, view toggle, editing, save/load, import/export.

## Conventions / gotchas

- Imports use the `@shared/*` alias (tsconfig path + Vite alias). Server `.ts` imports keep
  explicit extensions (ESM + tsx).
- No formatter or linter is configured — match the surrounding style (two-space indent,
  double quotes, semicolons) and rely on `npm run typecheck`.
- Node positions are view-specific: toggling flowchart ⇄ swimlane clears stored positions
  (`clearPositions`) so the new view auto-lays out.
- **Lockfile is registry-agnostic.** `.npmrc` sets `omit-lockfile-registry-resolved=true`, so `package-lock.json`
  carries no `resolved` URLs and `npm ci` works against whatever registry is configured (public npm, Replit's
  mirror, a corporate proxy). Previously every entry pointed at `package-firewall.replit.local`, which broke installs
  anywhere but Replit. If `npm run check:lockfile` fails, run `npm install --package-lock-only` and commit.
- `better-sqlite3` is a native module; a `postinstall` script (`npm rebuild better-sqlite3`)
  rebuilds it after install so it matches the running Node version.
- Gemini model ids change often (Google retires preview ids). If one starts returning 404, update it in
  `shared/models.ts`; current ids are listed at ai.google.dev/gemini-api/docs/models. `@google/genai` must stay
  recent enough to type `responseJsonSchema` and `ThinkingLevel` (currently `^2.32.0`).
- To add/replace an OpenRouter model, edit `shared/models.ts` (`MODELS`) — set `vision: true`
  only if the model accepts images. The client picker and server routing both read this list.
- Open models vary in JSON reliability; `parseGraphJson` is deliberately lenient. If a
  particular model returns malformed graphs often, prefer one known to support structured
  output, or switch to a Gemini model.
