// Shared fixtures for the offline test suite. Nothing here calls a model.
import { readFileSync } from "node:fs";
import type { ProcessGraph } from "@shared/processGraph.ts";

const fixture = JSON.parse(
  readFileSync(new URL("../scripts/fixtures/p2p-sample-graph.json", import.meta.url), "utf8"),
) as { graph: ProcessGraph };

/** A fresh deep copy of the Purchase-to-Pay sample graph (14 nodes, 15 edges, 6 actors). */
export function sampleGraph(): ProcessGraph {
  return structuredClone(fixture.graph);
}

/** The smallest valid graph: start -> one step -> end. */
export function tinyGraph(): ProcessGraph {
  return {
    title: "Tiny",
    actors: [{ id: "clerk", name: "Clerk" }],
    nodes: [
      { id: "s", type: "start", label: "Start", actorId: null },
      { id: "p", type: "process", label: "Do the thing", actorId: "clerk" },
      { id: "e", type: "end", label: "Done", actorId: null },
    ],
    edges: [
      { id: "e1", source: "s", target: "p" },
      { id: "e2", source: "p", target: "e" },
    ],
  };
}
