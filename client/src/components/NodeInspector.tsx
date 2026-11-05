import { useEffect, useState } from "react";
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
          <label>Control ID</label>
          <ControlIdInput
            key={node.id}
            value={node.control?.controlId ?? ""}
            onCommit={(controlId) => onPatchControl({ controlId })}
          />
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

/**
 * Edited as a draft and committed on blur/Enter: committing every keystroke
 * would let auto-numbering refill the field the moment it's cleared.
 */
function ControlIdInput({ value, onCommit }: { value: string; onCommit: (v: string) => void }) {
  const [draft, setDraft] = useState(value);
  useEffect(() => setDraft(value), [value]);
  const commit = () => {
    const next = draft.trim();
    if (next && next !== value) onCommit(next);
    else setDraft(value);
  };
  return (
    <input
      value={draft}
      placeholder="e.g. C-01"
      title="Reference used in the Risk & Control Matrix. Leave as-is to keep auto-numbering."
      onChange={(e) => setDraft(e.target.value)}
      onBlur={commit}
      onKeyDown={(e) => {
        if (e.key === "Enter") (e.target as HTMLInputElement).blur();
        if (e.key === "Escape") setDraft(value);
      }}
    />
  );
}
