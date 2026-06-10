import type {
  ProcessGraph,
  ProcessEdge,
  ProcessNode,
  NodeType,
  ControlInfo,
} from "../types";

function uid(prefix: string): string {
  return prefix + "_" + Math.random().toString(36).slice(2, 8);
}

export function applyPositions(
  graph: ProcessGraph,
  positions: Record<string, { x: number; y: number }>,
): ProcessGraph {
  return {
    ...graph,
    nodes: graph.nodes.map((n) =>
      positions[n.id] ? { ...n, position: positions[n.id] } : n,
    ),
  };
}

/** Drop all stored positions so a view re-lays out from scratch. */
export function clearPositions(graph: ProcessGraph): ProcessGraph {
  return { ...graph, nodes: graph.nodes.map(({ position, ...n }) => n) };
}

export function addEdge(
  graph: ProcessGraph,
  source: string,
  target: string,
): ProcessGraph {
  if (graph.edges.some((e) => e.source === source && e.target === target)) {
    return graph;
  }
  return {
    ...graph,
    edges: [...graph.edges, { id: uid("e"), source, target }],
  };
}

export function addNode(
  graph: ProcessGraph,
  type: NodeType,
  actorId: string | null,
  position?: { x: number; y: number },
): { graph: ProcessGraph; nodeId: string } {
  const id = uid("n");
  const node: ProcessNode = {
    id,
    type,
    label: "New step",
    actorId: type === "start" || type === "end" ? null : actorId,
    ...(position ? { position } : {}),
    ...(type === "control"
      ? { control: { controlType: "manual", riskAddressed: "" } as ControlInfo }
      : {}),
  };
  return { graph: { ...graph, nodes: [...graph.nodes, node] }, nodeId: id };
}

export function updateNode(
  graph: ProcessGraph,
  nodeId: string,
  patch: Partial<ProcessNode>,
): ProcessGraph {
  return {
    ...graph,
    nodes: graph.nodes.map((n) => {
      if (n.id !== nodeId) return n;
      const next = { ...n, ...patch };
      if (patch.type === "start" || patch.type === "end") {
        next.actorId = null;
      }
      if (patch.type === "control" && !next.control) {
        next.control = { controlType: "manual", riskAddressed: "" };
      }
      if (patch.type && patch.type !== "control") {
        delete next.control;
      }
      return next;
    }),
  };
}

export function updateControl(
  graph: ProcessGraph,
  nodeId: string,
  patch: Partial<ControlInfo>,
): ProcessGraph {
  return {
    ...graph,
    nodes: graph.nodes.map((n) =>
      n.id === nodeId
        ? {
            ...n,
            control: {
              controlType: n.control?.controlType ?? "manual",
              riskAddressed: n.control?.riskAddressed ?? "",
              ...n.control,
              ...patch,
            },
          }
        : n,
    ),
  };
}

export function deleteNode(graph: ProcessGraph, nodeId: string): ProcessGraph {
  return {
    ...graph,
    nodes: graph.nodes.filter((n) => n.id !== nodeId),
    edges: graph.edges.filter((e) => e.source !== nodeId && e.target !== nodeId),
  };
}

export function updateEdge(
  graph: ProcessGraph,
  edgeId: string,
  patch: Partial<ProcessEdge>,
): ProcessGraph {
  return {
    ...graph,
    edges: graph.edges.map((edge) =>
      edge.id === edgeId ? { ...edge, ...patch } : edge,
    ),
  };
}

export function deleteEdge(graph: ProcessGraph, edgeId: string): ProcessGraph {
  return {
    ...graph,
    edges: graph.edges.filter((edge) => edge.id !== edgeId),
  };
}

export function setTitle(graph: ProcessGraph, title: string): ProcessGraph {
  return { ...graph, title };
}
