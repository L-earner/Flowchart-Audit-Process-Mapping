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

type Box = { x1: number; y1: number; x2: number; y2: number };

const centerOf = (b: Box) => ({ x: (b.x1 + b.x2) / 2, y: (b.y1 + b.y2) / 2 });

/** Bounding box of each laid-out node, keyed by id (lanes excluded). */
function boxesFromNodes(nodes: RFNode[]): Map<string, Box> {
  const boxes = new Map<string, Box>();
  for (const n of nodes) {
    if (n.id.startsWith("lane__")) continue;
    const { width, height } = sizeFor(n.data.node.type);
    boxes.set(n.id, {
      x1: n.position.x,
      y1: n.position.y,
      x2: n.position.x + width,
      y2: n.position.y + height,
    });
  }
  return boxes;
}

const LOOP_BASE_OFFSET = 56;
const LOOP_CLEARANCE = 36;
const LOOP_MAX_OFFSET = 260;
const AXIS_SLACK = 40;

/** Swap x/y so the loop router can work on either axis. */
const transpose = (b: Box): Box => ({ x1: b.y1, y1: b.x1, x2: b.y2, y2: b.x2 });

/**
 * A back-edge loops out of one side; its long return segment runs at
 * side-of-nodes + offset. Widen the offset until that corridor clears every
 * node lying in the edge's band, and pick whichever side gets clear with the
 * smaller detour. Works in x; callers transpose for a vertical-axis loop.
 */
function routeLoop(
  src: Box,
  tgt: Box,
  obstacles: Box[],
): { side: "l" | "r"; offset: number } {
  const yTop = Math.min(centerOf(tgt).y, centerOf(src).y);
  const yBottom = Math.max(centerOf(tgt).y, centerOf(src).y);
  const inBand = obstacles.filter((b) => b.y2 > yTop && b.y1 < yBottom);

  const baseR = Math.max(src.x2, tgt.x2);
  let corridorR = baseR + LOOP_BASE_OFFSET;
  for (let changed = true; changed; ) {
    changed = false;
    for (const b of inBand) {
      if (b.x1 < corridorR + 8 && b.x2 > baseR && b.x2 + LOOP_CLEARANCE > corridorR) {
        corridorR = b.x2 + LOOP_CLEARANCE;
        changed = true;
      }
    }
  }

  const baseL = Math.min(src.x1, tgt.x1);
  let corridorL = baseL - LOOP_BASE_OFFSET;
  for (let changed = true; changed; ) {
    changed = false;
    for (const b of inBand) {
      if (b.x2 > corridorL - 8 && b.x1 < baseL && b.x1 - LOOP_CLEARANCE < corridorL) {
        corridorL = b.x1 - LOOP_CLEARANCE;
        changed = true;
      }
    }
  }

  const offR = corridorR - baseR;
  const offL = baseL - corridorL;
  return offR <= offL
    ? { side: "r", offset: Math.min(offR, LOOP_MAX_OFFSET) }
    : { side: "l", offset: Math.min(offL, LOOP_MAX_OFFSET) };
}

type Route = { sourceHandle?: string; targetHandle?: string; offset: number };

/**
 * Pick which side each edge attaches to. Handle ids ("t"/"b"/"l"/"r") match
 * nodes/index.tsx; all handles are connectable both ways (loose connection
 * mode). Routing is judged along the view's flow axis — flowchart flows
 * top→bottom, swimlane flows left→right; distance across the axis (e.g.
 * between lanes) says nothing about flow direction:
 * - forward → out the flow side, in the back side (b→t / r→l);
 * - same rank → hop across (side chosen by which way the target sits);
 * - backward → a straight return line if the direct corridor is clear of
 *   nodes, otherwise a same-side loop routed around the obstacles.
 */
