import { test } from "node:test";
import assert from "node:assert/strict";
import { flowOrder } from "../client/src/lib/flowOrder.ts";
import { assignControlIds, formatControlId } from "../client/src/lib/controlIds.ts";
import { buildRcm, buildStepList, rcmToCsv, RCM_COLUMNS } from "../client/src/lib/rcm.ts";
import { buildNarrative, narrativeToText } from "../client/src/lib/narrative.ts";
import { parseImportedDiagram } from "../client/src/lib/importJson.ts";
import * as edit from "../client/src/lib/graphEdit.ts";
import { applyOps, renderCompactGraph } from "@shared/graphOps.ts";
import { sampleGraph, tinyGraph } from "./helpers.ts";

test("flowOrder reads the P2P sample start to end, branches right after their decision", () => {
  const ids = flowOrder(sampleGraph()).map((n) => n.id);
  assert.equal(ids[0], "start");
  assert.equal(ids.at(-1), "end");
  assert.ok(ids.indexOf("approved?") < ids.indexOf("amend"));
  assert.ok(ids.indexOf("approved?") < ids.indexOf("create_po"));
  assert.ok(ids.indexOf("match?") < ids.indexOf("park_invoice"));
  assert.ok(ids.indexOf("park_invoice") < ids.indexOf("end"));
  assert.equal(new Set(ids).size, 14);
});

test("flowOrder includes disconnected steps and copes with no start node", () => {
  const g = tinyGraph();
  g.nodes = g.nodes.filter((n) => n.type !== "start");
  g.edges = g.edges.filter((e) => e.source !== "s");
  g.nodes.push({ id: "lonely", type: "process", label: "Lonely", actorId: "clerk" });
  const ids = flowOrder(g).map((n) => n.id);
  assert.deepEqual(new Set(ids), new Set(["p", "e", "lonely"]));
  assert.equal(ids.at(-1), "e");
});

test("assignControlIds numbers controls C-01.. in flow order", () => {
  const g = assignControlIds(sampleGraph());
  const ids = Object.fromEntries(
    g.nodes.filter((n) => n.type === "control").map((n) => [n.id, n.control!.controlId]),
  );
  assert.deepEqual(ids, { approve_req: "C-01", po_check: "C-02", three_way: "C-03" });
  assert.equal(formatControlId(12), "C-12");
});

test("assignControlIds is a no-op once ids exist, and keeps user-typed ids", () => {
  const once = assignControlIds(sampleGraph());
  assert.equal(assignControlIds(once), once);
  const custom = edit.updateControl(once, "po_check", { controlId: "AP-7" });
  const again = assignControlIds(custom);
  assert.equal(again.nodes.find((n) => n.id === "po_check")!.control!.controlId, "AP-7");
});

test("new controls get the next number without renumbering existing ones", () => {
  const g = assignControlIds(sampleGraph());
  // Insert a new control early in the flow.
  const added = edit.addNode(g, "control", "requester");
  let next = edit.addEdge(added.graph, "raise_req", added.nodeId);
  next = assignControlIds(next, g);
  const byNode = (id: string) => next.nodes.find((n) => n.id === id)!.control!.controlId;
  assert.equal(byNode("approve_req"), "C-01");
  assert.equal(byNode("three_way"), "C-03");
  assert.equal(byNode(added.nodeId), "C-04");
});

test("ids dropped by an AI rewrite are restored from the previous graph", () => {
  const before = assignControlIds(sampleGraph());
  const rewritten = structuredClone(before);
  for (const n of rewritten.nodes) if (n.control) delete n.control.controlId;
  const restored = assignControlIds(rewritten, before);
  assert.equal(restored.nodes.find((n) => n.id === "three_way")!.control!.controlId, "C-03");
});

test("live update_node ops keep the control's id", () => {
  const g = assignControlIds(sampleGraph());
  const { graph } = applyOps(g, [
    { op: "update_node", id: "po_check", control: { controlType: "preventive", riskAddressed: "New risk" } },
  ]);
  const ctrl = graph.nodes.find((n) => n.id === "po_check")!.control!;
  assert.equal(ctrl.controlId, "C-02");
  assert.equal(ctrl.riskAddressed, "New risk");
});

