// Graph operations: the incremental-edit protocol for live mode.
// The model emits small ops (diffs) instead of regenerating the whole graph;
// the server applies them to its session mirror and the client applies the
// same ops to the canvas graph. applyOps/diffGraphs are deliberately pure and
// shared so both sides mutate identically. Ops never touch node positions, so
// manual layout always survives a live update.

import {
  CONTROL_INFO_SCHEMA,
  NODE_TYPES,
  normalizeProcessGraph,
  validateProcessGraph,
  type ControlInfo,
  type NodeType,
  type ProcessGraph,
} from "./processGraph.ts";

export type GraphOp =
  | { op: "set_title"; title: string }
  | { op: "set_summary"; summary: string }
  | { op: "add_actor"; id: string; name: string; description?: string }
  | { op: "update_actor"; id: string; name?: string; description?: string }
  | { op: "delete_actor"; id: string }
  | {
      op: "add_node";
      id: string;
      type: NodeType;
      label: string;
      actorId?: string | null;
      description?: string;
      control?: ControlInfo;
    }
  | {
      op: "update_node";
      id: string;
      type?: NodeType;
      label?: string;
      actorId?: string | null;
      description?: string;
      control?: ControlInfo;
    }
  | { op: "delete_node"; id: string }
  | { op: "add_edge"; id: string; source: string; target: string; label?: string }
  | { op: "update_edge"; id: string; source?: string; target?: string; label?: string }
  | { op: "delete_edge"; id: string }
  /** Voice "undo that" — executed by the client's undo stack, never by applyOps. */
  | { op: "undo_last" };

export type GraphOpKind = GraphOp["op"];

export const GRAPH_OP_KINDS: GraphOpKind[] = [
  "set_title",
  "set_summary",
  "add_actor",
  "update_actor",
  "delete_actor",
  "add_node",
  "update_node",
  "delete_node",
  "add_edge",
  "update_edge",
  "delete_edge",
  "undo_last",
];

/** What the model returns each live turn. */
export interface LiveOpsPayload {
  ops: GraphOp[];
  note?: string;
}

// ---------------------------------------------------------------------------
// JSON Schema for structured output. A single flat op object (only `op`
// required) rather than a discriminated union — it behaves identically on
// Anthropic output_config.format and OpenRouter response_format json_schema
// (strict:false), and open models handle it far better than a 12-way oneOf.
// Semantic validation (do the ids exist, are required fields present) happens
// in applyOps regardless.
// ---------------------------------------------------------------------------
export const LIVE_OPS_SCHEMA = {
  type: "object",
  properties: {
    ops: {
      type: "array",
      description:
        "Edits to apply to the current graph, in order. Empty if the speech contains no new process information or instruction.",
      items: {
        type: "object",
        properties: {
          op: { type: "string", enum: GRAPH_OP_KINDS },
          id: {
            type: "string",
            description:
              "Target element id (existing) or new id (stable lowercase slug).",
          },
          title: { type: "string" },
          summary: { type: "string" },
          name: { type: "string", description: "Actor name." },
          description: { type: "string" },
          type: { type: "string", enum: NODE_TYPES },
          label: { type: "string", description: "Node or edge label." },
          actorId: {
            type: ["string", "null"],
            description: "Owning actor id; null only for start/end nodes.",
          },
          control: CONTROL_INFO_SCHEMA,
          source: { type: "string", description: "Edge source node id." },
          target: { type: "string", description: "Edge target node id." },
        },
        required: ["op"],
        additionalProperties: false,
      },
    },
    note: {
      type: "string",
      description:
        "Optional very short status line for the user (<=120 chars). Only when genuinely useful.",
    },
  },
  required: ["ops"],
  additionalProperties: false,
} as const;

export interface RejectedOp {
  op: GraphOp;
  reason: string;
}

export interface ApplyOpsResult {
  graph: ProcessGraph;
  applied: GraphOp[];
  rejected: RejectedOp[];
}

const DEFAULT_CONTROL: ControlInfo = {
  controlType: "manual",
  riskAddressed: "Not specified.",
};

/**
 * Apply ops sequentially with per-op skip: an op whose references are invalid
 * is rejected (with a reason fed back to the model next turn) without
 * aborting the rest of the batch. Mirrors graphEdit.ts invariants: deleting a
 * node cascades its edges, start/end nodes have actorId null, control nodes
 * always carry a control object.
 */
