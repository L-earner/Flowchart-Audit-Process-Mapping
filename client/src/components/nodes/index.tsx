import { Handle, Position, type NodeProps } from "@xyflow/react";
import type { ProcessNodeData } from "../../lib/layout";

const handleStyle = { width: 8, height: 8, background: "#94a3b8" };

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

export function StepNode({ data, selected }: NodeProps) {
  const { node, actorName } = data as ProcessNodeData;
  const isSystem = node.type === "system";
  return (
    <div className={`pf-node pf-step ${isSystem ? "pf-system" : ""} ${selected ? "pf-selected" : ""}`}>
      <Handles />
      <div className="pf-label">{node.label}</div>
      {actorName && <div className="pf-actor">{actorName}</div>}
    </div>
  );
}

export function TerminalNode({ data, selected }: NodeProps) {
  const { node } = data as ProcessNodeData;
  return (
    <div className={`pf-node pf-terminal pf-terminal-${node.type} ${selected ? "pf-selected" : ""}`}>
      <Handles />
      <div className="pf-label">{node.label}</div>
    </div>
  );
}

export function DecisionNode({ data, selected }: NodeProps) {
  const { node, actorName } = data as ProcessNodeData;
  return (
    <div className={`pf-decision-wrap ${selected ? "pf-selected" : ""}`}>
      <Handles />
      <div className="pf-decision">
        <span className="pf-label">{node.label}</span>
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
      <div className="pf-label">{node.label}</div>
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
