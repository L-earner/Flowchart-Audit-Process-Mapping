import type { NodeType, ProcessEdge, ProcessGraph, ProcessNode } from "../types";
import NodeInspector from "./NodeInspector";
import EdgeInspector from "./EdgeInspector";
import Icon from "./Icon";

interface InspectorProps {
  graph: ProcessGraph;
  node: ProcessNode | null;
  edge: ProcessEdge | null;
  onClose: () => void;
  onPatchNode: (patch: Partial<ProcessNode>) => void;
  onPatchControl: (patch: Partial<NonNullable<ProcessNode["control"]>>) => void;
  onDeleteNode: () => void;
  onAddAfter: (type: NodeType) => void;
  onPatchEdge: (patch: Partial<ProcessEdge>) => void;
  onDeleteEdge: () => void;
}

const KIND: Record<NodeType, string> = {
  start: "Start",
  end: "End",
  process: "Step",
  decision: "Decision",
  control: "Control",
  system: "Automated step",
};

/** Slides in beside the canvas while a step or connection is selected. */
export default function Inspector(props: InspectorProps) {
  const { graph, node, edge, onClose } = props;
  if (!node && !edge) return null;
  return (
    <aside className="pf-inspector-panel" aria-label={node ? "Edit step" : "Edit connection"}>
      <header className="pf-inspector-bar">
        <div>
          <span className={`pf-kind-dot ${node ? node.type : "edge"}`} aria-hidden="true" />
          <h2>{node ? KIND[node.type] : "Connection"}</h2>
        </div>
        <div className="pf-icon-group">
          <button
            type="button"
            className="pf-icon-button danger"
            title={node ? "Delete step" : "Delete connection"}
            aria-label={node ? "Delete step" : "Delete connection"}
            onClick={node ? props.onDeleteNode : props.onDeleteEdge}
          >
            <Icon name="trash" />
          </button>
          <button type="button" className="pf-icon-button" title="Close (Esc)" aria-label="Close" onClick={onClose}>
            <Icon name="close" />
          </button>
        </div>
      </header>
      <div className="pf-inspector-body">
        {node && (
          <>
            <NodeInspector
              graph={graph}
              node={node}
              onPatch={props.onPatchNode}
              onPatchControl={props.onPatchControl}
              onDelete={props.onDeleteNode}
            />
            {node.type !== "end" && (
              <section className="pf-section">
                <h3>Add the next step</h3>
                <div className="pf-chip-row">
                  {(["process", "decision", "control", "system"] as const).map((t) => (
                    <button key={t} type="button" className="pf-chip" onClick={() => props.onAddAfter(t)}>
                      <span className={`pf-kind-dot ${t}`} aria-hidden="true" />
                      {KIND[t]}
                    </button>
                  ))}
                </div>
              </section>
            )}
          </>
        )}
        {edge && <EdgeInspector graph={graph} edge={edge} onPatch={props.onPatchEdge} onDelete={props.onDeleteEdge} />}
      </div>
    </aside>
  );
}
