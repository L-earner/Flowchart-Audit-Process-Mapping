import type { ProcessGraph, ProcessNode } from "../types";

/**
 * Steps in reading order: by longest-path distance from the start (loops /
 * back-edges ignored), ties broken by depth-first discovery order. So a
 * decision's branches come right after it, exception branches don't get
 * pushed past the end node, and the end comes last. Unreachable steps are
 * appended in their original order. Used for control numbering, the RCM, and
 * the narrative so all three agree.
 */
export function flowOrder(graph: ProcessGraph): ProcessNode[] {
  const byId = new Map(graph.nodes.map((n) => [n.id, n]));
  const out = new Map<string, string[]>();
  for (const n of graph.nodes) out.set(n.id, []);
  for (const e of graph.edges) {
    if (byId.has(e.source) && byId.has(e.target)) out.get(e.source)!.push(e.target);
  }

  const starts = graph.nodes.filter((n) => n.type === "start");
  const roots = [
    ...starts,
    // Nodes nothing points at are also entry points (e.g. no start marker).
    ...graph.nodes.filter(
      (n) => n.type !== "start" && !graph.edges.some((e) => e.target === n.id),
    ),
  ];

  // DFS: discovery order + back-edge detection.
  const discovery = new Map<string, number>();
  const onStack = new Set<string>();
  const backEdges = new Set<string>();
  const visit = (id: string) => {
    discovery.set(id, discovery.size);
    onStack.add(id);
    for (const next of out.get(id)!) {
      if (onStack.has(next)) backEdges.add(`${id}->${next}`);
      else if (!discovery.has(next)) visit(next);
    }
    onStack.delete(id);
  };
  for (const r of roots) if (!discovery.has(r.id)) visit(r.id);
  for (const n of graph.nodes) if (!discovery.has(n.id)) visit(n.id);

  // Longest path over the remaining DAG, processed in topological order.
  const indegree = new Map(graph.nodes.map((n) => [n.id, 0]));
  for (const [src, targets] of out) {
    for (const t of targets) if (!backEdges.has(`${src}->${t}`)) indegree.set(t, indegree.get(t)! + 1);
  }
  const rank = new Map(graph.nodes.map((n) => [n.id, 0]));
  const queue = graph.nodes.filter((n) => indegree.get(n.id) === 0).map((n) => n.id);
  while (queue.length) {
    const id = queue.shift()!;
    for (const t of out.get(id)!) {
      if (backEdges.has(`${id}->${t}`)) continue;
      rank.set(t, Math.max(rank.get(t)!, rank.get(id)! + 1));
      indegree.set(t, indegree.get(t)! - 1);
      if (indegree.get(t) === 0) queue.push(t);
    }
  }

  return [...graph.nodes].sort((a, b) => {
    // End markers always close the narrative.
    const endA = a.type === "end" ? 1 : 0;
    const endB = b.type === "end" ? 1 : 0;
    if (endA !== endB) return endA - endB;
    return rank.get(a.id)! - rank.get(b.id)! || discovery.get(a.id)! - discovery.get(b.id)!;
  });
}
