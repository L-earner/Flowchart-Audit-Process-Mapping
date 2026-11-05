import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { normalizeProcessGraph, validateProcessGraph, PROCESS_GRAPH_SCHEMA } from "@shared/processGraph.ts";
import { applyOps, LIVE_OPS_SCHEMA } from "@shared/graphOps.ts";
import { SYSTEM_PROMPT, LIVE_SYSTEM_PROMPT, REFINE_ADDENDUM } from "../server/lib/prompts.ts";
import { parseGraphJson } from "../server/lib/parse.ts";
import * as edit from "../client/src/lib/graphEdit.ts";
import { orderedOpenPoints, questionsForOwner } from "../client/src/lib/openPoints.ts";
import { layout } from "../client/src/lib/layout.ts";
import { buildNarrative, narrativeToText } from "../client/src/lib/narrative.ts";
import { sampleGraph, tinyGraph } from "./helpers.ts";

const schema = PROCESS_GRAPH_SCHEMA as unknown as {
  required: string[];
  properties: {
    openPoints: { items: { required: string[]; properties: { kind: { enum: string[] } } } };
    nodes: { items: { properties: Record<string, unknown>; required: string[] } };
  };
};

test("extraction schema asks for open points (always) and source quotes (optional)", () => {
  assert.ok(schema.required.includes("openPoints"));
  assert.deepEqual(schema.properties.openPoints.items.required, ["id", "kind", "issue", "question", "nodeId"]);
  assert.deepEqual(schema.properties.openPoints.items.properties.kind.enum, ["gap", "ambiguity", "assumption"]);
  assert.ok("source" in schema.properties.nodes.items.properties);
  assert.equal(schema.properties.nodes.items.required.includes("source"), false);
});

test("prompts: extraction and refine cover open points; live mode is untouched", () => {
  assert.match(SYSTEM_PROMPT, /verbatim quote/);
  assert.match(SYSTEM_PROMPT, /"openPoints"/);
  assert.match(SYSTEM_PROMPT, /Do not fill gaps by inventing steps/);
  assert.match(REFINE_ADDENDUM, /Update "openPoints"/);
  // Live mode emits ops, which can't carry these fields.
  assert.doesNotMatch(LIVE_SYSTEM_PROMPT, /openPoints|verbatim quote/);
  const opsText = JSON.stringify(LIVE_OPS_SCHEMA);
  assert.doesNotMatch(opsText, /openPoints|"source":\{"type":"string","description":"Short verbatim/);
});

test("every source quote in the sample map is verbatim from its walkthrough", () => {
  const transcript = readFileSync(new URL("../scripts/fixtures/p2p-walkthrough.txt", import.meta.url), "utf8")
    .replace(/\s+/g, " ");
  for (const n of sampleGraph().nodes) {
    assert.ok(n.source, `${n.id} has a source`);
    assert.ok(transcript.includes(n.source!), `${n.id}: "${n.source}" is in the transcript`);
  }
});

test("normalize tidies open points: drops empties, defaults kind, nulls unknown steps, dedupes ids", () => {
  const g = tinyGraph();
  g.openPoints = [
    { id: "a", kind: "gap", issue: "Missing owner", question: "Who?", nodeId: "p" },
    { id: "a", kind: "weird" as never, issue: "Dup id", question: "", nodeId: "ghost" },
    { id: "c", kind: "gap", issue: " ", question: " ", nodeId: null },
  ];
  const out = normalizeProcessGraph(g).openPoints!;
  assert.equal(out.length, 2);
  assert.equal(out[0], g.openPoints[0], "untouched item keeps identity");
  assert.equal(out[1].id, "a_");
  assert.equal(out[1].kind, "gap");
  assert.equal(out[1].nodeId, null);
  assert.equal(out[1].question, "Dup id", "falls back to the issue text");
  assert.ok(validateProcessGraph(normalizeProcessGraph(g)).ok);
});

test("normalize returns the same graph when open points are already tidy", () => {
  const g = sampleGraph();
  assert.equal(normalizeProcessGraph(g), g);
  const bad = { ...tinyGraph(), openPoints: "nope" as never };
  assert.deepEqual(normalizeProcessGraph(bad).openPoints, []);
});

test("parsed model output keeps quotes and open points", () => {
  const g = parseGraphJson(JSON.stringify(sampleGraph()));
  assert.equal(g.openPoints!.length, 5);
  assert.match(g.nodes.find((n) => n.id === "three_way")!.source!, /three-way match/);
});

test("deleting a step re-points its open points at the whole process", () => {
  const g = edit.deleteNode(sampleGraph(), "payment_run");
  assert.equal(g.openPoints!.find((p) => p.id === "op_payment_release")!.nodeId, null);
  const live = applyOps(sampleGraph(), [{ op: "delete_node", id: "park_invoice" }]).graph;
  assert.equal(live.openPoints!.find((p) => p.id === "op_parked_followup")!.nodeId, null);
});

test("live ops keep open points and source quotes", () => {
  const { graph } = applyOps(sampleGraph(), [{ op: "update_node", id: "three_way", label: "3-way match" }]);
  assert.equal(graph.openPoints!.length, 5);
  assert.match(graph.nodes.find((n) => n.id === "three_way")!.source!, /three-way match/);
});

test("resolving an open point removes just that one", () => {
  const g = edit.resolveOpenPoint(sampleGraph(), "op_approval_limits");
  assert.equal(g.openPoints!.length, 4);
  assert.ok(!g.openPoints!.some((p) => p.id === "op_approval_limits"));
});

test("open points are listed in process order", () => {
  const order = orderedOpenPoints(sampleGraph()).map((p) => p.nodeId);
  assert.deepEqual(order, ["approve_req", "po_check", "goods_receipt", "park_invoice", "payment_run"]);
});

test("follow-up questions are a numbered list tagged with their step", () => {
  const text = questionsForOwner(sampleGraph());
  const lines = text.split("\n");
  assert.equal(lines[0], "Follow-up questions — Purchase-to-Pay (Demo)");
  assert.match(lines[2], /^1\. Do higher-value requisitions .* \(re: "Approve requisition"\)$/);
  assert.equal(lines.length, 7);
  assert.equal(questionsForOwner(tinyGraph()), "");
});

test("layout tags steps with their open-point count for the canvas flag", () => {
  const g = sampleGraph();
  g.openPoints!.push({ id: "x", kind: "ambiguity", issue: "i", question: "q", nodeId: "payment_run" });
  const nodes = layout(g, "flowchart").nodes;
  assert.equal(nodes.find((n) => n.id === "payment_run")!.data.openPoints, 2);
  assert.equal(nodes.find((n) => n.id === "create_po")!.data.openPoints, 0);
});

test("the narrative ends with the open points to confirm", () => {
  const n = buildNarrative(sampleGraph());
  assert.equal(n.openPoints.length, 5);
  assert.match(n.openPoints[0].step, /^3\. Approve requisition$/);
  assert.match(narrativeToText(n), /Open points to confirm:\n- \[Ambiguity\] 3\. Approve requisition:/);
  assert.equal(buildNarrative(tinyGraph()).openPoints.length, 0);
});
