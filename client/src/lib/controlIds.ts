import type { ProcessGraph } from "../types";
import { flowOrder } from "./flowOrder";

const PATTERN = /^C-(\d+)$/i;

export function formatControlId(n: number): string {
  return `C-${String(n).padStart(2, "0")}`;
}

/**
 * Give every control node a stable reference (C-01, C-02, …) for the RCM.
 *
 * - Existing ids are kept, including ones the user typed.
 * - Ids lost by an AI rewrite (refine / live ops replace the control object)
 *   are restored from `previous` by node id.
 * - New controls get the next number above the highest in use, in flow
 *   order, so existing references never shift when steps are added.
 *
 * Returns the same object when nothing changes (keeps undo/redo and React
 * memoisation cheap).
 */
export function assignControlIds(graph: ProcessGraph, previous?: ProcessGraph | null): ProcessGraph {
  const prior = new Map<string, string>();
  for (const n of previous?.nodes ?? []) {
    if (n.type === "control" && n.control?.controlId) prior.set(n.id, n.control.controlId);
  }

  let changed = false;
  const resolved = new Map<string, string>();
  for (const n of graph.nodes) {
    if (n.type !== "control") continue;
    const id = n.control?.controlId?.trim() || prior.get(n.id);
    if (id) resolved.set(n.id, id);
  }

  let max = 0;
  for (const id of resolved.values()) {
    const m = PATTERN.exec(id);
    if (m) max = Math.max(max, Number(m[1]));
  }
  for (const id of prior.values()) {
    const m = PATTERN.exec(id);
    if (m) max = Math.max(max, Number(m[1]));
  }

  for (const n of flowOrder(graph)) {
    if (n.type === "control" && !resolved.has(n.id)) resolved.set(n.id, formatControlId(++max));
  }

  const nodes = graph.nodes.map((n) => {
    if (n.type !== "control") return n;
    const controlId = resolved.get(n.id)!;
    if (n.control?.controlId === controlId) return n;
    changed = true;
    return {
      ...n,
      control: {
        controlType: n.control?.controlType ?? "manual",
        riskAddressed: n.control?.riskAddressed ?? "",
        ...n.control,
        controlId,
      },
    };
  });

  return changed ? { ...graph, nodes } : graph;
}
