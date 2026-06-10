import dagre from "@dagrejs/dagre";
import { MarkerType, type Edge, type Node } from "@xyflow/react";
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

interface NodeSize {
  width: number;
  height: number;
}

function sizeFor(type: ProcessNode["type"]): NodeSize {
  switch (type) {
    case "start":
    case "end":
      return { width: 140, height: 80 };
    case "decision":
      return { width: 180, height: 180 };
    case "control":
      return { width: 220, height: 180 };
    default:
      return { width: 190, height: 100 };
  }
}

const FLOW_NODE_GAP = 30;
const LANE_NODE_GAP = 55;
const LANE_VERTICAL_PADDING = 35;

function rfNodeType(t: ProcessNode["type"]): string {
  if (t === "decision") return "decision";
  if (t === "control") return "control";
  if (t === "start" || t === "end") return "terminal";
  return "step";
}

type Center = { x: number; y: number };

/** Centre point of each laid-out node, keyed by id (lanes excluded). */
function centersFromNodes(nodes: RFNode[]): Map<string, Center> {
  const centers = new Map<string, Center>();
  for (const n of nodes) {
    if (n.id.startsWith("lane__")) continue;
    const { width, height } = sizeFor(n.data.node.type);
    centers.set(n.id, {
      x: n.position.x + width / 2,
      y: n.position.y + height / 2,
    });
  }
  return centers;
}

/**
 * Pick which of the four side-dots an edge attaches to, based on where the
 * target sits relative to the source: side dots (right→left) when it is mostly
 * beside, top/bottom dots otherwise. Handle ids match those in nodes/index.tsx
 * (right source = "r", left target = "l"; top/bottom have no id).
 */
function pickHandles(
  source: Center | undefined,
  target: Center | undefined,
): { sourceHandle?: string; targetHandle?: string } {
  if (!source || !target) return {};
  const dx = target.x - source.x;
  const dy = target.y - source.y;
  if (Math.abs(dx) > Math.abs(dy) && dx > 0) {
    return { sourceHandle: "r", targetHandle: "l" };
  }
  return {}; // default: exit bottom, enter top
}

function buildEdges(graph: ProcessGraph, centers: Map<string, Center>): RFEdge[] {
  return graph.edges.map((e) => ({
    id: e.id,
    source: e.source,
    target: e.target,
    label: e.label,
    type: "smoothstep",
    reconnectable: true,
    interactionWidth: 28,
    ...pickHandles(centers.get(e.source), centers.get(e.target)),
    style: { strokeWidth: 1.6, stroke: "#64748b" },
    labelBgPadding: [6, 3] as [number, number],
    labelBgStyle: { fill: "#fff", fillOpacity: 0.9 },
    markerEnd: {
      type: MarkerType.ArrowClosed,
      width: 24,
      height: 24,
      color: "#64748b",
    },
  }));
}

function rangesOverlap(
  firstStart: number,
  firstSize: number,
  secondStart: number,
  secondSize: number,
  gap: number,
): boolean {
  return (
    firstStart < secondStart + secondSize + gap &&
    firstStart + firstSize + gap > secondStart
  );
}

function resolveFlowchartCollisions(nodes: RFNode[]): RFNode[] {
  const sorted = [...nodes].sort(
    (a, b) => a.position.y - b.position.y || a.position.x - b.position.x,
  );
  const placed: RFNode[] = [];

  for (const node of sorted) {
    const size = sizeFor(node.data.node.type);
    let y = node.position.y;
    let nextY = y;

    do {
      y = nextY;
      nextY = y;
      for (const other of placed) {
        const otherSize = sizeFor(other.data.node.type);
        if (
          rangesOverlap(
            node.position.x,
            size.width,
            other.position.x,
            otherSize.width,
            FLOW_NODE_GAP,
          ) &&
          rangesOverlap(
            y,
            size.height,
            other.position.y,
            otherSize.height,
            FLOW_NODE_GAP,
          )
        ) {
          nextY = Math.max(
            nextY,
            other.position.y + otherSize.height + FLOW_NODE_GAP,
          );
        }
      }
    } while (nextY > y);

    placed.push({
      ...node,
      position: { ...node.position, y },
    });
  }

  return placed;
}

