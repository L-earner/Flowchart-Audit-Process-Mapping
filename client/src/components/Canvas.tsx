import { useEffect, useMemo, useRef, type MouseEvent as ReactMouseEvent } from "react";
import {
  ReactFlow,
  Background,
  BackgroundVariant,
  Controls,
  Panel,
  useNodesState,
  useEdgesState,
  addEdge,
  applyNodeChanges,
  reconnectEdge,
  ConnectionMode,
  useReactFlow,
  useStore,
  type Connection,
  type Edge,
  type NodeChange,
  type ReactFlowInstance,
} from "@xyflow/react";
import "@xyflow/react/dist/style.css";
import type { NodeType, ProcessGraph, ViewMode } from "../types";
import {
  layout,
  layoutBounds,
  flowAnchor,
  LANE_LABEL_OFFSET,
  type Lane,
  type LayoutResult,
  type RFNode,
} from "../lib/layout";
import { readableViewport } from "../lib/viewport";
import Icon from "./Icon";
import { nodeTypes } from "./nodes";
import { NodeEditContext } from "./nodes/nodeEditContext";

interface CanvasProps {
  graph: ProcessGraph;
  viewMode: ViewMode;
  /**
   * Changing this re-frames the camera (readable zoom on the start of the
   * process). The parent bumps it when a different map is loaded/extracted or
   * the view is toggled — not on ordinary edits, so the camera stays put.
   */
  fitKey: number;
  onChangeView: (mode: ViewMode) => void;
  /** Bump `seq` to add a step of `type` after the selected one (from the inspector). */
  addAfterRequest?: { type: NodeType; seq: number } | null;
  /** Bump `seq` to pan/zoom the camera onto a step (e.g. from the Open points list). */
  focusRequest?: { nodeId: string; seq: number } | null;
  selectedNodeId: string | null;
  onSelectNode: (nodeId: string | null) => void;
  onSelectEdge: (edgeId: string | null) => void;
  /** Persist node position edits back up to the parent graph. */
  onNodePositions: (positions: Record<string, { x: number; y: number }>) => void;
  onConnect: (source: string, target: string) => void;
  onReconnectEdge: (edgeId: string, source: string, target: string) => void;
  onRenameNode: (nodeId: string, label: string) => void;
  onReassignActor: (nodeId: string, actorId: string | null) => void;
  onAddNode: (
    type: NodeType,
    actorId: string | null,
    position: { x: number; y: number },
    connectFrom?: string,
  ) => void;
  onDeleteElements: (nodeIds: string[], edgeIds: string[]) => void;
}

