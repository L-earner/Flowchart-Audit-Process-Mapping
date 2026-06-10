import type { ProcessGraph } from "../types";

/**
 * Produce a short human-readable summary of what changed between two graphs —
 * used to tell the user what an AI "Update current map" actually did, so they
 * can decide whether to keep it or undo. Counts only; not a full diff.
 */
export function summarizeChange(prev: ProcessGraph, next: ProcessGraph): string {
  const parts: string[] = [];

  const stepDelta =
    countSteps(next) - countSteps(prev);
  if (stepDelta !== 0) parts.push(`${signed(stepDelta)} step${plural(stepDelta)}`);

  const controlDelta =
    countType(next, "control") - countType(prev, "control");
  if (controlDelta !== 0)
    parts.push(`${signed(controlDelta)} control${plural(controlDelta)}`);

  const decisionDelta =
    countType(next, "decision") - countType(prev, "decision");
  if (decisionDelta !== 0)
    parts.push(`${signed(decisionDelta)} decision${plural(decisionDelta)}`);

  const edgeDelta = next.edges.length - prev.edges.length;
  if (edgeDelta !== 0)
    parts.push(`${signed(edgeDelta)} connection${plural(edgeDelta)}`);

  const actorDelta = next.actors.length - prev.actors.length;
  if (actorDelta !== 0)
    parts.push(`${signed(actorDelta)} lane${plural(actorDelta)}`);

  // Renames: same id, different label.
  const prevLabels = new Map(prev.nodes.map((n) => [n.id, n.label]));
  let renamed = 0;
  for (const n of next.nodes) {
    const before = prevLabels.get(n.id);
    if (before !== undefined && before !== n.label) renamed += 1;
  }
  if (renamed > 0) parts.push(`${renamed} step${plural(renamed)} renamed`);

  if (parts.length === 0) return "no structural changes";
  return parts.join(", ");
}

/** Steps = everything except start/end markers. */
function countSteps(graph: ProcessGraph): number {
  return graph.nodes.filter((n) => n.type !== "start" && n.type !== "end")
    .length;
}

function countType(graph: ProcessGraph, type: string): number {
  return graph.nodes.filter((n) => n.type === type).length;
}

function signed(n: number): string {
  return n > 0 ? `+${n}` : `${n}`;
}

function plural(n: number): string {
  return Math.abs(n) === 1 ? "" : "s";
}
