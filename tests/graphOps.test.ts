import { test } from "node:test";
import assert from "node:assert/strict";
import {
  applyOps,
  diffGraphs,
  renderCompactGraph,
  summarizeOps,
  type GraphOp,
} from "@shared/graphOps.ts";
import { validateProcessGraph } from "@shared/processGraph.ts";
import { sampleGraph, tinyGraph } from "./helpers.ts";

test("applyOps adds an actor, a step, and the edges that place it", () => {
  const { graph, applied, rejected } = applyOps(tinyGraph(), [
    { op: "add_actor", id: "mgr", name: "Manager" },
    { op: "add_node", id: "approve", type: "decision", label: "Approve?", actorId: "mgr" },
    { op: "update_edge", id: "e2", target: "approve" },
    { op: "add_edge", id: "e3", source: "approve", target: "e", label: "yes" },
  ]);
  assert.equal(rejected.length, 0);
  assert.equal(applied.length, 4);
  assert.equal(graph.actors.length, 2);
  assert.equal(graph.nodes.find((n) => n.id === "approve")?.actorId, "mgr");
  assert.equal(graph.edges.find((e) => e.id === "e2")?.target, "approve");
  assert.ok(validateProcessGraph(graph).ok);
});

test("applyOps does not mutate its input", () => {
  const input = tinyGraph();
  const snapshot = structuredClone(input);
  applyOps(input, [
    { op: "delete_node", id: "p" },
    { op: "set_title", title: "Changed" },
  ]);
  assert.deepEqual(input, snapshot);
});

test("applyOps rejects bad references per op without aborting the batch", () => {
  const { graph, applied, rejected } = applyOps(tinyGraph(), [
    { op: "update_node", id: "missing", label: "x" },
    { op: "add_edge", id: "e9", source: "p", target: "ghost" },
    { op: "set_title", title: "Still applied" },
  ]);
  assert.equal(graph.title, "Still applied");
  assert.equal(applied.length, 1);
  assert.deepEqual(
    rejected.map((r) => r.reason),
    ['unknown node "missing"', 'edge "e9" has unknown target "ghost"'],
  );
});

test("deleting a node cascades its edges", () => {
  const { graph } = applyOps(tinyGraph(), [{ op: "delete_node", id: "p" }]);
  assert.equal(graph.edges.length, 0);
});

test("add_node with an existing id becomes an update (idempotent)", () => {
  const { graph, rejected } = applyOps(tinyGraph(), [
    { op: "add_node", id: "p", type: "process", label: "Renamed", actorId: "clerk" },
  ]);
  assert.equal(rejected.length, 0);
  assert.equal(graph.nodes.filter((n) => n.id === "p").length, 1);
  assert.equal(graph.nodes.find((n) => n.id === "p")?.label, "Renamed");
});

test("add_edge for an existing connection only refreshes its label", () => {
  const { graph } = applyOps(tinyGraph(), [
    { op: "add_edge", id: "dup", source: "s", target: "p", label: "trigger" },
  ]);
  assert.equal(graph.edges.length, 2);
  assert.equal(graph.edges.find((e) => e.id === "e1")?.label, "trigger");
});

test("start/end nodes are forced to have no actor; steps fall back to the first actor", () => {
  const { graph } = applyOps(tinyGraph(), [
    { op: "add_node", id: "s2", type: "start", label: "Alt start", actorId: "clerk" },
    { op: "add_node", id: "p2", type: "process", label: "Orphan", actorId: "nobody" },
  ]);
  assert.equal(graph.nodes.find((n) => n.id === "s2")?.actorId, null);
  assert.equal(graph.nodes.find((n) => n.id === "p2")?.actorId, "clerk");
});

test("a step cannot be added before any actor exists", () => {
  const { rejected } = applyOps(
    { title: "Empty", actors: [], nodes: [], edges: [] },
    [{ op: "add_node", id: "p", type: "process", label: "Step" }],
  );
  assert.match(rejected[0].reason, /add_actor first/);
});

