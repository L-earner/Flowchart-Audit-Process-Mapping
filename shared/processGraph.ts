// Single source of truth for the process-flow data model.
// Claude emits this shape via structured outputs; the DB stores it; both the
// flowchart and swimlane views render from it; on-canvas edits mutate it.

/** A role / actor in the process — rendered as a swimlane. */
export interface Actor {
  id: string;
  name: string;
  description?: string;
}

export type NodeType =
  | "start"
  | "end"
  | "process"
  | "decision"
  | "control"
  | "system";

export const NODE_TYPES: NodeType[] = [
  "start",
  "end",
  "process",
  "decision",
  "control",
  "system",
];

export type ControlType = "preventive" | "detective" | "manual" | "automated";

/** Extra metadata attached to `control`-type nodes (audit control points). */
export interface ControlInfo {
  controlType: ControlType;
  /** The risk this control mitigates. */
  riskAddressed: string;
  /** How often the control runs, e.g. "per transaction", "monthly". */
  frequency?: string;
}

export interface ProcessNode {
  id: string;
  type: NodeType;
  label: string;
  /** Which actor/lane owns this step; null for start/end markers. */
  actorId: string | null;
  description?: string;
  /** Present when type === "control". */
  control?: ControlInfo;
  /** Canvas position; populated by layout/editing, not by extraction. */
  position?: { x: number; y: number };
}

export interface ProcessEdge {
  id: string;
  source: string;
  target: string;
  /** Condition / branch label, e.g. "if approved". */
  label?: string;
}

export interface ProcessGraph {
  title: string;
  summary?: string;
  actors: Actor[];
  nodes: ProcessNode[];
  edges: ProcessEdge[];
}

export type ViewMode = "flowchart" | "swimlane";

// ---------------------------------------------------------------------------
// JSON Schema for Claude structured outputs (output_config.format).
// Kept aligned with the types above. Per structured-output limits we use only
// supported constructs: type, enum, nested objects, additionalProperties:false,
// required. We intentionally omit `position` — it is computed client-side, not
// produced by extraction.
// ---------------------------------------------------------------------------
export const PROCESS_GRAPH_SCHEMA = {
  type: "object",
  properties: {
    title: { type: "string", description: "Concise name of the process." },
    summary: {
      type: "string",
      description: "One- or two-sentence overview of the process.",
    },
    actors: {
      type: "array",
      description:
        "Distinct roles, teams, or systems that perform steps. Each becomes a swimlane.",
      items: {
        type: "object",
        properties: {
          id: { type: "string", description: "Stable slug, e.g. 'requester'." },
          name: { type: "string" },
          description: { type: "string" },
        },
        required: ["id", "name"],
        additionalProperties: false,
      },
    },
    nodes: {
      type: "array",
      items: {
        type: "object",
        properties: {
          id: { type: "string", description: "Stable unique id." },
          type: {
            type: "string",
            enum: NODE_TYPES,
            description:
              "start/end markers, process step, decision (branch), control (audit control point), or system (automated action).",
          },
          label: { type: "string", description: "Short step label." },
          actorId: {
            type: ["string", "null"],
            description:
              "id of the owning actor; null only for start/end markers.",
          },
          description: { type: "string" },
          control: {
            type: "object",
            description: "Only for type 'control'.",
            properties: {
              controlType: {
                type: "string",
                enum: ["preventive", "detective", "manual", "automated"],
              },
              riskAddressed: {
                type: "string",
                description: "The risk this control mitigates.",
              },
              frequency: { type: "string" },
            },
            required: ["controlType", "riskAddressed"],
            additionalProperties: false,
          },
        },
        required: ["id", "type", "label", "actorId"],
        additionalProperties: false,
      },
    },
    edges: {
      type: "array",
      items: {
        type: "object",
        properties: {
          id: { type: "string" },
          source: { type: "string", description: "Source node id." },
          target: { type: "string", description: "Target node id." },
          label: {
            type: "string",
            description: "Branch/condition label, e.g. 'if rejected'.",
          },
        },
        required: ["id", "source", "target"],
        additionalProperties: false,
      },
    },
  },
  required: ["title", "actors", "nodes", "edges"],
  additionalProperties: false,
} as const;

/** Lightweight runtime validation of an extracted/loaded graph. */
export function validateProcessGraph(value: unknown): {
  ok: boolean;
  errors: string[];
} {
  const errors: string[] = [];
  const g = value as Partial<ProcessGraph> | null;

  if (!g || typeof g !== "object") {
    return { ok: false, errors: ["graph is not an object"] };
  }
  if (typeof g.title !== "string" || g.title.length === 0) {
    errors.push("missing title");
  }
  if (!Array.isArray(g.actors)) errors.push("actors is not an array");
  if (!Array.isArray(g.nodes)) errors.push("nodes is not an array");
  if (!Array.isArray(g.edges)) errors.push("edges is not an array");

  const nodeIds = new Set((g.nodes ?? []).map((n) => n.id));
  const actorIds = new Set((g.actors ?? []).map((a) => a.id));

  for (const n of g.nodes ?? []) {
    if (!NODE_TYPES.includes(n.type)) {
      errors.push(`node ${n.id} has invalid type ${n.type}`);
    }
    if (n.actorId !== null && !actorIds.has(n.actorId)) {
      errors.push(`node ${n.id} references unknown actor ${n.actorId}`);
    }
  }
  for (const e of g.edges ?? []) {
    if (!nodeIds.has(e.source)) {
      errors.push(`edge ${e.id} has unknown source ${e.source}`);
    }
    if (!nodeIds.has(e.target)) {
      errors.push(`edge ${e.id} has unknown target ${e.target}`);
    }
  }

  return { ok: errors.length === 0, errors };
}
