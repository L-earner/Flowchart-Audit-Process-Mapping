import type { ProcessEdge, ProcessGraph } from "../types";

interface EdgeInspectorProps {
  graph: ProcessGraph;
  edge: ProcessEdge;
  onPatch: (patch: Partial<ProcessEdge>) => void;
  onDelete: () => void;
}

export default function EdgeInspector({
  graph,
  edge,
  onPatch,
  onDelete,
}: EdgeInspectorProps) {
  const source = graph.nodes.find((node) => node.id === edge.source);
  const target = graph.nodes.find((node) => node.id === edge.target);

  return (
    <div className="pf-inspector">
      <div className="pf-inspector-head">
        <h3>Edit connection</h3>
        <button className="pf-link-danger" onClick={onDelete}>
          Delete
        </button>
      </div>
      <p className="pf-connection-path">
        <strong>{source?.label ?? edge.source}</strong>
        <span aria-hidden="true"> to </span>
        <strong>{target?.label ?? edge.target}</strong>
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
