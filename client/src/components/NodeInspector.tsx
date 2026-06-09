import type { ProcessGraph, ProcessNode, NodeType, ControlType } from "../types";
import { NODE_TYPES } from "../types";

const CONTROL_TYPES: ControlType[] = [
  "preventive",
  "detective",
  "manual",
  "automated",
];

interface NodeInspectorProps {
  graph: ProcessGraph;
  node: ProcessNode;
  onPatch: (patch: Partial<ProcessNode>) => void;
  onPatchControl: (patch: Partial<NonNullable<ProcessNode["control"]>>) => void;
  onDelete: () => void;
}

export default function NodeInspector({
  graph,
  node,
  onPatch,
  onPatchControl,
  onDelete,
}: NodeInspectorProps) {
  return (
    <div className="pf-inspector">
      <div className="pf-inspector-head">
        <h3>Edit step</h3>
        <button className="pf-link-danger" onClick={onDelete}>
          Delete
        </button>
      </div>

      <label>Label</label>
      <input
        value={node.label}
        onChange={(e) => onPatch({ label: e.target.value })}
      />

      <label>Type</label>
      <select
        value={node.type}
        onChange={(e) => onPatch({ type: e.target.value as NodeType })}
      >
        {NODE_TYPES.map((t) => (
          <option key={t} value={t}>
            {t}
          </option>
        ))}
      </select>

      <label>Actor / lane</label>
      <select
        value={node.actorId ?? ""}
        onChange={(e) => onPatch({ actorId: e.target.value || null })}
      >
        <option value="">(none — start/end)</option>
        {graph.actors.map((a) => (
          <option key={a.id} value={a.id}>
            {a.name}
          </option>
        ))}
      </select>

      <label>Description</label>
      <textarea
        rows={3}
        value={node.description ?? ""}
        onChange={(e) => onPatch({ description: e.target.value })}
      />

      {node.type === "control" && (
        <div className="pf-control-edit">
          <h4>🛡 Control details</h4>
          <label>Control type</label>
          <select
            value={node.control?.controlType ?? "manual"}
            onChange={(e) =>
              onPatchControl({ controlType: e.target.value as ControlType })
            }
          >
            {CONTROL_TYPES.map((t) => (
              <option key={t} value={t}>
                {t}
              </option>
            ))}
          </select>

          <label>Risk addressed</label>
          <textarea
            rows={2}
            value={node.control?.riskAddressed ?? ""}
            onChange={(e) => onPatchControl({ riskAddressed: e.target.value })}
          />

          <label>Frequency</label>
          <input
            value={node.control?.frequency ?? ""}
            placeholder="e.g. per transaction, monthly"
            onChange={(e) => onPatchControl({ frequency: e.target.value })}
          />
        </div>
      )}
    </div>
  );
}
