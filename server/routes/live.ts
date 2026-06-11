import { Router } from "express";
import {
  normalizeProcessGraph,
  validateProcessGraph,
  type ProcessGraph,
} from "@shared/processGraph.ts";
import { createSession, endSession, enqueue, getSession } from "../lib/liveSession.ts";
import { processChunk } from "../lib/liveOps.ts";

export const liveRouter = Router();

const EMPTY_GRAPH: ProcessGraph = {
  title: "Untitled process",
  actors: [],
  nodes: [],
  edges: [],
};

function validateBody(graph: unknown): { graph?: ProcessGraph; error?: string } {
  if (graph == null) return {};
  const normalized = normalizeProcessGraph(graph as ProcessGraph);
  const { ok, errors } = validateProcessGraph(normalized);
  if (!ok) return { error: `Invalid graph: ${errors.join("; ")}` };
  return { graph: normalized };
}

/**
 * POST /api/live/start
 * JSON: { graph?: ProcessGraph | null }
 * Opens a live session seeded with the current graph (or empty).
 */
liveRouter.post("/start", (req, res) => {
  const { graph, error } = validateBody((req.body as { graph?: unknown })?.graph);
  if (error) return res.status(400).json({ error });
  const session = createSession(graph ?? EMPTY_GRAPH);
  res.json({ sessionId: session.id, version: session.version });
});

/**
 * POST /api/live/chunk
 * JSON: { sessionId, chunk, graph, model? }
 * `graph` is the client's current (authoritative) graph; the server diffs it
 * against its mirror to pick up manual canvas edits. Returns the ops the
 * model emitted plus the updated server graph.
 */
liveRouter.post("/chunk", async (req, res) => {
  const { sessionId, chunk, graph, model } = req.body as {
    sessionId?: string;
    chunk?: string;
    graph?: unknown;
    model?: string;
  };
  if (!sessionId) return res.status(400).json({ error: "sessionId is required." });
  if (!chunk?.trim()) return res.status(400).json({ error: "chunk is required." });

  const session = getSession(sessionId);
  if (!session) return res.status(410).json({ error: "session_expired" });

  const validated = validateBody(graph);
  if (validated.error) return res.status(400).json({ error: validated.error });

  try {
    const result = await enqueue(session, () =>
      processChunk(session, { chunk, clientGraph: validated.graph, model }),
    );
    res.json(result);
  } catch (err) {
    res.status(500).json({ error: (err as Error).message });
  }
});

/** POST /api/live/end — idempotent session teardown. */
liveRouter.post("/end", (req, res) => {
  const { sessionId } = req.body as { sessionId?: string };
  if (sessionId) endSession(sessionId);
  res.status(204).end();
});
