# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## What this is

**Audit Process-Flow Mapper** — turns unstructured walkthrough material (pasted
transcripts, uploaded PDFs/Word docs/images, or live stakeholder conversation) into an
editable process-flow diagram on a canvas, for audit teams. Greenfield, runs on Replit
(Node.js 20).

## Commands

- `npm run dev` — run server (`tsx watch`, :3001) + Vite client (:5173, proxies `/api` → :3001) together.
- `npm run dev:server` / `npm run dev:client` — run either half alone.
- `npm run build` — Vite builds the client to `dist/`.
- `npm start` — production: serves the built `dist/` + API from Express on :3001.
- `npm run typecheck` — `tsc --noEmit` over server, client, shared, scripts.
- `npm run verify` — end-to-end extraction check against a fixture transcript. **Requires `ANTHROPIC_API_KEY`.**

Replit run button uses `npm run build && npm start` (single port 3001 → external 80).

## Required configuration

`ANTHROPIC_API_KEY` must be set (Replit secret or `.env`) or all extraction fails.
`/api/health` reports `hasApiKey`. See `.env.example`.

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
- `lib/anthropic.ts` — `extractGraph(inputs)` and `refineGraph(graph, chunk)`. Model
  `claude-opus-4-8`, adaptive thinking, structured output via `GRAPH_FORMAT`. The system
  prompt drives audit-grade extraction (actors → lanes, decisions, and **control points
  with the risk each addresses**).
- `lib/documents.ts` — maps an uploaded file to an extraction input: PDF → document block,
  `.docx` → text via `mammoth`, text/* → text, images → vision block.
- `routes/extract.ts` — `POST /api/extract` (multipart: `text` + `files`), `POST /api/extract/refine` (JSON, live mode).
- `routes/diagrams.ts` + `db.ts` — diagram CRUD over `better-sqlite3` (`diagrams.db`, gitignored).
- `index.ts` — wires routes, serves `dist/` in production.

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
  `App.tsx` debounces transcript chunks into `refineGraph` to grow the diagram as you speak.
- `App.tsx` — orchestrates state, extraction, view toggle, editing, save/load, export.

## Conventions / gotchas

- Imports use the `@shared/*` alias (tsconfig path + Vite alias). Server `.ts` imports keep
  explicit extensions (ESM + tsx).
- Node positions are view-specific: toggling flowchart ⇄ swimlane clears stored positions
  (`clearPositions`) so the new view auto-lays out.
- `better-sqlite3` is a native module; it built cleanly on Replit's Node 20.
- The Anthropic SDK must stay recent enough to type adaptive thinking + `output_config`
  (currently `^0.102.0`); older majors (≤0.40) will not typecheck.