export function applyOps(graph: ProcessGraph, ops: GraphOp[]): ApplyOpsResult {
  let g: ProcessGraph = {
    ...graph,
    actors: [...graph.actors],
    nodes: [...graph.nodes],
    edges: [...graph.edges],
  };
  const applied: GraphOp[] = [];
  const rejected: RejectedOp[] = [];

  const actor = (id: string) => g.actors.find((a) => a.id === id);
  const node = (id: string) => g.nodes.find((n) => n.id === id);
  const edge = (id: string) => g.edges.find((e) => e.id === id);

  for (const op of ops) {
    const reason = applyOne(op);
    if (reason === null) applied.push(op);
    else rejected.push({ op, reason });
  }

  function applyOne(op: GraphOp): string | null {
    switch (op.op) {
      case "undo_last":
        return "undo_last is executed by the client, not applied to the graph";

      case "set_title":
        if (!op.title?.trim()) return "title is empty";
        g = { ...g, title: op.title.trim() };
        return null;

      case "set_summary":
        g = { ...g, summary: op.summary ?? "" };
        return null;

      case "add_actor": {
        if (!op.id?.trim()) return "actor id missing";
        if (!op.name?.trim()) return "actor name missing";
        if (actor(op.id)) {
          // Idempotent: re-adding an existing actor becomes an update.
          g = {
            ...g,
            actors: g.actors.map((a) =>
              a.id === op.id
                ? { ...a, name: op.name, ...(op.description !== undefined ? { description: op.description } : {}) }
                : a,
            ),
          };
          return null;
        }
        g = {
          ...g,
          actors: [
            ...g.actors,
            { id: op.id, name: op.name, ...(op.description !== undefined ? { description: op.description } : {}) },
          ],
        };
        return null;
      }

      case "update_actor": {
        if (!op.id || !actor(op.id)) return `unknown actor "${op.id ?? ""}"`;
        g = {
          ...g,
          actors: g.actors.map((a) =>
            a.id === op.id
              ? {
                  ...a,
                  ...(op.name?.trim() ? { name: op.name } : {}),
                  ...(op.description !== undefined ? { description: op.description } : {}),
                }
              : a,
          ),
        };
        return null;
      }

      case "delete_actor": {
        if (!op.id || !actor(op.id)) return `unknown actor "${op.id ?? ""}"`;
        const remaining = g.actors.filter((a) => a.id !== op.id);
        const fallback = remaining[0]?.id;
        const orphaned = g.nodes.some(
          (n) => n.actorId === op.id && n.type !== "start" && n.type !== "end",
        );
        if (orphaned && !fallback) {
          return `cannot delete actor "${op.id}": its steps would have no lane`;
        }
        g = {
          ...g,
          actors: remaining,
          nodes: g.nodes.map((n) =>
            n.actorId === op.id ? { ...n, actorId: fallback ?? null } : n,
          ),
        };
        return null;
      }

      case "add_node": {
        if (!op.id?.trim()) return "node id missing";
        if (node(op.id)) {
          // Idempotent: re-adding becomes an update.
          return applyOne({ ...op, op: "update_node" });
        }
        if (!op.type || !NODE_TYPES.includes(op.type)) {
          return `node "${op.id}" has invalid type "${String(op.type)}"`;
        }
        if (!op.label?.trim()) return `node "${op.id}" has no label`;
        const terminal = op.type === "start" || op.type === "end";
        let actorId: string | null;
        if (terminal) {
          actorId = null;
        } else if (typeof op.actorId === "string" && actor(op.actorId)) {
          actorId = op.actorId;
        } else if (g.actors[0]) {
          actorId = g.actors[0].id;
        } else {
          return `node "${op.id}" needs an actor but none exist; add_actor first`;
        }
        g = {
          ...g,
          nodes: [
            ...g.nodes,
            {
              id: op.id,
              type: op.type,
              label: op.label,
              actorId,
              ...(op.description !== undefined ? { description: op.description } : {}),
              ...(op.type === "control" ? { control: op.control ?? DEFAULT_CONTROL } : {}),
            },
          ],
        };
        return null;
      }

      case "update_node": {
        if (!op.id || !node(op.id)) return `unknown node "${op.id ?? ""}"`;
        const current = node(op.id)!;
        const nextType = op.type && NODE_TYPES.includes(op.type) ? op.type : current.type;
        const terminal = nextType === "start" || nextType === "end";
        let actorId = current.actorId;
        if (op.actorId !== undefined) {
          if (op.actorId === null) {
            if (!terminal) return `node "${op.id}" must keep an actor (only start/end may have none)`;
            actorId = null;
          } else if (actor(op.actorId)) {
            actorId = op.actorId;
          } else {
            return `unknown actor "${op.actorId}" for node "${op.id}"`;
          }
        }
        if (terminal) actorId = null;
        else if (actorId === null) {
          if (!g.actors[0]) return `node "${op.id}" needs an actor but none exist`;
          actorId = g.actors[0].id;
        }
        const next = {
          ...current,
          type: nextType,
          actorId,
          ...(op.label?.trim() ? { label: op.label } : {}),
          ...(op.description !== undefined ? { description: op.description } : {}),
        };
        if (nextType === "control") {
          next.control = op.control ?? current.control ?? DEFAULT_CONTROL;
        } else {
          delete next.control;
        }
        g = { ...g, nodes: g.nodes.map((n) => (n.id === op.id ? next : n)) };
        return null;
      }

      case "delete_node": {
        if (!op.id || !node(op.id)) return `unknown node "${op.id ?? ""}"`;
        g = {
          ...g,
          nodes: g.nodes.filter((n) => n.id !== op.id),
          edges: g.edges.filter((e) => e.source !== op.id && e.target !== op.id),
        };
        return null;
      }

      case "add_edge": {
        if (!op.id?.trim()) return "edge id missing";
        if (edge(op.id)) return applyOne({ ...op, op: "update_edge" });
        if (!op.source || !node(op.source)) return `edge "${op.id}" has unknown source "${op.source ?? ""}"`;
        if (!op.target || !node(op.target)) return `edge "${op.id}" has unknown target "${op.target ?? ""}"`;
        const duplicate = g.edges.find(
          (e) => e.source === op.source && e.target === op.target,
        );
        if (duplicate) {
          // Idempotent: same connection already exists — just refresh the label.
          g = {
            ...g,
            edges: g.edges.map((e) =>
              e.id === duplicate.id && op.label !== undefined ? { ...e, label: op.label } : e,
            ),
          };
          return null;
        }
        g = {
          ...g,
          edges: [
            ...g.edges,
            { id: op.id, source: op.source, target: op.target, ...(op.label !== undefined ? { label: op.label } : {}) },
          ],
        };
        return null;
      }

      case "update_edge": {
        if (!op.id || !edge(op.id)) return `unknown edge "${op.id ?? ""}"`;
        if (op.source !== undefined && !node(op.source)) {
          return `unknown source "${op.source}" for edge "${op.id}"`;
        }
        if (op.target !== undefined && !node(op.target)) {
          return `unknown target "${op.target}" for edge "${op.id}"`;
        }
        g = {
          ...g,
          edges: g.edges.map((e) =>
            e.id === op.id
              ? {
                  ...e,
                  ...(op.source !== undefined ? { source: op.source } : {}),
                  ...(op.target !== undefined ? { target: op.target } : {}),
                  ...(op.label !== undefined ? { label: op.label } : {}),
                }
              : e,
          ),
        };
        return null;
      }

      case "delete_edge": {
        if (!op.id || !edge(op.id)) return `unknown edge "${op.id ?? ""}"`;
        g = { ...g, edges: g.edges.filter((e) => e.id !== op.id) };
        return null;
      }
    }
  }

  // Backstop: per-op checks should keep the graph valid, but if something
  // slipped through, refuse the whole batch rather than corrupt the session.
  const normalized = normalizeProcessGraph(g);
  const { ok, errors } = validateProcessGraph(normalized);
  if (!ok) {
    return {
      graph,
      applied: [],
      rejected: ops.map((op) => ({ op, reason: `batch left graph invalid: ${errors.join("; ")}` })),
    };
  }
  return { graph: normalized, applied, rejected };
}

