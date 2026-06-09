import type {
  ProcessGraph,
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
): { graph: ProcessGraph; nodeId: string } {
  const id = uid("n");
  const node: ProcessNode = {
    id,
    type,
    label: "New step",
    actorId: type === "start" || type === "end" ? null : actorId,
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
    nodes: graph.nodes.map((n) => (n.id === nodeId ? { ...n, ...patch } : n)),
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

export function setTitle(graph: ProcessGraph, title: string): ProcessGraph {
  return { ...graph, title };
}