test("the compact graph the live model sees includes control ids", () => {
  const text = renderCompactGraph(assignControlIds(sampleGraph()));
  assert.match(text, /three_way \[control C-03 @ap_clerk detective/);
});

test("RCM has one row per control with owner, risk, and neighbours", () => {
  const rows = buildRcm(sampleGraph());
  assert.equal(rows.length, 3);
  const three = rows.find((r) => r.control === "Three-way match")!;
  assert.equal(three.controlId, "C-03");
  assert.equal(three.owner, "AP Clerk");
  assert.equal(three.controlType, "detective");
  assert.equal(three.process, "Purchase-to-Pay (Demo)");
  assert.match(three.risk, /\S/);
  assert.match(three.precededBy, /Record goods receipt/);
  assert.match(three.precededBy, /Park & investigate \(re-check\)/);
  assert.equal(three.followedBy, "Match OK?");
});

test("RCM marks missing details instead of leaving blanks", () => {
  const g = tinyGraph();
  g.nodes[1] = { ...g.nodes[1], type: "control", control: { controlType: "manual", riskAddressed: "" } };
  const [row] = buildRcm(g);
  assert.equal(row.frequency, "Not recorded");
  assert.equal(row.risk, "Not recorded");
});

test("CSV export escapes commas, quotes and newlines and starts with a BOM", () => {
  const g = assignControlIds(sampleGraph());
  const csv = rcmToCsv(
    buildRcm(edit.updateNode(g, "po_check", { label: 'Value check, "hard" stop\nnext line' })),
  );
  assert.ok(csv.startsWith("﻿Control ID,Process,"));
  assert.ok(csv.includes('"Value check, ""hard"" stop\nnext line"'));
  const header = csv.slice(1).split("\r\n")[0].split(",");
  assert.equal(header.length, RCM_COLUMNS.length);
});

test("step list numbers every step and records where it leads", () => {
  const steps = buildStepList(sampleGraph());
  assert.equal(steps.length, 14);
  const decision = steps.find((s) => s.label === "Approved?")!;
  assert.match(decision.leadsTo, /\(rejected\)/);
  assert.match(decision.leadsTo, /\(approved\)/);
});

test("narrative reads in order and spells out decisions and controls", () => {
  const n = buildNarrative(sampleGraph());
  assert.equal(n.steps.length, 14);
  assert.match(n.steps[0].text, /^The process starts when: Need identified\./);
  assert.match(n.steps.at(-1)!.text, /^The process ends: Invoice paid\./);
  const decision = n.steps.find((s) => s.text.includes("decides: Approved?"))!;
  assert.match(decision.text, /[Ii]f approved, go to step \d+ \(Create & issue PO\)/);
  assert.match(decision.text, /[Ii]f rejected, go to step \d+ \(Amend or cancel\)/);
  const control = n.steps.find((s) => s.isControl && s.text.includes("Three-way match"))!;
  assert.match(control.text, /This is control C-03 \(detective, per invoice\)/i);
  assert.equal(n.participants.find((p) => p.name === "AP Clerk")!.controls, 1);
  const text = narrativeToText(n);
  assert.match(text, /Key controls:\n- C-01 Approve requisition/);
});

test("narrative flags dead ends and loops back explicitly", () => {
  const n = buildNarrative(sampleGraph());
  const amend = n.steps.find((s) => s.text.startsWith("Requester: Amend or cancel"))!;
  assert.match(amend.text, /Then resubmit: step \d+ \(Raise purchase requisition\)/);
  const g = tinyGraph();
  g.edges = g.edges.filter((e) => e.id !== "e2");
  assert.ok(buildNarrative(g).steps.some((s) => s.text.includes("No next step is mapped.")));
});

test("JSON import accepts a bare graph or {graph, viewMode} and keeps control ids", () => {
  const g = assignControlIds(sampleGraph());
  const bare = parseImportedDiagram(JSON.stringify(g));
  assert.equal(bare.graph.nodes.length, 14);
  assert.equal(bare.viewMode, undefined);
  assert.equal(bare.graph.nodes.find((n) => n.id === "three_way")!.control!.controlId, "C-03");
  const wrapped = parseImportedDiagram("﻿" + JSON.stringify({ graph: g, viewMode: "swimlane" }));
  assert.equal(wrapped.viewMode, "swimlane");
});

test("JSON import explains what's wrong with a bad file", () => {
  assert.throws(() => parseImportedDiagram("not json"), /isn't valid JSON/);
  assert.throws(() => parseImportedDiagram('{"hello":1}'), /isn't a process map this app can open: missing title/);
});
