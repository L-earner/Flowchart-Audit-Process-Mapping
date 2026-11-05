// The Gemini provider against a local fake Gemini API (the SDK is pointed at
// it via GEMINI_BASE_URL), so request shape, response parsing, and error
// messages are tested without a real key or network.
import { test, before, after, beforeEach } from "node:test";
import assert from "node:assert/strict";
import express from "express";
import type { AddressInfo } from "node:net";
import type { Server } from "node:http";
import { PROCESS_GRAPH_SCHEMA } from "@shared/processGraph.ts";
import { LIVE_OPS_SCHEMA } from "@shared/graphOps.ts";
import { DEFAULT_MODEL_ID, MODELS, providerFor } from "@shared/models.ts";
import {
  generateGraphGemini,
  generateOpsGemini,
  geminiApiKey,
  resetGeminiClient,
} from "../server/lib/providers/gemini.ts";
import { sampleGraph } from "./helpers.ts";

interface Captured {
  path: string;
  key: string | undefined;
  body: {
    contents: Array<{ role: string; parts: Array<Record<string, unknown>> }>;
    systemInstruction: { parts: Array<{ text: string }> };
    generationConfig: Record<string, unknown>;
  };
}

let server: Server;
let requests: Captured[] = [];
let reply: { status: number; body: unknown } = { status: 200, body: {} };

const ok = (text: string, usage: Record<string, number> = {}) => ({
  status: 200,
  body: {
    candidates: [{ content: { role: "model", parts: [{ text }] }, finishReason: "STOP" }],
    usageMetadata: usage,
  },
});

before(async () => {
  const app = express();
  app.use(express.json({ limit: "20mb" }));
  app.post(/.*/, (req, res) => {
    requests.push({ path: req.path, key: req.get("x-goog-api-key"), body: req.body });
    res.status(reply.status).json(reply.body);
  });
  server = app.listen(0);
  await new Promise<void>((r) => server.once("listening", () => r()));
  process.env.GEMINI_BASE_URL = `http://127.0.0.1:${(server.address() as AddressInfo).port}`;
});
after(() => {
  delete process.env.GEMINI_BASE_URL;
  delete process.env.GEMINI_API_KEY;
  delete process.env.GOOGLE_API_KEY;
  return new Promise<void>((r) => server.close(() => r()));
});
beforeEach(() => {
  requests = [];
  process.env.GEMINI_API_KEY = "test-key";
  delete process.env.GOOGLE_API_KEY;
  resetGeminiClient();
});

test("the default model is a Gemini model and routes to the Gemini provider", () => {
  assert.equal(providerFor(DEFAULT_MODEL_ID), "gemini");
  assert.ok(MODELS.filter((m) => m.provider === "gemini").length >= 2);
  assert.equal(MODELS.some((m) => (m.provider as string) === "anthropic"), false);
  assert.equal(providerFor("gemini-9-future"), "gemini");
  assert.equal(providerFor("deepseek/deepseek-chat"), "openrouter");
});

test("either GEMINI_API_KEY or GOOGLE_API_KEY is accepted", () => {
  delete process.env.GEMINI_API_KEY;
  assert.equal(geminiApiKey(), undefined);
  process.env.GOOGLE_API_KEY = "google-key";
  assert.equal(geminiApiKey(), "google-key");
  process.env.GEMINI_API_KEY = "gemini-key";
  assert.equal(geminiApiKey(), "gemini-key", "GEMINI_API_KEY wins when both are set");
});

