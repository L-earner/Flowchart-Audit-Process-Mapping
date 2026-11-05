// HTTP-level tests against the real Express app on an ephemeral port, with an
// in-memory SQLite database. Only request paths that never reach a model are
// exercised, so no API key is needed.
import { test, before, after, afterEach } from "node:test";
import assert from "node:assert/strict";
import type { AddressInfo } from "node:net";
import type { Server } from "node:http";
import { sampleGraph, tinyGraph } from "./helpers.ts";

// db.ts opens the database at import time, so configure it before importing.
process.env.DB_PATH = ":memory:";
delete process.env.DEMO_MODE;
delete process.env.GEMINI_API_KEY;
delete process.env.GOOGLE_API_KEY;
delete process.env.OPENROUTER_API_KEY;
const { createApp } = await import("../server/app.ts");

let server: Server;
let base: string;

before(async () => {
  server = createApp({ serveClient: false }).listen(0);
  await new Promise<void>((resolve) => server.once("listening", () => resolve()));
  base = `http://127.0.0.1:${(server.address() as AddressInfo).port}`;
});
after(() => new Promise<void>((resolve) => server.close(() => resolve())));
afterEach(() => {
  delete process.env.DEMO_MODE;
});

async function call(method: string, path: string, body?: unknown) {
  const res = await fetch(base + path, {
    method,
    headers: body === undefined ? undefined : { "content-type": "application/json" },
    body: body === undefined ? undefined : JSON.stringify(body),
  });
  const text = await res.text();
  return { status: res.status, body: text ? JSON.parse(text) : null };
}

test("GET /api/health reports key and demo status", async () => {
  const res = await call("GET", "/api/health");
  assert.equal(res.status, 200);
  assert.deepEqual(res.body, {
    ok: true,
    hasGeminiKey: false,
    hasOpenRouterKey: false,
    demoMode: false,
  });
});

test("unknown API routes return JSON 404", async () => {
  const res = await call("GET", "/api/nope");
  assert.equal(res.status, 404);
  assert.equal(res.body.error, "Not found.");
});

test("diagram CRUD round-trip", async () => {
  const created = await call("POST", "/api/diagrams", { graph: sampleGraph(), viewMode: "swimlane" });
  assert.equal(created.status, 201);
  const id = created.body.diagram.id as string;
  assert.match(id, /^dg_/);
  assert.equal(created.body.diagram.viewMode, "swimlane");

  const list = await call("GET", "/api/diagrams");
  assert.ok(list.body.diagrams.some((d: { id: string }) => d.id === id));

  const renamed = { ...sampleGraph(), title: "P2P renamed" };
  const updated = await call("PUT", `/api/diagrams/${id}`, { graph: renamed, viewMode: "flowchart" });
  assert.equal(updated.status, 200);
  assert.equal(updated.body.diagram.title, "P2P renamed");

  const fetched = await call("GET", `/api/diagrams/${id}`);
  assert.equal(fetched.body.diagram.graph.title, "P2P renamed");
  assert.equal(fetched.body.diagram.viewMode, "flowchart");

  const deleted = await call("DELETE", `/api/diagrams/${id}`);
  assert.ok(deleted.status === 200 || deleted.status === 204);
  assert.equal((await call("GET", `/api/diagrams/${id}`)).status, 404);
});

test("saving an invalid graph is rejected with the validation errors", async () => {
  const bad = tinyGraph();
  bad.edges.push({ id: "e3", source: "p", target: "ghost" });
  const res = await call("POST", "/api/diagrams", { graph: bad });
  assert.equal(res.status, 400);
  assert.match(res.body.error, /edge e3 has unknown target ghost/);
});

test("a new control with a blank risk is backfilled on save, not rejected", async () => {
  const g = tinyGraph();
  g.nodes[1] = { ...g.nodes[1], type: "control", control: { controlType: "manual", riskAddressed: "" } };
  const res = await call("POST", "/api/diagrams", { graph: g });
  assert.equal(res.status, 201);
  assert.equal(res.body.diagram.graph.nodes[1].control.riskAddressed, "Not specified.");
});

test("extract with no input is a 400", async () => {
  const res = await call("POST", "/api/extract", {});
  assert.equal(res.status, 400);
  assert.match(res.body.error, /Provide some text or at least one file/);
});

test("extract with an unsupported upload is a 400, not a server error", async () => {
  const form = new FormData();
  form.append("files", new Blob([new Uint8Array([0, 1, 2])], { type: "application/zip" }), "archive.zip");
  const res = await fetch(base + "/api/extract", { method: "POST", body: form });
  assert.equal(res.status, 400);
  assert.match((await res.json()).error, /Unsupported file type/);
});

test("extract without an API key explains which key is missing", async () => {
  const res = await call("POST", "/api/extract", { text: "The clerk posts the invoice.", model: "gemini-3.8-flash" });
  assert.equal(res.status, 500);
  assert.match(res.body.error, /GEMINI_API_KEY is not set/);
});

test("refine validates its inputs before calling a model", async () => {
  assert.equal((await call("POST", "/api/extract/refine", { graph: tinyGraph() })).status, 400);
  const bad = tinyGraph();
  bad.nodes[1].actorId = "ghost";
  const res = await call("POST", "/api/extract/refine", { graph: bad, transcriptChunk: "add a step" });
  assert.equal(res.status, 400);
  assert.match(res.body.error, /Invalid current graph/);
});

test("live session lifecycle: start, validation, expiry, end", async () => {
  const started = await call("POST", "/api/live/start", { graph: tinyGraph() });
  assert.equal(started.status, 200);
  const { sessionId } = started.body;
  assert.equal(typeof sessionId, "string");

  assert.equal((await call("POST", "/api/live/chunk", { sessionId })).status, 400);
  const expired = await call("POST", "/api/live/chunk", { sessionId: "nope", chunk: "hi" });
  assert.equal(expired.status, 410);
  assert.equal(expired.body.error, "session_expired");

  assert.equal((await call("POST", "/api/live/end", { sessionId })).status, 204);
  assert.equal((await call("POST", "/api/live/chunk", { sessionId, chunk: "hi" })).status, 410);
});

test("live start rejects an invalid seed graph", async () => {
  const bad = tinyGraph();
  bad.nodes[0].actorId = "clerk";
  const res = await call("POST", "/api/live/start", { graph: bad });
  assert.equal(res.status, 400);
});

test("DEMO_MODE blocks every write and AI route but still allows reads", async () => {
  const seeded = await call("POST", "/api/diagrams", { graph: sampleGraph() });
  const id = seeded.body.diagram.id;
  process.env.DEMO_MODE = "true";

  const blocked = [
    await call("POST", "/api/diagrams", { graph: sampleGraph() }),
    await call("PUT", `/api/diagrams/${id}`, { graph: sampleGraph() }),
    await call("DELETE", `/api/diagrams/${id}`),
    await call("POST", "/api/extract", { text: "x" }),
    await call("POST", "/api/extract/refine", { graph: tinyGraph(), transcriptChunk: "x" }),
    await call("POST", "/api/live/start", {}),
    await call("POST", "/api/live/chunk", { sessionId: "x", chunk: "x" }),
  ];
  for (const res of blocked) {
    assert.equal(res.status, 403);
    assert.match(res.body.error, /read-only demo/);
  }

  assert.equal((await call("GET", "/api/health")).body.demoMode, true);
  assert.equal((await call("GET", `/api/diagrams/${id}`)).status, 200);
  assert.equal((await call("GET", "/api/diagrams")).status, 200);
});