function layoutFlowchart(graph: ProcessGraph): LayoutResult {
  const g = new dagre.graphlib.Graph();
  g.setGraph({ rankdir: "TB", nodesep: 65, ranksep: 90 });
  g.setDefaultEdgeLabel(() => ({}));

  const actorName = new Map(graph.actors.map((a) => [a.id, a.name]));
  for (const n of graph.nodes) g.setNode(n.id, sizeFor(n.type));
  for (const e of graph.edges) g.setEdge(e.source, e.target);
  dagre.layout(g);

  const nodes = resolveFlowchartCollisions(graph.nodes.map((n) => {
    const pos = g.node(n.id);
    const { width, height } = sizeFor(n.type);
    return {
      id: n.id,
      type: rfNodeType(n.type),
      position: n.position ?? { x: pos.x - width / 2, y: pos.y - height / 2 },
      data: { node: n, actorName: n.actorId ? actorName.get(n.actorId) : undefined },
    };
  }));

  return { nodes, edges: buildEdges(graph, centersFromNodes(nodes)), lanes: [] };
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
  const laneHeights = laneIds.map((id) => {
    const maxNodeHeight = graph.nodes
      .filter((node) => (node.actorId ?? "__unassigned__") === id)
      .reduce(
        (height, node) => Math.max(height, sizeFor(node.type).height),
        0,
      );
    return Math.max(170, maxNodeHeight + LANE_VERTICAL_PADDING * 2);
  });
  const laneTops = laneHeights.map((_, index) =>
    laneHeights.slice(0, index).reduce((sum, height) => sum + height, 0),
  );

  // Use dagre LR purely to get the horizontal (flow) ordering / x positions.
  const g = new dagre.graphlib.Graph();
  g.setGraph({ rankdir: "LR", nodesep: 40, ranksep: 90, marginx: 40 });
  g.setDefaultEdgeLabel(() => ({}));
  for (const n of graph.nodes) g.setNode(n.id, sizeFor(n.type));
  for (const e of graph.edges) g.setEdge(e.source, e.target);
  dagre.layout(g);

  const stepNodes: RFNode[] = graph.nodes.map((n) => {
    const pos = g.node(n.id);
    const { width, height } = sizeFor(n.type);
    const li = laneIndex.get(n.actorId ?? "__unassigned__") ?? 0;
    const laneTop = laneTops[li];
    const laneHeight = laneHeights[li];
    const x = pos.x - width / 2 + LANE_LABEL_OFFSET;
    const preferredY =
      n.position?.y ?? laneTop + (laneHeight - height) / 2;
    return {
      id: n.id,
      type: rfNodeType(n.type),
      position: {
        x: n.position?.x ?? x,
        y: Math.min(
          Math.max(preferredY, laneTop + LANE_VERTICAL_PADDING),
          laneTop + laneHeight - height - LANE_VERTICAL_PADDING,
        ),
      },
      data: { node: n, actorName: n.actorId ? actorName.get(n.actorId) : undefined },
    };
  });

  for (const id of laneIds) {
    const laneNodes = stepNodes
      .filter((node) => (node.data.node.actorId ?? "__unassigned__") === id)
      .sort((a, b) => a.position.x - b.position.x);
    let nextX = LANE_LABEL_OFFSET;
    for (const node of laneNodes) {
      const width = sizeFor(node.data.node.type).width;
      node.position = {
        ...node.position,
        x: Math.max(node.position.x, nextX),
      };
      nextX = node.position.x + width + LANE_NODE_GAP;
    }
  }

  const maxX = stepNodes.reduce((right, node) => {
    const width = sizeFor(node.data.node.type).width;
    return Math.max(right, node.position.x + width);
  }, 0);
  const laneWidth = Math.max(maxX + 80, 600);
  const lanes: Lane[] = laneIds.map((id, i) => ({
    actorId: id,
    name: id === "__unassigned__" ? "Start / End" : actorName.get(id) ?? id,
    y: laneTops[i],
    height: laneHeights[i],
  }));

  // Background lane nodes pan/zoom with the flow. They render behind steps and
  // are non-interactive. Their ids are prefixed "lane__" so editing ignores them.
  const laneNodes: RFNode[] = laneIds.map((id, i) => ({
    id: `lane__${id}`,
    type: "lane",
    position: { x: 0, y: laneTops[i] },
    draggable: false,
    selectable: false,
    deletable: false,
    data: {
      // reuse data slot for lane rendering
      laneName: id === "__unassigned__" ? "Start / End" : actorName.get(id) ?? id,
      laneWidth,
      laneHeight: laneHeights[i],
      alt: i % 2 === 1,
    } as unknown as ProcessNodeData,
    zIndex: -1,
    style: { zIndex: -1 },
  }));

  return {
    nodes: [...laneNodes, ...stepNodes],
    edges: buildEdges(graph, centersFromNodes(stepNodes)),
    lanes,
  };
}

export function layout(graph: ProcessGraph, mode: ViewMode): LayoutResult {
  return mode === "swimlane" ? layoutSwimlane(graph) : layoutFlowchart(graph);
}
