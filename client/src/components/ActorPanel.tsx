import type { ProcessGraph } from "../types";

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
    <div className="pf-actors">
      <div className="pf-actors-head">
        <h4>Lanes / actors</h4>
        <button type="button" className="pf-actor-add" onClick={onAdd}>
          + Add lane
        </button>
      </div>
      {actors.length === 0 && (
        <p className="pf-muted">No lanes yet. Add one to group steps.</p>
      )}
      <ul className="pf-actor-list">
        {actors.map((actor, index) => (
          <li key={actor.id} className="pf-actor-row">
            <input
              className="pf-actor-name"
              value={actor.name}
              onChange={(e) => onRename(actor.id, e.target.value)}
            />
            <div className="pf-actor-actions">
              <button
                type="button"
                title="Move lane up"
                disabled={index === 0}
                onClick={() => onMove(actor.id, -1)}
              >
                ▲
              </button>
              <button
                type="button"
                title="Move lane down"
                disabled={index === actors.length - 1}
                onClick={() => onMove(actor.id, 1)}
              >
                ▼
              </button>
              <button
                type="button"
                className="pf-actor-del"
                title={`Delete lane (${nodeCount(actor.id)} step(s) reassigned)`}
                disabled={actors.length === 1}
                onClick={() => onDelete(actor.id)}
              >
                ✕
              </button>
            </div>
          </li>
        ))}
      </ul>
    </div>
  );
}