test("extraction sends the schema, system prompt, and PDF/image parts", async () => {
  reply = ok(JSON.stringify(sampleGraph()));
  const graph = await generateGraphGemini("gemini-3.8-flash", "SYSTEM PROMPT", [
    { kind: "text", text: "walkthrough notes" },
    { kind: "pdf", data: "JVBERi0=", filename: "procedure.pdf" },
    { kind: "image", data: "iVBORw0=", mediaType: "image/png" },
  ]);
  assert.equal(graph.nodes.length, 14);

  const [req] = requests;
  assert.equal(req.path, "/v1beta/models/gemini-3.8-flash:generateContent");
  assert.equal(req.key, "test-key");
  assert.equal(req.body.systemInstruction.parts[0].text, "SYSTEM PROMPT");
  assert.equal(req.body.generationConfig.responseMimeType, "application/json");
  assert.deepEqual(req.body.generationConfig.responseJsonSchema, JSON.parse(JSON.stringify(PROCESS_GRAPH_SCHEMA)));
  assert.equal(req.body.generationConfig.thinkingConfig, undefined, "extraction uses the model's default thinking");
  const parts = req.body.contents[0].parts;
  assert.deepEqual(parts[0], { text: "walkthrough notes" });
  assert.deepEqual(parts[1], { inlineData: { mimeType: "application/pdf", data: "JVBERi0=" } });
  assert.deepEqual(parts[2], { inlineData: { mimeType: "image/png", data: "iVBORw0=" } });
});

test("live ops send the history with model roles, low thinking, and report usage", async () => {
  reply = ok('{"ops":[{"op":"set_title","title":"X"}]}', {
    promptTokenCount: 120,
    candidatesTokenCount: 15,
    thoughtsTokenCount: 5,
    cachedContentTokenCount: 80,
  });
  const result = await generateOpsGemini("gemini-3.5-flash-lite", "LIVE", [
    { role: "user", text: "start" },
    { role: "assistant", text: '{"ops":[]}' },
    { role: "user", text: "Transcript: rename it X" },
  ]);
  assert.deepEqual(result, {
    text: '{"ops":[{"op":"set_title","title":"X"}]}',
    cacheReadInputTokens: 80,
    inputTokens: 120,
    outputTokens: 20,
  });
  const [req] = requests;
  assert.deepEqual(req.body.contents.map((c) => c.role), ["user", "model", "user"]);
  assert.deepEqual(req.body.generationConfig.thinkingConfig, { thinkingLevel: "LOW" });
  assert.deepEqual(req.body.generationConfig.responseJsonSchema, JSON.parse(JSON.stringify(LIVE_OPS_SCHEMA)));
});

test("a missing key gives a setup hint instead of a network error", async () => {
  delete process.env.GEMINI_API_KEY;
  resetGeminiClient();
  await assert.rejects(
    generateGraphGemini("gemini-3.8-flash", "S", [{ kind: "text", text: "x" }]),
    /GEMINI_API_KEY is not set.*aistudio\.google\.com\/apikey/,
  );
  assert.equal(requests.length, 0);
});

test("API errors become actionable messages", async () => {
  reply = {
    status: 400,
    body: { error: { code: 400, message: "API key not valid. Please pass a valid API key.", status: "INVALID_ARGUMENT" } },
  };
  await assert.rejects(generateGraphGemini("gemini-3.8-flash", "S", [{ kind: "text", text: "x" }]), /rejected the API key/);

  reply = { status: 404, body: { error: { code: 404, message: "models/gemini-old is not found", status: "NOT_FOUND" } } };
  await assert.rejects(generateGraphGemini("gemini-old", "S", [{ kind: "text", text: "x" }]), /doesn't recognise that model.*shared\/models\.ts/);
});

test("empty or truncated responses explain what happened", async () => {
  reply = { status: 200, body: { candidates: [{ content: { parts: [] }, finishReason: "MAX_TOKENS" }] } };
  await assert.rejects(generateGraphGemini("gemini-3.8-flash", "S", [{ kind: "text", text: "x" }]), /ran out of output tokens/);
  reply = { status: 200, body: { promptFeedback: { blockReason: "SAFETY" } } };
  await assert.rejects(generateOpsGemini("gemini-3.8-flash", "S", [{ role: "user", text: "x" }]), /blocked the request \(SAFETY\)/);
});
