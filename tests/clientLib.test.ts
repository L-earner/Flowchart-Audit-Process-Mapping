// Pure client-side helpers (no DOM needed): editing, quality score, change
// summary, and auto-layout.
import { test } from "node:test";
import assert from "node:assert/strict";
import * as edit from "../client/src/lib/graphEdit.ts";
import { assessGraph } from "../client/src/lib/graphQuality.ts";
import { summarizeChange } from "../client/src/lib/graphDiff.ts";
import { layout } from "../client/src/lib/layout.ts";
import { normalizeProcessGraph, validateProcessGraph } from "@shared/processGraph.ts";
import { sampleGraph, tinyGraph } from "./helpers.ts";

test("graphEdit.addNode + addEdge build a graph the server will accept", () => {
  let g = tinyGraph();
  const added = edit.addNode(g, "control", "clerk", { x: 10, y: 20 });
  g = edit.addEdge(added.graph, "p", added.nodeId);
  const node = g.nodes.find((n) => n.id === added.nodeId)!;
  assert.equal(node.label, "New step");
  assert.deepEqual(node.position, { x: 10, y: 20 });
  // New controls start with a blank risk; the server backfills it on save.
  assert.equal(validateProcessGraph(normalizeProcessGraph(g)).ok, true);
});

test("graphEdit.addEdge ignores duplicate connections", () => {
  const g = tinyGraph();
  assert.equal(edit.addEdge(g, "s", "p"), g);
});

test("graphEdit.updateNode enforces type invariants", () => {
  let g = edit.updateNode(tinyGraph(), "p", { type: "control" });
  assert.ok(g.nodes[1].control);
  g = edit.updateNode(g, "p", { type: "end" });
  assert.equal(g.nodes[1].actorId, null);
  assert.equal(g.nodes[1].control, undefined);
});

test("graphEdit.deleteNode cascades edges", () => {
  const g = edit.deleteNode(tinyGraph(), "p");
  assert.equal(g.edges.length, 0);
});

test("graphEdit.moveActor swaps lanes and stops at the ends", () => {
  const g = sampleGraph();
  const moved = edit.moveActor(g, "manager", -1);
  assert.deepEqual(moved.actors.slice(0, 2).map((a) => a.id), ["manager", "requester"]);
  assert.equal(edit.moveActor(g, "requester", -1), g);
});

test("graphEdit.deleteActor reassigns steps, but never orphans the last lane", () => {
  const g = edit.deleteActor(sampleGraph(), "manager");
  assert.equal(g.nodes.find((n) => n.id === "approve_req")?.actorId, "requester");
  const only = tinyGraph();
  assert.equal(edit.deleteActor(only, "clerk"), only);
});

test("graphEdit.clearPositions removes every stored position", () => {
  const g = edit.applyPositions(tinyGraph(), { p: { x: 1, y: 2 } });
  assert.deepEqual(g.nodes[1].position, { x: 1, y: 2 });
  assert.ok(edit.clearPositions(g).nodes.every((n) => n.position === undefined));
});

test("assessGraph scores the sample at 100 with no warnings", () => {
  const q = assessGraph(sampleGraph());
  assert.equal(q.score, 100);
  assert.deepEqual(q.warnings, []);
});

test("assessGraph flags missing start/end, disconnected steps, and weak decisions", () => {
  const g = sampleGraph();
  g.nodes = g.nodes.filter((n) => n.type !== "start" && n.type !== "end");
  g.edges = g.edges.filter((e) => e.id !== "e4" && e.id !== "e5");
  g.edges.find((e) => e.id === "e13")!.label = "";
  const q = assessGraph(g);
  assert.ok(q.score < 100);
  assert.ok(q.warnings.includes("Add a start node to show the process trigger."));
  assert.ok(q.warnings.includes("Add an end node to show the process outcome."));
  assert.ok(q.warnings.some((w) => /disconnected/.test(w)));
  assert.ok(q.warnings.includes("2 decisions need two labelled outcomes."));
});

test("summarizeChange counts structural differences", () => {
  const before = sampleGraph();
  const after = sampleGraph();
  after.nodes.push({ id: "cfo", type: "control", label: "CFO sign-off", actorId: "manager", control: { controlType: "preventive", riskAddressed: "Large spend" } });
  after.nodes.find((n) => n.id === "create_po")!.label = "Raise PO";
  assert.equal(summarizeChange(before, after), "+1 step, +1 control, 1 step renamed");
  assert.equal(summarizeChange(before, sampleGraph()), "no structural changes");
});

test("flowchart layout positions every node and keeps stored positions", () => {
  const g = sampleGraph();
  g.nodes[1].position = { x: -500, y: -500 };
  const result = layout(g, "flowchart");
  assert.equal(result.nodes.length, g.nodes.length);
  assert.equal(result.lanes.length, 0);
  assert.deepEqual(result.nodes.find((n) => n.id === g.nodes[1].id)?.position, { x: -500, y: -500 });
  for (const n of result.nodes) {
    assert.ok(Number.isFinite(n.position.x) && Number.isFinite(n.position.y), `${n.id} has a finite position`);
  }
  assert.equal(result.edges.length, g.edges.length);
});

test("swimlane layout puts each step inside its actor's lane", () => {
  const g = sampleGraph();
  const result = layout(g, "swimlane");
  // One lane per actor plus a Start/End lane for the terminal markers.
  assert.equal(result.lanes.length, g.actors.length + 1);
  const laneFor = new Map(result.lanes.map((l) => [l.actorId, l]));
  for (const n of result.nodes.filter((n) => !n.id.startsWith("lane__"))) {
    const lane = laneFor.get(n.data.node.actorId ?? "__unassigned__")!;
    assert.ok(
      n.position.y >= lane.y && n.position.y < lane.y + lane.height,
      `${n.id} sits in lane ${lane.name}`,
    );
  }
});

test("layout copes with an empty graph", () => {
  const empty = { title: "Empty", actors: [], nodes: [], edges: [] };
  assert.equal(layout(empty, "flowchart").nodes.length, 0);
  assert.equal(layout(empty, "swimlane").nodes.length, 0);
});
