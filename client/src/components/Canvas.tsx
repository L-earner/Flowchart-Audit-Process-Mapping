import { useEffect, useMemo, useRef, type MouseEvent as ReactMouseEvent } from "react";
import {
  ReactFlow,
  Background,
  Controls,
  MiniMap,
  Panel,
  useNodesState,
  useEdgesState,
  addEdge,
  applyNodeChanges,
  reconnectEdge,
  type Connection,
  type Edge,
  type NodeChange,
  type ReactFlowInstance,
} from "@xyflow/react";
import "@xyflow/react/dist/style.css";
import type { NodeType, ProcessGraph, ViewMode } from "../types";
import { layout, type RFNode } from "../lib/layout";
import { nodeTypes } from "./nodes";
import { NodeEditContext } from "./nodes/nodeEditContext";

interface CanvasProps {
  graph: ProcessGraph;
  viewMode: ViewMode;
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
        minZoom={0.05}
        maxZoom={2}
        fitView
        fitViewOptions={{ padding: 0.08, minZoom: 0.05, maxZoom: 1 }}
        proOptions={{ hideAttribution: true }}
      >
        <Background gap={18} color="#eef2f7" />
        <Controls fitViewOptions={{ padding: 0.08, minZoom: 0.05, maxZoom: 1 }} />
        <MiniMap pannable zoomable />
        <Panel position="top-left">
          <div className="pf-canvas-help">
            {selectedNode ? (
              <>
                <strong>Add after selected</strong>
                <div className="pf-canvas-quick-actions">
                  <button type="button" onClick={() => addAfterSelected("process")}>
                    Step
                  </button>
                  <button type="button" onClick={() => addAfterSelected("decision")}>
                    Decision
                  </button>
                  <button type="button" onClick={() => addAfterSelected("control")}>
                    Control
                  </button>
                  <button type="button" onClick={() => addAfterSelected("system")}>
                    System
                  </button>
                  <button
                    type="button"
                    className="danger"
                    onClick={() => onDeleteElements([selectedNode.id], [])}
                  >
                    Delete
                  </button>
                </div>
              </>
            ) : (
              <span>Double-click empty space to add a step</span>
            )}
          </div>
        </Panel>
        <Panel position="top-right">
          <button
            className="pf-fit-map"
            type="button"
            onClick={() =>
              flowRef.current?.fitView({
                padding: 0.08,
                minZoom: 0.05,
                maxZoom: 1,
                duration: 300,
              })
            }
          >
            Fit entire map
          </button>
        </Panel>
      </ReactFlow>
    </div>
    </NodeEditContext.Provider>
  );
}
