import {
  normalizeProcessGraph,
  validateProcessGraph,
  type ProcessGraph,
} from "@shared/processGraph.ts";

function uniqueId(base: string, used: Set<string>): string {
  let id = base;
  let suffix = 2;
  while (used.has(id)) id = `${base}_${suffix++}`;
  used.add(id);
  return id;
}

/**
 * Repair two common open-model topology issues without adding new outcomes:
 * infer a missing lane from adjacent steps, and make existing labelled forks
 * explicit when a model attaches them directly to a process/control node.
 */
function normalizeGraph(value: unknown): unknown {
  if (!value || typeof value !== "object") return value;
  const graph = value as ProcessGraph;
  if (
    !Array.isArray(graph.actors) ||
    !Array.isArray(graph.nodes) ||
    !Array.isArray(graph.edges)
  ) {
    return value;
  }

  const actorIds = new Set(graph.actors.map((actor) => actor.id));
  const nodeById = new Map(graph.nodes.map((node) => [node.id, node]));
  const firstActorId = graph.actors[0]?.id ?? null;

  const nodes = graph.nodes.map((node) => {
    if (
      node.type === "start" ||
      node.type === "end" ||
      (typeof node.actorId === "string" && actorIds.has(node.actorId))
    ) {
      return node;
    }
    const predecessor = graph.edges
      .filter((edge) => edge.target === node.id)
      .map((edge) => nodeById.get(edge.source))
      .find((candidate) => candidate?.actorId && actorIds.has(candidate.actorId));
    const successor = graph.edges
      .filter((edge) => edge.source === node.id)
      .map((edge) => nodeById.get(edge.target))
      .find((candidate) => candidate?.actorId && actorIds.has(candidate.actorId));
    return {
      ...node,
      actorId: predecessor?.actorId ?? successor?.actorId ?? firstActorId,
    };
  });

  const usedNodeIds = new Set(nodes.map((node) => node.id));
  const usedEdgeIds = new Set(graph.edges.map((edge) => edge.id));
  const edges = [...graph.edges];
  const addedNodes: ProcessGraph["nodes"] = [];

  for (const node of nodes) {
    if (node.type === "decision") continue;
    const outgoing = edges.filter((edge) => edge.source === node.id);
    if (
      outgoing.length < 2 ||
      outgoing.filter((edge) => edge.label?.trim()).length < 2
    ) {
      continue;
    }
    const decisionId = uniqueId(`${node.id}_decision`, usedNodeIds);
    addedNodes.push({
      id: decisionId,
      type: "decision",
      label: `${node.label} outcome`,
      actorId: node.actorId ?? firstActorId,
    });
    for (const edge of outgoing) edge.source = decisionId;
    edges.push({
      id: uniqueId(`${node.id}_to_decision`, usedEdgeIds),
      source: node.id,
      target: decisionId,
    });
  }

  return { ...graph, nodes: [...nodes, ...addedNodes], edges };
}

/**
 * Parse model text into a validated ProcessGraph. Lenient about wrapping:
 * strips ```json fences and, failing that, extracts the outermost {...} block —
 * open models sometimes add prose or fences despite instructions.
 */
export function parseGraphJson(text: string): ProcessGraph {
  let t = text.trim();

  // Strip a leading/trailing markdown code fence if present.
  if (t.startsWith("```")) {
    t = t.replace(/^```[a-zA-Z]*\s*/, "").replace(/\s*```$/, "").trim();
  }

  let obj: unknown;
  try {
    obj = JSON.parse(t);
  } catch {
    const start = t.indexOf("{");
    const end = t.lastIndexOf("}");
    if (start >= 0 && end > start) {
      try {
        obj = JSON.parse(t.slice(start, end + 1));
      } catch {
        throw new Error("Model output was not valid JSON.");
      }
    } else {
      throw new Error("Model output was not valid JSON.");
    }
  }

  obj = normalizeProcessGraph(normalizeGraph(obj) as ProcessGraph);
  const { ok, errors } = validateProcessGraph(obj);
  if (!ok) {
    throw new Error(`Extracted graph failed validation: ${errors.join("; ")}`);
  }
  return obj as ProcessGraph;
}
