import dagre from "@dagrejs/dagre";
import type { Edge, Node } from "@xyflow/react";
import type { ProcessGraph, ProcessNode, ViewMode } from "../types";

export interface ProcessNodeData extends Record<string, unknown> {
  node: ProcessNode;
  actorName?: string;
}

export type RFNode = Node<ProcessNodeData>;
export type RFEdge = Edge;

export interface Lane {
  actorId: string;
  name: string;
  y: number;
  height: number;
}

export interface LayoutResult {
  nodes: RFNode[];
  edges: RFEdge[];
  lanes: Lane[];
}

function sizeFor(type: ProcessNode["type"]): { width: number; height: number } {
  switch (type) {
    case "start":
    case "end":
      return { width: 130, height: 56 };
    case "decision":
      return { width: 150, height: 110 };
    case "control":
      return { width: 200, height: 84 };
    default:
      return { width: 180, height: 72 };
  }
}

const LANE_HEIGHT = 180;
const LANE_PADDING = 28;

function rfNodeType(t: ProcessNode["type"]): string {
  if (t === "decision") return "decision";
  if (t === "control") return "control";
  if (t === "start" || t === "end") return "terminal";
  return "step";
}

function buildEdges(graph: ProcessGraph): RFEdge[] {
  return graph.edges.map((e) => ({
    id: e.id,
    source: e.source,
    target: e.target,
    label: e.label,
    type: "smoothstep",
    labelBgPadding: [6, 3] as [number, number],
    labelBgStyle: { fill: "#fff", fillOpacity: 0.85 },
    markerEnd: { type: "arrowclosed" as never },
  }));
}

function layoutFlowchart(graph: ProcessGraph): LayoutResult {
  const g = new dagre.graphlib.Graph();
  g.setGraph({ rankdir: "TB", nodesep: 55, ranksep: 70 });
  g.setDefaultEdgeLabel(() => ({}));

  const actorName = new Map(graph.actors.map((a) => [a.id, a.name]));
  for (const n of graph.nodes) g.setNode(n.id, sizeFor(n.type));
  for (const e of graph.edges) g.setEdge(e.source, e.target);
  dagre.layout(g);

  const nodes: RFNode[] = graph.nodes.map((n) => {
    const pos = g.node(n.id);
    const { width, height } = sizeFor(n.type);
    return {
      id: n.id,
      type: rfNodeType(n.type),
      position: n.position ?? { x: pos.x - width / 2, y: pos.y - height / 2 },
      data: { node: n, actorName: n.actorId ? actorName.get(n.actorId) : undefined },
    };
  });

  return { nodes, edges: buildEdges(graph), lanes: [] };
}

const LANE_LABEL_OFFSET = 180;

function layoutSwimlane(graph: ProcessGraph): LayoutResult {
  // Determine lane order: actors in declared order, plus an "unassigned" lane
  // for start/end markers (actorId null).
  const laneIds = [...graph.actors.map((a) => a.id)];
  const hasUnassigned = graph.nodes.some((n) => n.actorId === null);
  if (hasUnassigned) laneIds.push("__unassigned__");

  const laneIndex = new Map(laneIds.map((id, i) => [id, i]));
  const actorName = new Map(graph.actors.map((a) => [a.id, a.name]));

  // Use dagre LR purely to get the horizontal (flow) ordering / x positions.
  const g = new dagre.graphlib.Graph();
  g.setGraph({ rankdir: "LR", nodesep: 40, ranksep: 90, marginx: 40 });
  g.setDefaultEdgeLabel(() => ({}));
  for (const n of graph.nodes) g.setNode(n.id, sizeFor(n.type));
  for (const e of graph.edges) g.setEdge(e.source, e.target);
  dagre.layout(g);

  let maxX = 0;
  const stepNodes: RFNode[] = graph.nodes.map((n) => {
    const pos = g.node(n.id);
    const { width, height } = sizeFor(n.type);
    const li = laneIndex.get(n.actorId ?? "__unassigned__") ?? 0;
    const laneTop = li * LANE_HEIGHT;
    const x = pos.x - width / 2 + LANE_LABEL_OFFSET;
    maxX = Math.max(maxX, x + width);
    return {
      id: n.id,
      type: rfNodeType(n.type),
      position: n.position ?? {
        x,
        y: laneTop + (LANE_HEIGHT - height) / 2,
      },
      data: { node: n, actorName: n.actorId ? actorName.get(n.actorId) : undefined },
    };
  });

  const laneWidth = Math.max(maxX + 80, 600);
  const lanes: Lane[] = laneIds.map((id, i) => ({
    actorId: id,
    name: id === "__unassigned__" ? "Start / End" : actorName.get(id) ?? id,
    y: i * LANE_HEIGHT,
    height: LANE_HEIGHT - LANE_PADDING,
  }));

  // Background lane nodes pan/zoom with the flow. They render behind steps and
  // are non-interactive. Their ids are prefixed "lane__" so editing ignores them.
  const laneNodes: RFNode[] = laneIds.map((id, i) => ({
    id: `lane__${id}`,
    type: "lane",
    position: { x: 0, y: i * LANE_HEIGHT },
    draggable: false,
    selectable: false,
    deletable: false,
    data: {
      // reuse data slot for lane rendering
      laneName: id === "__unassigned__" ? "Start / End" : actorName.get(id) ?? id,
      laneWidth,
      laneHeight: LANE_HEIGHT,
      alt: i % 2 === 1,
    } as unknown as ProcessNodeData,
    zIndex: -1,
    style: { zIndex: -1 },
  }));

  return { nodes: [...laneNodes, ...stepNodes], edges: buildEdges(graph), lanes };
}

export function layout(graph: ProcessGraph, mode: ViewMode): LayoutResult {
  return mode === "swimlane" ? layoutSwimlane(graph) : layoutFlowchart(graph);
}
