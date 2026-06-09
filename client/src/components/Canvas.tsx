import { useEffect, useMemo } from "react";
import {
  ReactFlow,
  Background,
  Controls,
  MiniMap,
  useNodesState,
  useEdgesState,
  addEdge,
  type Connection,
  type NodeChange,
} from "@xyflow/react";
import "@xyflow/react/dist/style.css";
import type { ProcessGraph, ViewMode } from "../types";
import { layout, type RFNode } from "../lib/layout";
import { nodeTypes } from "./nodes";

interface CanvasProps {
  graph: ProcessGraph;
  viewMode: ViewMode;
  onSelectNode: (nodeId: string | null) => void;
  /** Persist node position edits back up to the parent graph. */
  onNodePositions: (positions: Record<string, { x: number; y: number }>) => void;
  onConnect: (source: string, target: string) => void;
}

export default function Canvas({
  graph,
  viewMode,
  onSelectNode,
  onNodePositions,
  onConnect,
}: CanvasProps) {
  const laid = useMemo(() => layout(graph, viewMode), [graph, viewMode]);
  const [nodes, setNodes, onNodesChange] = useNodesState<RFNode>(laid.nodes);
  const [edges, setEdges, onEdgesChange] = useEdgesState(laid.edges);

  // Re-layout when the graph or view changes.
  useEffect(() => {
    setNodes(laid.nodes);
    setEdges(laid.edges);
  }, [laid, setNodes, setEdges]);

  const handleNodesChange = (changes: NodeChange<RFNode>[]) => {
    onNodesChange(changes);
    const dragEnd = changes.some(
      (c) => c.type === "position" && c.dragging === false,
    );
    if (dragEnd) {
      const positions: Record<string, { x: number; y: number }> = {};
      for (const n of nodes) {
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

  return (
    <div className="pf-canvas">
      <ReactFlow
        nodes={nodes}
        edges={edges}
        nodeTypes={nodeTypes}
        onNodesChange={handleNodesChange}
        onEdgesChange={onEdgesChange}
        onConnect={handleConnect}
        onNodeClick={(_, n) => {
          if (n.id.startsWith("lane__")) return;
          onSelectNode(n.id);
        }}
        onPaneClick={() => onSelectNode(null)}
        fitView
        proOptions={{ hideAttribution: true }}
      >
        <Background gap={18} color="#eef2f7" />
        <Controls />
        <MiniMap pannable zoomable />
      </ReactFlow>
    </div>
  );
}