function routeEdge(
  src: Box | undefined,
  tgt: Box | undefined,
  boxes: Map<string, Box>,
  srcId: string,
  tgtId: string,
  axis: "TB" | "LR",
): Route {
  if (!src || !tgt) return { offset: 24 };
  const dx = centerOf(tgt).x - centerOf(src).x;
  const dy = centerOf(tgt).y - centerOf(src).y;
  const forward = axis === "LR" ? dx : dy;
  const across = axis === "LR" ? dy : dx;
  // Handle pairs relative to the flow axis.
  const [out, into, sidePos, sideNeg] =
    axis === "LR"
      ? (["r", "l", "b", "t"] as const)
      : (["b", "t", "r", "l"] as const);
  const obstacles = [...boxes.entries()]
    .filter(([id]) => id !== srcId && id !== tgtId)
    .map(([, b]) => b);

  if (forward > AXIS_SLACK) {
    // Forward across lanes: the last segment runs into the target's back side
    // at the target's cross-position. If another node sits in that approach
    // strip, come in through the target's top/bottom instead of through it.
    if (axis === "LR" && Math.abs(dy) > AXIS_SLACK) {
      const cy = centerOf(tgt).y;
      const stripBlocked = obstacles.some(
        (b) => b.x2 > src.x2 && b.x1 < tgt.x1 && b.y1 < cy + 20 && b.y2 > cy - 20,
      );
      if (stripBlocked) {
        return { sourceHandle: "r", targetHandle: dy < 0 ? "b" : "t", offset: 24 };
      }
    }
    return { sourceHandle: out, targetHandle: into, offset: 24 };
  }
  if (forward >= -AXIS_SLACK || Math.abs(across) > Math.abs(forward)) {
    // Same rank (or overwhelmingly sideways): hop across the axis.
    return across >= 0
      ? { sourceHandle: sidePos, targetHandle: sideNeg, offset: 24 }
      : { sourceHandle: sideNeg, targetHandle: sidePos, offset: 24 };
  }

  // Backward. Try a straight return (in the back side, out the front side of
  // the target); take it only when the direct corridor is free of nodes.
  const band: Box = {
    x1: Math.min(src.x1, tgt.x1),
    y1: Math.min(src.y1, tgt.y1),
    x2: Math.max(src.x2, tgt.x2),
    y2: Math.max(src.y2, tgt.y2),
  };
  const blocked = obstacles.some(
    (b) => b.x1 < band.x2 && b.x2 > band.x1 && b.y1 < band.y2 && b.y2 > band.y1,
  );
  if (!blocked) {
    return { sourceHandle: into, targetHandle: out, offset: 32 };
  }
  // Loop around: corridor runs across the axis, widened past obstacles.
  const flip = axis === "LR" ? transpose : (b: Box) => b;
  const { side, offset } = routeLoop(flip(src), flip(tgt), obstacles.map(flip));
  const mapped = axis === "LR" ? (side === "r" ? "b" : "t") : side;
  return { sourceHandle: mapped, targetHandle: mapped, offset };
}

function buildEdges(
  graph: ProcessGraph,
  boxes: Map<string, Box>,
  axis: "TB" | "LR",
): RFEdge[] {
  return graph.edges.map((e) => {
    const { offset, ...handles } = routeEdge(
      boxes.get(e.source),
      boxes.get(e.target),
      boxes,
      e.source,
      e.target,
      axis,
    );
    return {
    id: e.id,
    source: e.source,
    target: e.target,
    label: e.label,
    type: "smoothstep",
    pathOptions: { borderRadius: 12, offset },
    reconnectable: true,
    interactionWidth: 28,
    ...handles,
    style: { strokeWidth: 1.8, stroke: "#8b93a5" },
    labelStyle: { fontSize: 11, fontWeight: 550, fill: "#525a6a" },
    labelBgPadding: [7, 4] as [number, number],
    labelBgStyle: { fill: "#fff", fillOpacity: 0.95 },
    markerEnd: {
      type: MarkerType.ArrowClosed,
      width: 22,
      height: 22,
      color: "#8b93a5",
    },
    };
  });
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
  g.setGraph({ rankdir: "TB", nodesep: 80, ranksep: 110 });
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

  return { nodes, edges: buildEdges(graph, boxesFromNodes(nodes), "TB"), lanes: [] };
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
  g.setGraph({ rankdir: "LR", nodesep: 50, ranksep: 110, marginx: 40 });
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
    edges: buildEdges(graph, boxesFromNodes(stepNodes), "LR"),
    lanes,
  };
}

export function layout(graph: ProcessGraph, mode: ViewMode): LayoutResult {
  return mode === "swimlane" ? layoutSwimlane(graph) : layoutFlowchart(graph);
}
