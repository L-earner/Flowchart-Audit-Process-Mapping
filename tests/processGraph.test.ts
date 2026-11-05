import { test } from "node:test";
import assert from "node:assert/strict";
import {
  normalizeProcessGraph,
  validateProcessGraph,
  PROCESS_GRAPH_SCHEMA,
  NODE_TYPES,
  type ProcessGraph,
} from "@shared/processGraph.ts";
import { sampleGraph, tinyGraph } from "./helpers.ts";

test("the sample fixture is a valid graph", () => {
  assert.deepEqual(validateProcessGraph(sampleGraph()), { ok: true, errors: [] });
});

test("rejects non-objects and missing top-level fields", () => {
  assert.equal(validateProcessGraph(null).ok, false);
  assert.equal(validateProcessGraph("graph").ok, false);
  const { ok, errors } = validateProcessGraph({});
  assert.equal(ok, false);
  assert.ok(errors.includes("missing title"));
  assert.ok(errors.includes("actors is not an array"));
  assert.ok(errors.includes("nodes is not an array"));
  assert.ok(errors.includes("edges is not an array"));
});

test("rejects duplicate ids", () => {
  const g = tinyGraph();
  g.actors.push({ id: "clerk", name: "Other" });
  g.nodes.push({ ...g.nodes[1] });
  g.edges.push({ ...g.edges[0] });
  const { errors } = validateProcessGraph(g);
  assert.ok(errors.includes("duplicate actor id clerk"));
  assert.ok(errors.includes("duplicate node id p"));
  assert.ok(errors.includes("duplicate edge id e1"));
});

test("start/end must not have an actor; other nodes must have a known one", () => {
  const g = tinyGraph();
  g.nodes[0].actorId = "clerk";
  g.nodes[1].actorId = "ghost";
  const { errors } = validateProcessGraph(g);
  assert.ok(errors.includes("node s must not reference an actor"));
  assert.ok(errors.includes("node p references unknown actor ghost"));
});

test("rejects invalid node types and blank labels", () => {
  const g = tinyGraph();
  (g.nodes[1] as { type: string }).type = "subprocess";
  g.nodes[2].label = "   ";
  const { errors } = validateProcessGraph(g);
  assert.ok(errors.includes("node p has invalid type subprocess"));
  assert.ok(errors.includes("node e has no label"));
});

test("control nodes need a valid control type and a risk", () => {
  const g = tinyGraph();
  g.nodes[1] = { ...g.nodes[1], type: "control" };
  assert.ok(validateProcessGraph(g).errors.includes("control node p has no control details"));

  g.nodes[1].control = { controlType: "sometimes" as never, riskAddressed: " " };
  const { errors } = validateProcessGraph(g);
  assert.ok(errors.includes("control node p has an invalid control type"));
  assert.ok(errors.includes("control node p has no risk addressed"));
});

test("edges must reference existing nodes", () => {
  const g = tinyGraph();
  g.edges.push({ id: "e3", source: "nope", target: "p" });
  const { errors } = validateProcessGraph(g);
  assert.ok(errors.includes("edge e3 has unknown source nope"));
});

test("normalizeProcessGraph backfills missing control metadata without inventing a risk", () => {
  const g = tinyGraph();
  g.nodes[1] = { ...g.nodes[1], type: "control" };
  const normalized = normalizeProcessGraph(g);
  assert.deepEqual(normalized.nodes[1].control, {
    controlType: "manual",
    riskAddressed: "Not specified.",
  });
  assert.equal(validateProcessGraph(normalized).ok, true);
});

test("normalizeProcessGraph keeps valid control details and frequency", () => {
  const g = sampleGraph();
  const before = g.nodes.find((n) => n.id === "three_way")!.control;
  const after = normalizeProcessGraph(g).nodes.find((n) => n.id === "three_way")!.control;
  assert.deepEqual(after, before);
});

test("normalizeProcessGraph returns the same object when nothing needs fixing", () => {
  const g = sampleGraph();
  assert.equal(normalizeProcessGraph(g), g);
});

test("JSON schema node-type enum matches the TypeScript list", () => {
  const nodeSchema = (PROCESS_GRAPH_SCHEMA as unknown as {
    properties: { nodes: { items: { properties: { type: { enum: string[] } } } } };
  }).properties.nodes.items.properties.type;
  assert.deepEqual([...nodeSchema.enum].sort(), [...NODE_TYPES].sort());
});

test("JSON schema never asks the model for positions", () => {
  const text = JSON.stringify(PROCESS_GRAPH_SCHEMA);
  assert.equal(text.includes('"position"'), false);
});

// Type-level guard: the fixture shape must stay assignable to ProcessGraph.
const _typed: ProcessGraph = sampleGraph();
void _typed;
