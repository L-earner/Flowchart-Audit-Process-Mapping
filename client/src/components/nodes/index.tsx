import {
  Handle,
  Position,
  type NodeProps,
} from "@xyflow/react";
import { useEffect, useRef, useState } from "react";
import type { ProcessNodeData } from "../../lib/layout";
import { useNodeEdit } from "./nodeEditContext";

const handleStyle = { width: 12, height: 12, background: "#64748b" };

function Handles() {
  return (
    <>
      <Handle type="target" position={Position.Top} style={handleStyle} />
      <Handle type="source" position={Position.Bottom} style={handleStyle} />
      <Handle type="target" position={Position.Left} id="l" style={handleStyle} />
      <Handle type="source" position={Position.Right} id="r" style={handleStyle} />
    </>
  );
}

/**
 * The node label, editable in place: double-click to edit, Enter/blur commits,
 * Esc cancels. Stops propagation so editing doesn't pan the canvas or trigger
 * the pane's double-click-to-add.
 */
function EditableLabel({
  nodeId,
  label,
  className = "pf-label",
}: {
  nodeId: string;
  label: string;
  className?: string;
}) {
  const { renameNode } = useNodeEdit();
  const [editing, setEditing] = useState(false);
  const [draft, setDraft] = useState(label);
  const inputRef = useRef<HTMLInputElement | null>(null);

  useEffect(() => {
    if (editing) {
      inputRef.current?.focus();
      inputRef.current?.select();
    }
  }, [editing]);

  function start() {
    setDraft(label);
    setEditing(true);
  }

  function commit() {
    setEditing(false);
    const next = draft.trim();
    if (next && next !== label) renameNode(nodeId, next);
  }

  if (editing) {
    return (
      <input
        ref={inputRef}
        className="pf-label-edit nodrag nopan"
        value={draft}
        onChange={(e) => setDraft(e.target.value)}
        onBlur={commit}
        onKeyDown={(e) => {
          e.stopPropagation();
          if (e.key === "Enter") {
            e.preventDefault();
            commit();
          } else if (e.key === "Escape") {
            e.preventDefault();
            setEditing(false);
          }
        }}
        onDoubleClick={(e) => e.stopPropagation()}
      />
    );
  }

  return (
    <div
      className={className}
      title="Double-click to rename"
      onDoubleClick={(e) => {
        e.stopPropagation();
        start();
      }}
    >
      {label}
    </div>
  );
}

export function StepNode({ data, selected }: NodeProps) {
  const { node, actorName } = data as ProcessNodeData;
  const isSystem = node.type === "system";
  return (
    <div className={`pf-node pf-step ${isSystem ? "pf-system" : ""} ${selected ? "pf-selected" : ""}`}>
      <Handles />
      <EditableLabel nodeId={node.id} label={node.label} />
      {actorName && <div className="pf-actor">{actorName}</div>}
    </div>
  );
}

export function TerminalNode({ data, selected }: NodeProps) {
  const { node } = data as ProcessNodeData;
  return (
    <div className={`pf-node pf-terminal pf-terminal-${node.type} ${selected ? "pf-selected" : ""}`}>
      <Handles />
      <EditableLabel nodeId={node.id} label={node.label} />
    </div>
  );
}

export function DecisionNode({ data, selected }: NodeProps) {
  const { node, actorName } = data as ProcessNodeData;
  return (
    <div className={`pf-decision-wrap ${selected ? "pf-selected" : ""}`}>
      <Handles />
      <div className="pf-decision">
        <EditableLabel nodeId={node.id} label={node.label} />
      </div>
      {actorName && <div className="pf-actor pf-actor-below">{actorName}</div>}
    </div>
  );
}

export function ControlNode({ data, selected }: NodeProps) {
  const { node, actorName } = data as ProcessNodeData;
  const ctrl = node.control;
  return (
    <div className={`pf-node pf-control ${selected ? "pf-selected" : ""}`}>
      <Handles />
      <div className="pf-control-badge">🛡 CONTROL</div>
      <EditableLabel nodeId={node.id} label={node.label} />
      {ctrl && (
        <div className="pf-control-meta">
          <span className="pf-tag">{ctrl.controlType}</span>
          {ctrl.frequency && <span className="pf-tag pf-tag-muted">{ctrl.frequency}</span>}
        </div>
      )}
      {ctrl?.riskAddressed && (
        <div className="pf-risk" title={ctrl.riskAddressed}>
          ⚠ {ctrl.riskAddressed}
        </div>
      )}
      {actorName && <div className="pf-actor">{actorName}</div>}
    </div>
  );
}

export function LaneNode({ data }: NodeProps) {
  const d = data as unknown as {
    laneName: string;
    laneWidth: number;
    laneHeight: number;
    alt: boolean;
  };
  return (
    <div
      className={`pf-lane-node ${d.alt ? "pf-lane-alt" : ""}`}
      style={{ width: d.laneWidth, height: d.laneHeight }}
    >
      <div className="pf-lane-label">{d.laneName}</div>
    </div>
  );
}

export const nodeTypes = {
  step: StepNode,
  terminal: TerminalNode,
  decision: DecisionNode,
  control: ControlNode,
  lane: LaneNode,
};
