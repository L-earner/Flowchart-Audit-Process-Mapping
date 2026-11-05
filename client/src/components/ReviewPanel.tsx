import type { ProcessGraph } from "../types";
import type { GraphQuality } from "../lib/graphQuality";
import OpenPointsPanel from "./OpenPointsPanel";
import Icon from "./Icon";

interface ReviewPanelProps {
  graph: ProcessGraph;
  quality: GraphQuality;
  selectedNodeId: string | null;
  onShowStep: (nodeId: string) => void;
  onResolve: (pointId: string) => void;
}

/** Map checks (structure) and the open points log (content) in one place. */
export default function ReviewPanel({ graph, quality, selectedNodeId, onShowStep, onResolve }: ReviewPanelProps) {
  const passed = Math.round((quality.score / 100) * 5);
  return (
    <>
      <section className="pf-section">
        <h3>Map checks</h3>
        <dl className="pf-stats">
          {quality.checks.map((check) => (
            <div key={check.label} className={check.status}>
              <dt>{check.label}</dt>
              <dd>{check.value}</dd>
            </div>
          ))}
        </dl>
        {quality.warnings.length === 0 ? (
          <p className="pf-check-ok">
            <Icon name="check" size={14} /> All 5 structure checks pass: start, end, connected steps, control
            risks and labelled decisions.
          </p>
        ) : (
          <>
            <p className="pf-hint">
              {passed} of 5 structure checks pass. Fix these on the map:
            </p>
            <ul className="pf-check-list">
              {quality.warnings.map((warning) => (
                <li key={warning}>
                  <Icon name="alert" size={14} />
                  {warning}
                </li>
              ))}
            </ul>
          </>
        )}
      </section>
      <OpenPointsPanel graph={graph} selectedNodeId={selectedNodeId} onShowStep={onShowStep} onResolve={onResolve} />
    </>
  );
}
