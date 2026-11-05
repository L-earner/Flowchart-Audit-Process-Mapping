// The live-mode pipeline end to end, with the model call replaced by a stub —
// so session history, manual-edit notices, rejection feedback, undo, and
// compaction are all exercised without an API key.
import { test } from "node:test";
import assert from "node:assert/strict";
import { processChunk, type GenerateOps } from "../server/lib/liveOps.ts";
import { compactHistory, createSession, enqueue } from "../server/lib/liveSession.ts";
import type { ChatTurn } from "../server/lib/liveTypes.ts";
import { tinyGraph, sampleGraph } from "./helpers.ts";

/** A stub model that replays canned responses and records what it was sent. */
function stubModel(responses: unknown[]) {
  const calls: Array<{ model: string; system: string; history: ChatTurn[] }> = [];
  const generateOps: GenerateOps = async (model, system, history) => {
    calls.push({ model, system, history: structuredClone(history) });
    const next = responses.shift();
    if (next instanceof Error) throw next;
    return {
      text: typeof next === "string" ? next : JSON.stringify(next),
      cacheReadInputTokens: null,
      inputTokens: 0,
      outputTokens: 0,
    };
  };
  return { generateOps, calls };
}

test("applies the model's ops and records them as the assistant turn", async () => {
  const session = createSession(tinyGraph());
  const { generateOps, calls } = stubModel([
    {
      ops: [
        { op: "add_node", id: "check", type: "control", label: "Check", actorId: "clerk",
          control: { controlType: "detective", riskAddressed: "Errors" } },
        { op: "add_edge", id: "e3", source: "p", target: "check" },
      ],
    },
  ]);
  const result = await processChunk(session, { chunk: "then the clerk checks it", model: "claude-sonnet-4-6" }, { generateOps });

  assert.equal(result.version, 1);
  assert.equal(result.ops.length, 2);
  assert.deepEqual(result.rejected, []);
  assert.ok(result.graph.nodes.some((n) => n.id === "check"));
  assert.equal(calls[0].model, "claude-sonnet-4-6");
  assert.match(calls[0].history.at(-1)!.text, /Transcript: then the clerk checks it/);
  const last = session.history.at(-1)!;
  assert.equal(last.role, "assistant");
  assert.equal(JSON.parse(last.text).ops.length, 2);
});

test("manual canvas edits become an authoritative notice on the next turn", async () => {
  const session = createSession(tinyGraph());
  const { generateOps, calls } = stubModel([{ ops: [] }]);
  const edited = tinyGraph();
  edited.nodes[1].label = "Renamed by user";
  await processChunk(session, { chunk: "ok", clientGraph: edited }, { generateOps });
  assert.match(calls[0].history.at(-1)!.text, /The user changed the canvas directly: updated node p \(now "Renamed by user"\)/);
  assert.equal(session.graph.nodes[1].label, "Renamed by user");
});

test("rejected and malformed ops are reported and fed back next turn", async () => {
  const session = createSession(tinyGraph());
  const { generateOps, calls } = stubModel([
    { ops: [{ op: "delete_node", id: "ghost" }, { op: "explode" }] },
    { ops: [] },
  ]);
  const first = await processChunk(session, { chunk: "remove the ghost step" }, { generateOps });
  assert.deepEqual(first.rejected, [
    'delete_node — unknown node "ghost"',
    'malformed op — unknown op kind "explode"',
  ]);
  // The assistant turn only claims ops that actually applied.
  assert.deepEqual(JSON.parse(session.history.at(-1)!.text).ops, []);

  await processChunk(session, { chunk: "carry on" }, { generateOps });
  assert.match(calls[1].history.at(-1)!.text, /Some of your previous ops were not applied: delete_node — unknown node "ghost"/);
});

test("a voice undo comes back as a lone undo_last and leaves the graph alone", async () => {
  const session = createSession(tinyGraph());
  const { generateOps } = stubModel([
    { ops: [{ op: "undo_last" }, { op: "delete_node", id: "p" }] },
  ]);
  const result = await processChunk(session, { chunk: "undo that" }, { generateOps });
  assert.deepEqual(result.ops, [{ op: "undo_last" }]);
  assert.ok(result.graph.nodes.some((n) => n.id === "p"));
});

test("a failed model call withdraws the user turn so a retry doesn't duplicate it", async () => {
  const session = createSession(tinyGraph());
  const before = session.history.length;
  const { generateOps } = stubModel([new Error("provider down")]);
  await assert.rejects(processChunk(session, { chunk: "hello" }, { generateOps }), /provider down/);
  assert.equal(session.history.length, before);
  assert.equal(session.version, 0);
});

test("model output wrapped in prose/fences is still parsed", async () => {
  const session = createSession(tinyGraph());
  const { generateOps } = stubModel([
    'Here you go:\n```json\n{"ops":[{"op":"set_title","title":"Renamed"}],"note":"Title updated"}\n```',
  ]);
  const result = await processChunk(session, { chunk: "call it Renamed" }, { generateOps });
  assert.equal(result.graph.title, "Renamed");
  assert.equal(result.note, "Title updated");
});

test("history compaction replaces old turns with a compact graph snapshot", () => {
  const session = createSession(sampleGraph());
  for (let i = 0; i < 20; i++) {
    session.history.push({ role: "user", text: "Transcript: " + "words ".repeat(400) });
    session.history.push({ role: "assistant", text: '{"ops":[]}' });
  }
  const previous = process.env.LIVE_COMPACT_TOKENS;
  process.env.LIVE_COMPACT_TOKENS = "2000";
  try {
    assert.equal(compactHistory(session), true);
  } finally {
    if (previous === undefined) delete process.env.LIVE_COMPACT_TOKENS;
    else process.env.LIVE_COMPACT_TOKENS = previous;
  }
  assert.ok(session.history.length <= 7);
  assert.match(session.history[0].text, /^\[Context compacted\. Current graph state:\]\nTITLE: Purchase-to-Pay/);
  assert.equal(session.history[1].role, "user", "kept tail starts on a user turn");
});

test("enqueue runs a session's chunks strictly in order, even after a failure", async () => {
  const session = createSession(tinyGraph());
  const order: number[] = [];
  const slow = enqueue(session, async () => {
    await new Promise((r) => setTimeout(r, 20));
    order.push(1);
    throw new Error("boom");
  });
  const fast = enqueue(session, async () => {
    order.push(2);
    return "ok";
  });
  await assert.rejects(slow, /boom/);
  assert.equal(await fast, "ok");
  assert.deepEqual(order, [1, 2]);
});
