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

const DEFAULT_CONTROL_INFO: ControlInfo = {
  controlType: "manual",
  riskAddressed: "Not specified.",
};

/**
 * Backfill control metadata omitted by older graphs or non-strict model output.
 * This keeps control nodes editable without inventing a specific business risk.
 */
export function normalizeProcessGraph(graph: ProcessGraph): ProcessGraph {
  if (!graph || !Array.isArray(graph.nodes)) return graph;

  let changed = false;
  const nodes = graph.nodes.map((node) => {
    if (!node || node.type !== "control") return node;

    const control = node.control as Partial<ControlInfo> | undefined;
    const controlType = ["preventive", "detective", "manual", "automated"].includes(
      control?.controlType ?? "",
    )
      ? control!.controlType!
      : DEFAULT_CONTROL_INFO.controlType;
    const riskAddressed =
      typeof control?.riskAddressed === "string" &&
      control.riskAddressed.trim()
        ? control.riskAddressed
        : DEFAULT_CONTROL_INFO.riskAddressed;

    if (
      control &&
      control.controlType === controlType &&
      control.riskAddressed === riskAddressed
    ) {
      return node;
    }

    changed = true;
    return {
      ...node,
      control: {
        ...control,
        controlType,
        riskAddressed,
      },
    };
  });

  return changed ? { ...graph, nodes } : graph;
}

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
  const actors = Array.isArray(g.actors) ? g.actors : [];
  const nodes = Array.isArray(g.nodes) ? g.nodes : [];
  const edges = Array.isArray(g.edges) ? g.edges : [];
  if (!Array.isArray(g.actors)) errors.push("actors is not an array");
  if (!Array.isArray(g.nodes)) errors.push("nodes is not an array");
  if (!Array.isArray(g.edges)) errors.push("edges is not an array");

  const actorIds = new Set<string>();
  for (const [index, actor] of actors.entries()) {
    if (!actor || typeof actor !== "object") {
      errors.push(`actor ${index} is not an object`);
      continue;
    }
    if (typeof actor.id !== "string" || !actor.id) {
      errors.push(`actor ${index} has no id`);
    } else if (actorIds.has(actor.id)) {
      errors.push(`duplicate actor id ${actor.id}`);
    } else {
      actorIds.add(actor.id);
    }
    if (typeof actor.name !== "string" || !actor.name.trim()) {
      errors.push(`actor ${actor.id ?? index} has no name`);
    }
  }

  const nodeIds = new Set<string>();
  for (const [index, node] of nodes.entries()) {
    if (!node || typeof node !== "object") {
      errors.push(`node ${index} is not an object`);
      continue;
    }
    const nodeName = typeof node.id === "string" && node.id ? node.id : String(index);
    if (typeof node.id !== "string" || !node.id) {
      errors.push(`node ${index} has no id`);
    } else if (nodeIds.has(node.id)) {
      errors.push(`duplicate node id ${node.id}`);
    } else {
      nodeIds.add(node.id);
    }
    if (typeof node.label !== "string" || !node.label.trim()) {
      errors.push(`node ${nodeName} has no label`);
    }
    if (!NODE_TYPES.includes(node.type)) {
      errors.push(`node ${nodeName} has invalid type ${String(node.type)}`);
      continue;
    }
    if (node.type === "start" || node.type === "end") {
      if (node.actorId !== null) {
        errors.push(`node ${nodeName} must not reference an actor`);
      }
    } else if (typeof node.actorId !== "string" || !actorIds.has(node.actorId)) {
      errors.push(`node ${nodeName} references unknown actor ${String(node.actorId)}`);
    }
    if (node.type === "control") {
      if (!node.control || typeof node.control !== "object") {
        errors.push(`control node ${nodeName} has no control details`);
      } else {
        if (
          !["preventive", "detective", "manual", "automated"].includes(
            node.control.controlType,
          )
        ) {
          errors.push(`control node ${nodeName} has an invalid control type`);
        }
        if (
          typeof node.control.riskAddressed !== "string" ||
          !node.control.riskAddressed.trim()
        ) {
          errors.push(`control node ${nodeName} has no risk addressed`);
        }
      }
    }
  }

  const edgeIds = new Set<string>();
  for (const [index, edge] of edges.entries()) {
    if (!edge || typeof edge !== "object") {
      errors.push(`edge ${index} is not an object`);
      continue;
    }
    const edgeName = typeof edge.id === "string" && edge.id ? edge.id : String(index);
    if (typeof edge.id !== "string" || !edge.id) {
      errors.push(`edge ${index} has no id`);
    } else if (edgeIds.has(edge.id)) {
      errors.push(`duplicate edge id ${edge.id}`);
    } else {
      edgeIds.add(edge.id);
    }
    if (!nodeIds.has(edge.source)) {
      errors.push(`edge ${edgeName} has unknown source ${String(edge.source)}`);
    }
    if (!nodeIds.has(edge.target)) {
      errors.push(`edge ${edgeName} has unknown target ${String(edge.target)}`);
    }
  }

  return { ok: errors.length === 0, errors };
}
