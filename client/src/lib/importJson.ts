import {
  normalizeProcessGraph,
  validateProcessGraph,
  type ProcessGraph,
  type ViewMode,
} from "../types";

export interface ImportedDiagram {
  graph: ProcessGraph;
  viewMode?: ViewMode;
}

/**
 * Accepts what the app's JSON export writes (a bare ProcessGraph) and the
 * fixture/API shape ({ graph, viewMode }). Throws a readable error otherwise.
 */
export function parseImportedDiagram(text: string): ImportedDiagram {
  let data: unknown;
  try {
    data = JSON.parse(text.replace(/^﻿/, ""));
  } catch {
    throw new Error("That file isn't valid JSON.");
  }
  const wrapped =
    data && typeof data === "object" && "graph" in data
      ? (data as { graph: unknown; viewMode?: unknown })
      : null;
  const candidate = (wrapped ? wrapped.graph : data) as ProcessGraph;
  const graph = normalizeProcessGraph(candidate);
  const { ok, errors } = validateProcessGraph(graph);
  if (!ok) {
    const shown = errors.slice(0, 3).join("; ");
    throw new Error(
      `That file isn't a process map this app can open: ${shown}${errors.length > 3 ? ` (+${errors.length - 3} more)` : ""}.`,
    );
  }
  const viewMode =
    wrapped?.viewMode === "flowchart" || wrapped?.viewMode === "swimlane" ? wrapped.viewMode : undefined;
  return { graph, viewMode };
}
