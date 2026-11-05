import {
  Handle,
  Position,
  type NodeProps,
} from "@xyflow/react";
import { useEffect, useRef, useState } from "react";
import type { ProcessNodeData } from "../../lib/layout";
import { useNodeEdit } from "./nodeEditContext";

/**
 * One connectable handle per side. The canvas runs in loose connection mode,
 * so every handle works as both source and target; layout.ts picks the pair
 * per edge by direction (ids "t"/"b"/"l"/"r").
 */
function Handles() {
  return (
    <>
      <Handle type="source" position={Position.Top} id="t" />
      <Handle type="source" position={Position.Bottom} id="b" />
      <Handle type="source" position={Position.Left} id="l" />
      <Handle type="source" position={Position.Right} id="r" />
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

/** Small "?" marker on steps that have open points to confirm. */
function OpenPointFlag({ count }: { count?: number }) {
  if (!count) return null;
  return (
    <span
      className="pf-open-flag"
      title={`${count} open point${count === 1 ? "" : "s"} to confirm (see Review)`}
    >
      ?{count > 1 ? <small>{count}</small> : null}
    </span>
  );
}

const ShieldIcon = () => (
  <svg width="11" height="12" viewBox="0 0 10 11" fill="currentColor" aria-hidden="true">
    <path d="M5 0 9.5 1.8v3.1c0 2.7-1.9 4.8-4.5 6.1C2.4 9.7.5 7.6.5 4.9V1.8L5 0z" />
  </svg>
);

const GearIcon = () => (
  <svg width="12" height="12" viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth="1.6" aria-hidden="true">
    <circle cx="8" cy="8" r="2.3" />
    <path d="M8 1.5v2M8 12.5v2M1.5 8h2M12.5 8h2M3.4 3.4l1.4 1.4M11.2 11.2l1.4 1.4M3.4 12.6l1.4-1.4M11.2 4.8l1.4-1.4" strokeLinecap="round" />
  </svg>
);

export function StepNode({ data, selected }: NodeProps) {
  const { node, actorName, openPoints } = data as ProcessNodeData;
  const isSystem = node.type === "system";
  return (
    <div className={`pf-node pf-step ${isSystem ? "pf-system" : ""} ${selected ? "pf-selected" : ""}`}>
      <Handles />
      <OpenPointFlag count={openPoints} />
      {isSystem && (
        <span className="pf-node-kind">
          <GearIcon /> Automated
        </span>
      )}
      <EditableLabel nodeId={node.id} label={node.label} />
      {actorName && <div className="pf-actor">{actorName}</div>}
    </div>
  );
}

export function TerminalNode({ data, selected }: NodeProps) {
  const { node, openPoints } = data as ProcessNodeData;
  return (
    <div className={`pf-node pf-terminal pf-terminal-${node.type} ${selected ? "pf-selected" : ""}`}>
      <Handles />
      <OpenPointFlag count={openPoints} />
      <EditableLabel nodeId={node.id} label={node.label} />
    </div>
  );
}

export function DecisionNode({ data, selected }: NodeProps) {
  const { node, actorName, openPoints } = data as ProcessNodeData;
  return (
    <div className={`pf-decision-wrap ${selected ? "pf-selected" : ""}`}>
      <Handles />
      <OpenPointFlag count={openPoints} />
      <div className="pf-decision" aria-hidden="true" />
      <EditableLabel nodeId={node.id} label={node.label} className="pf-label pf-decision-label" />
      {actorName && <div className="pf-actor pf-actor-below">{actorName}</div>}
    </div>
  );
}

export function ControlNode({ data, selected }: NodeProps) {
  const { node, actorName, openPoints } = data as ProcessNodeData;
  const ctrl = node.control;
  return (
    <div className={`pf-node pf-control ${selected ? "pf-selected" : ""}`}>
      <Handles />
      <OpenPointFlag count={openPoints} />
      <div className="pf-control-badge">
        <ShieldIcon />
        <span>Control</span>
        {ctrl?.controlId && <span className="pf-control-ref">{ctrl.controlId}</span>}
      </div>
      <EditableLabel nodeId={node.id} label={node.label} />
      {ctrl && (
        <div className="pf-control-meta">
          <span className="pf-tag">{ctrl.controlType}</span>
          {ctrl.frequency && <span className="pf-tag pf-tag-muted">{ctrl.frequency}</span>}
        </div>
      )}
      {ctrl?.riskAddressed && (
        <div className="pf-risk" title={ctrl.riskAddressed}>
          {ctrl.riskAddressed}
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
