import type { ProcessEdge, ProcessGraph, ProcessNode } from "../types";

interface EdgeInspectorProps {
  graph: ProcessGraph;
  edge: ProcessEdge;
  onPatch: (patch: Partial<ProcessEdge>) => void;
  onDelete: () => void;
}

function nodeOptionLabel(node: ProcessNode): string {
  return `${node.label} · ${node.type}`;
}

export default function EdgeInspector({
  graph,
  edge,
  onPatch,
  onDelete,
}: EdgeInspectorProps) {
  return (
    <div className="pf-inspector">
      <div className="pf-inspector-head">
        <h3>Edit connection</h3>
        <button className="pf-link-danger" onClick={onDelete}>
          Delete
        </button>
      </div>

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

      <p className="pf-hint">
        Re-point either end to reroute this connection — no need to delete and
        redraw.
      </p>

      <label>Outcome / condition</label>
      <input
        value={edge.label ?? ""}
        placeholder="e.g. approved, rejected, yes, no"
        onChange={(event) => onPatch({ label: event.target.value || undefined })}
      />
      <p className="pf-hint">
        Label outgoing decision branches so the path remains clear.
      </p>
    </div>
  );
}
