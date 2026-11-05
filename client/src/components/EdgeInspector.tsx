import type { ProcessEdge, ProcessGraph, ProcessNode } from "../types";

interface EdgeInspectorProps {
  graph: ProcessGraph;
  edge: ProcessEdge;
  onPatch: (patch: Partial<ProcessEdge>) => void;
  onDelete: () => void;
}

function nodeOptionLabel(node: ProcessNode): string {
  return node.label;
}

export default function EdgeInspector({
  graph,
  edge,
  onPatch,
  onDelete: _onDelete,
}: EdgeInspectorProps) {
  return (
    <div className="pf-inspector">

      <label>From</label>
      <select
        value={edge.source}
        onChange={(event) => onPatch({ source: event.target.value })}
      >
        {graph.nodes.map((node) => (
          <option key={node.id} value={node.id}>
            {nodeOptionLabel(node)}
          </option>
        ))}
      </select>

      <label>To</label>
      <select
        value={edge.target}
        onChange={(event) => onPatch({ target: event.target.value })}
      >
        {graph.nodes.map((node) => (
          <option key={node.id} value={node.id}>
            {nodeOptionLabel(node)}
          </option>
        ))}
      </select>

      <p className="pf-hint">Change either end to reroute the connection.</p>

      <label>Condition</label>
      <input
        value={edge.label ?? ""}
        placeholder="e.g. approved, rejected, yes, no"
        onChange={(event) => onPatch({ label: event.target.value || undefined })}
      />
      <p className="pf-hint">Label each branch leaving a decision so the path is clear.</p>
    </div>
  );
}
