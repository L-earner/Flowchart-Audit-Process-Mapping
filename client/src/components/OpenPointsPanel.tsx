import { useState } from "react";
import type { ProcessGraph } from "../types";
import { KIND_LABEL, orderedOpenPoints, questionsForOwner } from "../lib/openPoints";
import Icon from "./Icon";

interface OpenPointsPanelProps {
  graph: ProcessGraph;
  selectedNodeId: string | null;
  onShowStep: (nodeId: string) => void;
  onResolve: (pointId: string) => void;
}

/**
 * The extraction's open points log: gaps, ambiguities and assumptions, each
 * with a follow-up question for the process owner.
 */
export default function OpenPointsPanel({
  graph,
  selectedNodeId,
  onShowStep,
  onResolve,
}: OpenPointsPanelProps) {
  const [copied, setCopied] = useState<"ok" | "failed" | null>(null);
  if (!graph.openPoints) return null; // maps made before this feature
  const points = orderedOpenPoints(graph);
  const label = new Map(graph.nodes.map((n) => [n.id, n.label]));

  async function copy() {
    try {
      await navigator.clipboard.writeText(questionsForOwner(graph));
      setCopied("ok");
    } catch {
      setCopied("failed");
    }
    setTimeout(() => setCopied(null), 2500);
  }

  return (
    <section className="pf-section pf-open-points">
      <div className="pf-section-head">
        <h3>
          Open points {points.length > 0 && <span className="pf-count">{points.length}</span>}
        </h3>
        {points.length > 0 && (
          <button type="button" className="pf-link" onClick={() => void copy()}>
            <Icon name={copied === "ok" ? "check" : "copy"} size={14} />
            {copied === "ok" ? "Copied" : copied === "failed" ? "Copy failed" : "Copy questions"}
          </button>
        )}
      </div>
      {points.length > 0 && (
        <p className="pf-hint">Things to confirm with the process owner before relying on this map.</p>
      )}
      {points.length === 0 ? (
        <p className="pf-hint">Nothing to confirm. The source covered everything that was checked.</p>
      ) : (
        <ul>
          {points.map((p) => {
            const step = p.nodeId ? label.get(p.nodeId) : undefined;
            return (
              <li key={p.id} className={p.nodeId && p.nodeId === selectedNodeId ? "active" : ""}>
                <div className="pf-open-meta">
                  <span className={`pf-open-kind ${p.kind}`}>{KIND_LABEL[p.kind]}</span>
                  {step ? (
                    <button type="button" className="pf-open-step" onClick={() => onShowStep(p.nodeId!)} title="Show this step on the map">
                      {step}
                    </button>
                  ) : (
                    <span className="pf-open-step whole">Whole process</span>
                  )}
                </div>
                <p className="pf-open-issue">{p.issue}</p>
                <p className="pf-open-question">
                  <strong>Ask:</strong> {p.question}
                </p>
                <button type="button" className="pf-open-resolve" onClick={() => onResolve(p.id)} title="Remove from the list (Undo brings it back)">
                  Mark resolved
                </button>
              </li>
            );
          })}
        </ul>
      )}
    </section>
  );
}
