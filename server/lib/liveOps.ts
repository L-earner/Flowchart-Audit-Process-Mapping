// The per-chunk live pipeline: reconcile manual canvas edits, feed the
// transcript chunk to the model with managed history, apply the returned ops
// to the session mirror, and report everything back to the client.

import {
  applyOps,
  diffGraphs,
  type GraphOp,
} from "@shared/graphOps.ts";
import { normalizeProcessGraph, type ProcessGraph } from "@shared/processGraph.ts";
import { DEFAULT_MODEL_ID, providerFor } from "@shared/models.ts";
import { LIVE_SYSTEM_PROMPT } from "./prompts.ts";
import { parseOpsJson } from "./parse.ts";
import { generateOpsAnthropic } from "./providers/anthropic.ts";
import { generateOpsOpenRouter } from "./providers/openrouter.ts";
import { compactHistory, historyTokens, type LiveSession } from "./liveSession.ts";

export interface ChunkResult {
  /** Ops the client should apply (or, for undo_last, execute via its undo stack). */
  ops: GraphOp[];
  note?: string;
  rejected: string[];
  version: number;
  graph: ProcessGraph;
  usage: {
    historyTokensEstimate: number;
    cacheReadInputTokens: number | null;
    inputTokens: number;
    outputTokens: number;
  };
}

/** Render a manual-edit op as a short clause for the model notice. */
function describeOp(op: GraphOp): string {
  switch (op.op) {
    case "set_title": return `set the title to "${op.title}"`;
    case "set_summary": return "changed the summary";
    case "add_actor": return `added actor ${op.id} (${op.name})`;
    case "update_actor": return `updated actor ${op.id}${op.name ? ` (now "${op.name}")` : ""}`;
    case "delete_actor": return `deleted actor ${op.id}`;
    case "add_node": return `added node ${op.id} ("${op.label}")`;
    case "update_node": return `updated node ${op.id}${op.label ? ` (now "${op.label}")` : ""}`;
    case "delete_node": return `deleted node ${op.id}`;
    case "add_edge": return `added edge ${op.id} (${op.source} -> ${op.target})`;
    case "update_edge": return `updated edge ${op.id}`;
    case "delete_edge": return `deleted edge ${op.id}`;
    case "undo_last": return "undid the last change";
  }
}

export async function processChunk(
  session: LiveSession,
  opts: { chunk: string; clientGraph?: ProcessGraph; model?: string },
): Promise<ChunkResult> {
  const notices: string[] = [];

  // 1. Reconcile manual edits: the client graph is the source of truth. One
  // diff covers every canvas edit path (delete, rename, reconnect, undo, ...).
  if (opts.clientGraph) {
    const clientGraph = normalizeProcessGraph(opts.clientGraph);
    const manual = diffGraphs(session.graph, clientGraph);
    session.graph = clientGraph;
    if (manual.length) {
      notices.push(
        `[The user changed the canvas directly: ${manual
          .map(describeOp)
          .join("; ")}. This is authoritative — do not re-add deleted elements unless the speaker explicitly asks.]`,
      );
    }
  }

  // 2. Corrections from the previous turn's rejected ops.
  if (session.pendingRejected.length) {
    notices.push(
      `[Some of your previous ops were not applied: ${session.pendingRejected.join("; ")}. The graph state shown in this session is authoritative.]`,
    );
    session.pendingRejected = [];
  }

  // 3. Append the user turn and compact if the history has outgrown budget.
  const userText = [...notices, `Transcript: ${opts.chunk.trim()}`].join("\n\n");
  session.history.push({ role: "user", text: userText });
  compactHistory(session);

  // 4. Generate ops. On failure, withdraw the user turn so a client retry
  // doesn't duplicate it.
  const model =
    opts.model && opts.model.trim() ? opts.model : (process.env.LLM_MODEL ?? DEFAULT_MODEL_ID);
  let generation;
  try {
    generation =
      providerFor(model) === "openrouter"
        ? await generateOpsOpenRouter(model, LIVE_SYSTEM_PROMPT, session.history)
        : await generateOpsAnthropic(model, LIVE_SYSTEM_PROMPT, session.history);
  } catch (err) {
    session.history.pop();
    throw err;
  }

  // 5. Parse and apply. undo_last is executed client-side (it pops the
  // client's snapshot undo stack); the next request's graph sync brings the
  // reverted state back to the server, so we don't touch the mirror here.
  const parsed = parseOpsJson(generation.text);
  const undoRequested = parsed.ops.some((op) => op.op === "undo_last");
  const modelOps = undoRequested ? [] : parsed.ops;
  const { graph, applied, rejected } = applyOps(session.graph, modelOps);
  session.graph = graph;

  const rejectedDescriptions = [
    ...rejected.map((r) => `${r.op.op} — ${r.reason}`),
    ...parsed.dropped.map((d) => `malformed op — ${d.reason}`),
  ];
  session.pendingRejected = rejectedDescriptions;

  // 6. Record the assistant turn as the ops that actually applied, so the
  // history never claims a change that didn't happen.
  const responseOps: GraphOp[] = undoRequested ? [{ op: "undo_last" }] : applied;
  session.history.push({
    role: "assistant",
    text: JSON.stringify({ ops: responseOps, ...(parsed.note ? { note: parsed.note } : {}) }),
  });

  session.version += 1;
  session.lastTouched = Date.now();

  return {
    ops: responseOps,
    note: parsed.note,
    rejected: rejectedDescriptions,
    version: session.version,
    graph: session.graph,
    usage: {
      historyTokensEstimate: historyTokens(session),
      cacheReadInputTokens: generation.cacheReadInputTokens,
      inputTokens: generation.inputTokens,
      outputTokens: generation.outputTokens,
    },
  };
}