test("control nodes always carry control details; changing type drops them", () => {
  const added = applyOps(tinyGraph(), [{ op: "update_node", id: "p", type: "control" }]).graph;
  assert.deepEqual(added.nodes[1].control, { controlType: "manual", riskAddressed: "Not specified." });
  const removed = applyOps(added, [{ op: "update_node", id: "p", type: "process" }]).graph;
  assert.equal(removed.nodes[1].control, undefined);
});

test("deleting the only actor that owns steps is refused", () => {
  const { rejected } = applyOps(tinyGraph(), [{ op: "delete_actor", id: "clerk" }]);
  assert.match(rejected[0].reason, /would have no lane/);
});

test("deleting an actor reassigns its steps to the remaining lane", () => {
  const { graph } = applyOps(sampleGraph(), [{ op: "delete_actor", id: "manager" }]);
  assert.equal(graph.nodes.find((n) => n.id === "approve_req")?.actorId, "requester");
  assert.ok(validateProcessGraph(graph).ok);
});

test("undo_last is never applied server-side", () => {
  const { applied, rejected } = applyOps(tinyGraph(), [{ op: "undo_last" }]);
  assert.equal(applied.length, 0);
  assert.match(rejected[0].reason, /executed by the client/);
});

test("diffGraphs reports nothing for identical graphs and ignores positions", () => {
  const a = sampleGraph();
  const b = sampleGraph();
  b.nodes[3].position = { x: 999, y: 999 };
  assert.deepEqual(diffGraphs(a, b), []);
});

test("diffGraphs + applyOps round-trips a set of manual edits", () => {
  const before = sampleGraph();
  const after = sampleGraph();
  after.title = "P2P v2";
  after.actors[0].name = "Budget holder";
  after.nodes = after.nodes.filter((n) => n.id !== "amend");
  after.edges = after.edges.filter((e) => e.source !== "amend" && e.target !== "amend");
  after.nodes.find((n) => n.id === "post_invoice")!.label = "Post invoice";
  after.edges.find((e) => e.id === "e11")!.label = "mismatch";

  const ops = diffGraphs(before, after);
  const kinds = ops.map((op) => op.op).sort();
  assert.deepEqual(kinds, [
    "delete_edge",
    "delete_edge",
    "delete_node",
    "set_title",
    "update_actor",
    "update_edge",
    "update_node",
  ]);

  const { graph, rejected } = applyOps(before, ops);
  // diffGraphs lists the deleted step's edges explicitly (so the model notice
  // names them), but delete_node already cascaded them — those two are the
  // only expected rejections, and the end state still matches.
  assert.deepEqual(
    rejected.map((r) => r.reason).sort(),
    ['unknown edge "e4"', 'unknown edge "e5"'],
  );
  assert.deepEqual(diffGraphs(graph, after), []);
});

test("renderCompactGraph is deterministic and includes controls' risk", () => {
  const text = renderCompactGraph(sampleGraph());
  assert.equal(text, renderCompactGraph(sampleGraph()));
  assert.match(text, /^TITLE: Purchase-to-Pay \(Demo\)/);
  assert.match(text, /three_way \[control @ap_clerk detective[^\]]*\] Three-way match \| risk: /);
  assert.match(text, /e4: approved\? -> amend \(rejected\)/);
});

test("renderCompactGraph handles an empty graph", () => {
  const text = renderCompactGraph({ title: "Empty", actors: [], nodes: [], edges: [] });
  assert.equal(text, "TITLE: Empty\nACTORS: (none)\nNODES:\n  (none)\nEDGES:\n  (none)");
});

test("summarizeOps pluralises and groups", () => {
  const ops: GraphOp[] = [
    { op: "add_node", id: "a", type: "process", label: "A" },
    { op: "add_node", id: "b", type: "process", label: "B" },
    { op: "delete_edge", id: "e1" },
  ];
  assert.equal(summarizeOps(ops), "2 steps added, 1 connection removed");
  assert.equal(summarizeOps([]), "No changes");
});