// ---------------------------------------------------------------------------
// diffGraphs — describe how `next` differs from `prev` as ops. Used by the
// server to turn manual canvas edits (client graph vs session mirror) into
// notices for the model. Positions are ignored: dragging nodes is not an edit
// the model needs to know about.
// ---------------------------------------------------------------------------
export function diffGraphs(prev: ProcessGraph, next: ProcessGraph): GraphOp[] {
  const ops: GraphOp[] = [];

  if (prev.title !== next.title) ops.push({ op: "set_title", title: next.title });
  if ((prev.summary ?? "") !== (next.summary ?? "")) {
    ops.push({ op: "set_summary", summary: next.summary ?? "" });
  }

  const prevActors = new Map(prev.actors.map((a) => [a.id, a]));
  const nextActors = new Map(next.actors.map((a) => [a.id, a]));
  for (const a of next.actors) {
    const before = prevActors.get(a.id);
    if (!before) {
      ops.push({ op: "add_actor", id: a.id, name: a.name, description: a.description });
    } else if (before.name !== a.name || (before.description ?? "") !== (a.description ?? "")) {
      ops.push({ op: "update_actor", id: a.id, name: a.name, description: a.description });
    }
  }
  for (const a of prev.actors) {
    if (!nextActors.has(a.id)) ops.push({ op: "delete_actor", id: a.id });
  }

  const stripPosition = (n: ProcessGraph["nodes"][number]) => {
    const { position: _position, ...rest } = n;
    return rest;
  };
  const prevNodes = new Map(prev.nodes.map((n) => [n.id, n]));
  const nextNodes = new Map(next.nodes.map((n) => [n.id, n]));
  for (const n of next.nodes) {
    const before = prevNodes.get(n.id);
    if (!before) {
      ops.push({
        op: "add_node",
        id: n.id,
        type: n.type,
        label: n.label,
        actorId: n.actorId,
        description: n.description,
        control: n.control,
      });
    } else if (JSON.stringify(stripPosition(before)) !== JSON.stringify(stripPosition(n))) {
      ops.push({
        op: "update_node",
        id: n.id,
        type: n.type,
        label: n.label,
        actorId: n.actorId,
        description: n.description,
        control: n.control,
      });
    }
  }
  for (const n of prev.nodes) {
    if (!nextNodes.has(n.id)) ops.push({ op: "delete_node", id: n.id });
  }

  const prevEdges = new Map(prev.edges.map((e) => [e.id, e]));
  const nextEdges = new Map(next.edges.map((e) => [e.id, e]));
  for (const e of next.edges) {
    const before = prevEdges.get(e.id);
    if (!before) {
      ops.push({ op: "add_edge", id: e.id, source: e.source, target: e.target, label: e.label });
    } else if (
      before.source !== e.source ||
      before.target !== e.target ||
      (before.label ?? "") !== (e.label ?? "")
    ) {
      ops.push({ op: "update_edge", id: e.id, source: e.source, target: e.target, label: e.label });
    }
  }
  for (const e of prev.edges) {
    if (!nextEdges.has(e.id)) ops.push({ op: "delete_edge", id: e.id });
  }

  return ops;
}

