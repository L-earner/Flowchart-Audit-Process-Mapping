import type { OpenPoint, OpenPointKind, ProcessGraph } from "../types";
import { flowOrder } from "./flowOrder";

export const KIND_LABEL: Record<OpenPointKind, string> = {
  gap: "Gap",
  ambiguity: "Ambiguity",
  assumption: "Assumption",
};

/** Open points sorted to follow the process (whole-process points first). */
export function orderedOpenPoints(graph: ProcessGraph): OpenPoint[] {
  const position = new Map(flowOrder(graph).map((n, i) => [n.id, i]));
  return [...(graph.openPoints ?? [])]
    .map((p, i) => ({ p, i }))
    .sort((a, b) => {
      const pa = a.p.nodeId ? position.get(a.p.nodeId) ?? Infinity : -1;
      const pb = b.p.nodeId ? position.get(b.p.nodeId) ?? Infinity : -1;
      return pa - pb || a.i - b.i;
    })
    .map(({ p }) => p);
}

/**
 * Follow-up questions as a numbered list ready to paste into an email to the
 * process owner, each tagged with the step it concerns.
 */
export function questionsForOwner(graph: ProcessGraph): string {
  const label = new Map(graph.nodes.map((n) => [n.id, n.label]));
  const points = orderedOpenPoints(graph);
  if (!points.length) return "";
  const lines = points.map((p, i) => {
    const step = p.nodeId && label.get(p.nodeId);
    return `${i + 1}. ${p.question}${step ? ` (re: "${step}")` : ""}`;
  });
  return [`Follow-up questions — ${graph.title}`, "", ...lines].join("\n");
}