export default function Canvas({
  graph,
  viewMode,
  fitKey,
  focusRequest,
  onChangeView,
  addAfterRequest,
  selectedNodeId,
  onSelectNode,
  onSelectEdge,
  onNodePositions,
  onConnect,
  onReconnectEdge,
  onRenameNode,
  onReassignActor,
  onAddNode,
  onDeleteElements,
}: CanvasProps) {
  const flowRef = useRef<ReactFlowInstance<RFNode> | null>(null);
  const laid = useMemo(() => layout(graph, viewMode), [graph, viewMode]);
  const [nodes, setNodes] = useNodesState<RFNode>(laid.nodes);
  const [edges, setEdges, onEdgesChange] = useEdgesState(laid.edges);
  const selectedNode = graph.nodes.find((node) => node.id === selectedNodeId);
  const selectedRfNode = nodes.find((node) => node.id === selectedNodeId);

  // Re-layout when the graph or view changes.
  useEffect(() => {
    setNodes(laid.nodes);
    setEdges(laid.edges);
  }, [laid, setNodes, setEdges]);

  useEffect(() => {
    setNodes((current) =>
      current.map((node) => ({
        ...node,
        selected: node.id === selectedNodeId,
      })),
    );
  }, [selectedNodeId, setNodes]);

  const handleNodesChange = (changes: NodeChange<RFNode>[]) => {
    const nextNodes = applyNodeChanges(changes, nodes);
    setNodes(nextNodes);
    const dragEnd = changes.some(
      (c) => c.type === "position" && c.dragging === false,
    );
    if (dragEnd) {
      // In swimlane view, dropping a node into a different lane band reassigns
      // its actor instead of persisting the raw position. Only the dragged node
      // moves in a single drag, so we hand off the reassignment (which drops the
      // node's position so layout re-snaps it) and skip the position persist —
      // calling both would race on the same stale graph and clobber the actor
      // change.
      if (viewMode === "swimlane") {
        const moved = changes.find(
          (c) => c.type === "position" && c.dragging === false,
        );
        const movedId = moved && "id" in moved ? moved.id : undefined;
        const movedNode = movedId
          ? nextNodes.find((n) => n.id === movedId)
          : undefined;
        if (movedNode && !movedNode.id.startsWith("lane__")) {
          const current = graph.nodes.find((n) => n.id === movedNode.id);
          // start/end markers live in the unassigned lane — don't reassign them.
          if (current && current.type !== "start" && current.type !== "end") {
            const centerY = movedNode.position.y + 40;
            const lane = laid.lanes.find(
              (candidate) =>
                centerY >= candidate.y &&
                centerY < candidate.y + candidate.height,
            );
            const targetActor =
              lane && lane.actorId !== "__unassigned__" ? lane.actorId : null;
            if (targetActor && targetActor !== current.actorId) {
              onReassignActor(movedNode.id, targetActor);
              return;
            }
          }
        }
      }

      const positions: Record<string, { x: number; y: number }> = {};
      for (const n of nextNodes) {
        if (n.id.startsWith("lane__")) continue; // skip background lanes
        positions[n.id] = n.position;
      }
      onNodePositions(positions);
    }
  };

  const handleConnect = (c: Connection) => {
    if (!c.source || !c.target) return;
    setEdges((eds) => addEdge({ ...c, type: "smoothstep" }, eds));
    onConnect(c.source, c.target);
  };

  const handleReconnect = (oldEdge: Edge, c: Connection) => {
    if (!c.source || !c.target) return;
    setEdges((eds) => reconnectEdge(oldEdge, c, eds));
    onReconnectEdge(oldEdge.id, c.source, c.target);
  };

  const addAfterSelected = (type: NodeType) => {
    if (!selectedNode || !selectedRfNode) return;
    const position =
      viewMode === "swimlane"
        ? {
            x: selectedRfNode.position.x + 300,
            y: selectedRfNode.position.y,
          }
        : {
            x: selectedRfNode.position.x,
            y: selectedRfNode.position.y + 230,
          };
    onAddNode(
      type,
      selectedNode.actorId ?? graph.actors[0]?.id ?? null,
      position,
      selectedNode.id,
    );
  };

  const addHandled = useRef<number | null>(null);
  useEffect(() => {
    if (!addAfterRequest || addHandled.current === addAfterRequest.seq) return;
    addHandled.current = addAfterRequest.seq;
    addAfterSelected(addAfterRequest.type);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [addAfterRequest]);

  const handleCanvasDoubleClick = (event: ReactMouseEvent<HTMLDivElement>) => {
    if (
      !(event.target instanceof HTMLElement) ||
      !event.target.classList.contains("react-flow__pane")
    ) {
      return;
    }
    const point = flowRef.current?.screenToFlowPosition({
      x: event.clientX,
      y: event.clientY,
    });
    if (!point) return;
    const lane =
      viewMode === "swimlane"
        ? laid.lanes.find(
            (candidate) =>
              point.y >= candidate.y &&
              point.y < candidate.y + candidate.height,
          )
        : undefined;
    const actorId =
      lane?.actorId === "__unassigned__"
        ? graph.actors[0]?.id ?? null
        : lane?.actorId ??
          selectedNode?.actorId ??
          graph.actors[0]?.id ??
          null;
    onAddNode("process", actorId, point);
  };

  return (
    <NodeEditContext.Provider value={{ renameNode: onRenameNode }}>
    <div className="pf-canvas" onDoubleClick={handleCanvasDoubleClick}>
      <ReactFlow
        nodes={nodes}
        edges={edges}
        nodeTypes={nodeTypes}
        onNodesChange={handleNodesChange}
        onEdgesChange={onEdgesChange}
        onConnect={handleConnect}
        onReconnect={handleReconnect}
        onNodeClick={(_, n) => {
          if (n.id.startsWith("lane__")) return;
          onSelectEdge(null);
          onSelectNode(n.id);
        }}
        onEdgeClick={(_, edge) => {
          onSelectNode(null);
          onSelectEdge(edge.id);
        }}
        onDelete={({ nodes: deletedNodes, edges: deletedEdges }) =>
          onDeleteElements(
            deletedNodes
              .filter((node) => !node.id.startsWith("lane__"))
              .map((node) => node.id),
            deletedEdges.map((edge) => edge.id),
          )
        }
        onPaneClick={() => {
          onSelectNode(null);
          onSelectEdge(null);
        }}
        onInit={(instance) => {
          flowRef.current = instance;
        }}
        connectionMode={ConnectionMode.Loose}
        minZoom={0.05}
        maxZoom={2}
        proOptions={{ hideAttribution: true }}
      >
        <AutoFrame laid={laid} viewMode={viewMode} fitKey={fitKey} />
        <FocusNode laid={laid} request={focusRequest ?? null} />
        {viewMode === "swimlane" && <LaneRail lanes={laid.lanes} />}
        <Background variant={BackgroundVariant.Lines} gap={24} lineWidth={1} color="#EDF0F3" />
        <Controls showInteractive={false} fitViewOptions={{ padding: 0.08, minZoom: 0.05, maxZoom: 1 }} />
        <Panel position="top-left">
          <div className="pf-viewswitch" role="radiogroup" aria-label="Map view">
            <button
              type="button"
              role="radio"
              aria-checked={viewMode === "flowchart"}
              className={viewMode === "flowchart" ? "active" : ""}
              onClick={() => onChangeView("flowchart")}
            >
              <Icon name="flowchart" size={14} /> Flowchart
            </button>
            <button
              type="button"
              role="radio"
              aria-checked={viewMode === "swimlane"}
              className={viewMode === "swimlane" ? "active" : ""}
              onClick={() => onChangeView("swimlane")}
            >
              <Icon name="swimlane" size={14} /> Swimlanes
            </button>
          </div>
        </Panel>
        <Panel position="top-right">
          <button
            className="pf-canvas-button"
            type="button"
            title="Show the whole map"
            onClick={() =>
              flowRef.current?.fitView({
                padding: 0.08,
                minZoom: 0.05,
                maxZoom: 1,
                duration: 300,
              })
            }
          >
            <Icon name="fit" size={14} /> Whole map
          </button>
        </Panel>
        {!selectedNodeId && graph.nodes.length <= 4 && (
          <Panel position="bottom-center">
            <p className="pf-canvas-tip">Double-click empty space to add a step. Drag from a step's edge to connect it.</p>
          </Panel>
        )}
      </ReactFlow>
    </div>
    </NodeEditContext.Provider>
  );
}

/**
 * Frames the camera whenever `fitKey` changes (and on first mount): the whole
 * map if it fits legibly, otherwise a readable zoom on the start of the flow.
 * Uses layout()'s own sizes, so it doesn't wait for DOM measurement.
 */
function AutoFrame({
  laid,
  viewMode,
  fitKey,
}: {
  laid: LayoutResult;
  viewMode: ViewMode;
  fitKey: number;
}) {
  const { setViewport } = useReactFlow();
  const width = useStore((s) => s.width);
  const height = useStore((s) => s.height);
  const framed = useRef<number | null>(null);

  useEffect(() => {
    if (!width || !height || framed.current === fitKey) return;
    const bounds = layoutBounds(laid);
    if (!bounds) return;
    framed.current = fitKey;
    const { x, y, zoom } = readableViewport(
      bounds,
      { width, height },
      viewMode,
      flowAnchor(laid),
    );
    void setViewport({ x, y, zoom });
  }, [fitKey, laid, viewMode, width, height, setViewport]);

  return null;
}

const RAIL_WIDTH = 132;

/**
 * Lane names pinned to the left edge of the canvas. The lane labels inside the
 * diagram scroll away when you pan right or get tiny when zoomed out; this
 * rail appears in exactly those cases so you always know which lane is which.
 * It lives outside the React Flow viewport, so PNG export is unaffected.
 */
function LaneRail({ lanes }: { lanes: Lane[] }) {
  const [tx, ty, zoom] = useStore((s) => s.transform);
  // Hidden while the in-diagram label column is on screen and legible.
  const labelColumnVisible = tx + LANE_LABEL_OFFSET * zoom >= RAIL_WIDTH;
  if (!lanes.length || (labelColumnVisible && zoom >= 0.6)) return null;
  // pointer-events: none (CSS) — clicks and drags pass through to nodes beneath.
  return (
    <div className="pf-lane-rail" aria-hidden="true">
      {lanes.map((lane, i) => {
        const top = ty + lane.y * zoom;
        const h = lane.height * zoom;
        return (
          <div
            key={lane.actorId}
            className={`pf-lane-rail-item ${i % 2 === 1 ? "alt" : ""}`}
            style={{ top, height: h }}
          >
            <span>{lane.name}</span>
          </div>
        );
      })}
    </div>
  );
}

/** Centre the camera on a requested step at a readable zoom. */
function FocusNode({
  laid,
  request,
}: {
  laid: LayoutResult;
  request: { nodeId: string; seq: number } | null;
}) {
  const { setCenter, getZoom } = useReactFlow();
  const done = useRef<number | null>(null);
  useEffect(() => {
    if (!request || done.current === request.seq) return;
    const node = laid.nodes.find((n) => n.id === request.nodeId);
    if (!node) return;
    done.current = request.seq;
    const box = layoutBounds({ nodes: [node], edges: [], lanes: [] });
    if (!box) return;
    void setCenter(box.x + box.width / 2, box.y + box.height / 2, {
      zoom: Math.max(getZoom(), 0.85),
      duration: 350,
    });
  }, [request, laid, setCenter, getZoom]);
  return null;
}
