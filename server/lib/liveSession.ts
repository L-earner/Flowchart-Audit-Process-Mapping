// In-memory live-session store. Fine for the single-instance Replit
// deployment: the client carries the authoritative graph on every request, so
// losing a session (restart, TTL expiry, eviction) only loses conversation
// history — the client transparently starts a new session and continues.

import { randomUUID } from "node:crypto";
import type { ProcessGraph } from "@shared/processGraph.ts";
import { renderCompactGraph } from "@shared/graphOps.ts";
import type { ChatTurn } from "./liveTypes.ts";

export interface LiveSession {
  id: string;
  /** Server mirror of the graph; replaced by the client's copy each request. */
  graph: ProcessGraph;
  /** Provider-neutral conversation history (compact ops + notices, never full JSON). */
  history: ChatTurn[];
  /** Reasons from last turn's rejected/dropped ops, surfaced to the model next turn. */
  pendingRejected: string[];
  version: number;
  lastTouched: number;
  /** Per-session promise chain; serializes LLM calls for this session. */
  chain: Promise<unknown>;
}

const sessions = new Map<string, LiveSession>();
const MAX_SESSIONS = 50;
const IDLE_EXPIRY_MS = 60 * 60 * 1000;
const KEEP_TURNS = 6;

setInterval(() => {
  const now = Date.now();
  for (const [id, session] of sessions) {
    if (now - session.lastTouched > IDLE_EXPIRY_MS) sessions.delete(id);
  }
}, 10 * 60 * 1000).unref();

export function createSession(graph: ProcessGraph): LiveSession {
  if (sessions.size >= MAX_SESSIONS) {
    let oldest: LiveSession | undefined;
    for (const session of sessions.values()) {
      if (!oldest || session.lastTouched < oldest.lastTouched) oldest = session;
    }
    if (oldest) sessions.delete(oldest.id);
  }

  const empty = graph.nodes.length === 0 && graph.actors.length === 0;
  const session: LiveSession = {
    id: randomUUID(),
    graph,
    history: [
      {
        role: "user",
        text: empty
          ? "[Live walkthrough session started. The graph is empty — build it up as the speaker describes the process.]"
          : `[Live walkthrough session started. Current graph:]\n${renderCompactGraph(graph)}`,
      },
    ],
    pendingRejected: [],
    version: 0,
    lastTouched: Date.now(),
    chain: Promise.resolve(),
  };
  sessions.set(session.id, session);
  return session;
}

export function getSession(id: string): LiveSession | undefined {
  return sessions.get(id);
}

export function endSession(id: string): void {
  sessions.delete(id);
}

/** Serialize work per session: chunks are processed strictly in arrival order. */
export function enqueue<T>(session: LiveSession, fn: () => Promise<T>): Promise<T> {
  const run = session.chain.then(fn, fn);
  session.chain = run.then(
    () => undefined,
    () => undefined,
  );
  return run;
}

/** Rough token estimate (~3.5 chars/token for English + compact JSON). */
export function estimateTokens(text: string): number {
  return Math.ceil(text.length / 3.5);
}

export function historyTokens(session: LiveSession): number {
  return session.history.reduce((sum, turn) => sum + estimateTokens(turn.text), 0);
}

/**
 * Deterministic context compaction: when the history outgrows the threshold,
 * replace everything but the last few turns with a single synthetic user turn
 * holding the current graph in compact notation. The graph IS the state, so
 * no LLM summarization is needed — and the snapshot re-grounds the model,
 * self-healing any drift between its op history and the real graph.
 */
export function compactHistory(session: LiveSession): boolean {
  const threshold = Number(process.env.LIVE_COMPACT_TOKENS ?? 8000);
  if (historyTokens(session) <= threshold || session.history.length <= KEEP_TURNS + 1) {
    return false;
  }
  let tail = session.history.slice(-KEEP_TURNS);
  while (tail.length && tail[0].role !== "user") tail = tail.slice(1);
  session.history = [
    {
      role: "user",
      text: `[Context compacted. Current graph state:]\n${renderCompactGraph(session.graph)}\n[Continue the live walkthrough from the conversation below.]`,
    },
    ...tail,
  ];
  return true;
}