// ---------------------------------------------------------------------------
// renderCompactGraph — deterministic compact text rendering of the graph, the
// only representation of graph state the model ever sees (3-5x smaller than
// JSON). Used to seed a session and to re-ground after history compaction.
// ---------------------------------------------------------------------------
export function renderCompactGraph(graph: ProcessGraph): string {
  const lines: string[] = [];
  lines.push(`TITLE: ${graph.title}`);
  if (graph.summary?.trim()) lines.push(`SUMMARY: ${graph.summary.trim()}`);
  lines.push(
    graph.actors.length
      ? `ACTORS: ${graph.actors.map((a) => `${a.id}=${a.name}`).join("; ")}`
      : "ACTORS: (none)",
  );
  lines.push("NODES:");
  if (!graph.nodes.length) lines.push("  (none)");
  for (const n of graph.nodes) {
    const meta: string[] = [n.type];
    if (n.actorId) meta.push(`@${n.actorId}`);
    if (n.type === "control" && n.control) {
      meta.push(n.control.controlType);
      if (n.control.frequency) meta.push(n.control.frequency);
    }
    let line = `  ${n.id} [${meta.join(" ")}] ${n.label}`;
    if (n.type === "control" && n.control?.riskAddressed) {
      line += ` | risk: ${n.control.riskAddressed}`;
    }
    lines.push(line);
  }
  lines.push("EDGES:");
  if (!graph.edges.length) lines.push("  (none)");
  for (const e of graph.edges) {
    lines.push(`  ${e.id}: ${e.source} -> ${e.target}${e.label ? ` (${e.label})` : ""}`);
  }
  return lines.join("\n");
}

/** Human one-liner describing applied ops, e.g. "+2 steps, 1 updated, -1 edge". */
export function summarizeOps(ops: GraphOp[]): string {
  if (!ops.length) return "No changes";
  const counts = new Map<string, number>();
  const bump = (key: string) => counts.set(key, (counts.get(key) ?? 0) + 1);
  for (const op of ops) {
    switch (op.op) {
      case "add_node": bump("step added"); break;
      case "update_node": bump("step updated"); break;
      case "delete_node": bump("step removed"); break;
      case "add_actor": bump("lane added"); break;
      case "update_actor": bump("lane updated"); break;
      case "delete_actor": bump("lane removed"); break;
      case "add_edge": bump("connection added"); break;
      case "update_edge": bump("connection updated"); break;
      case "delete_edge": bump("connection removed"); break;
      case "set_title": bump("title changed"); break;
      case "set_summary": bump("summary changed"); break;
      case "undo_last": bump("undo"); break;
    }
  }
  return [...counts.entries()]
    .map(([what, n]) => {
      if (n === 1) return `1 ${what}`;
      const [noun, ...rest] = what.split(" ");
      return [`${n} ${noun}s`, ...rest].join(" ");
    })
    .join(", ");
}
