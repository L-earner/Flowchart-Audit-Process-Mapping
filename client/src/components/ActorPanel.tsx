import type { ProcessGraph } from "../types";
import Icon from "./Icon";

interface ActorPanelProps {
  graph: ProcessGraph;
  onRename: (actorId: string, name: string) => void;
  onMove: (actorId: string, dir: -1 | 1) => void;
  onDelete: (actorId: string) => void;
  onAdd: () => void;
}

/**
 * Manage the swimlanes / actors of the process: rename in place, reorder with
 * ▲/▼ (lane order follows the actors array), delete (its steps reassign to the
 * first remaining lane), or add a new one.
 */
export default function ActorPanel({
  graph,
  onRename,
  onMove,
  onDelete,
  onAdd,
}: ActorPanelProps) {
  const actors = graph.actors;
  const nodeCount = (actorId: string) =>
    graph.nodes.filter((n) => n.actorId === actorId).length;

  return (
    <section className="pf-section">
      <div className="pf-section-head">
        <h3>Lanes</h3>
        <button type="button" className="pf-link" onClick={onAdd}>
          <Icon name="plus" size={14} /> Add lane
        </button>
      </div>
      <p className="pf-hint">Each role, team or system gets a lane. Order here is the order on the swimlane view.</p>
      {actors.length === 0 && <p className="pf-muted">No lanes yet. Add one to group steps.</p>}
      <ul className="pf-lane-list">
        {actors.map((actor, index) => (
          <li key={actor.id}>
            <input
              aria-label={`Lane ${index + 1} name`}
              value={actor.name}
              onChange={(e) => onRename(actor.id, e.target.value)}
            />
            <span className="pf-lane-count" title="Steps in this lane">
              {nodeCount(actor.id)}
            </span>
            <div className="pf-icon-group">
              <button type="button" className="pf-icon-button" title="Move up" aria-label="Move lane up" disabled={index === 0} onClick={() => onMove(actor.id, -1)}>
                <Icon name="up" size={14} />
              </button>
              <button type="button" className="pf-icon-button" title="Move down" aria-label="Move lane down" disabled={index === actors.length - 1} onClick={() => onMove(actor.id, 1)}>
                <Icon name="down" size={14} />
              </button>
              <button
                type="button"
                className="pf-icon-button danger"
                title={`Delete lane (its ${nodeCount(actor.id)} step(s) move to the first lane)`}
                aria-label="Delete lane"
                disabled={actors.length === 1}
                onClick={() => onDelete(actor.id)}
              >
                <Icon name="trash" size={14} />
              </button>
            </div>
          </li>
        ))}
      </ul>
    </section>
  );
}
