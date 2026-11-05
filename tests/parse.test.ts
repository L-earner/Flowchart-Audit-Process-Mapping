import { test } from "node:test";
import assert from "node:assert/strict";
import { parseGraphJson, parseOpsJson } from "../server/lib/parse.ts";
import { validateProcessGraph } from "@shared/processGraph.ts";
import { sampleGraph, tinyGraph } from "./helpers.ts";

test("parses plain JSON", () => {
  const g = parseGraphJson(JSON.stringify(sampleGraph()));
  assert.equal(g.nodes.length, 14);
});

test("strips markdown code fences", () => {
  const g = parseGraphJson("```json\n" + JSON.stringify(tinyGraph()) + "\n```");
  assert.equal(g.title, "Tiny");
});

test("extracts the outermost object from surrounding prose", () => {
  const text = `Sure! Here is the graph:\n${JSON.stringify(tinyGraph())}\nLet me know if you need changes.`;
  assert.equal(parseGraphJson(text).title, "Tiny");
});

test("throws a clear error on non-JSON", () => {
  assert.throws(() => parseGraphJson("I could not find a process."), /not valid JSON/);
});

test("throws with validation details when the graph is structurally wrong", () => {
  const bad = tinyGraph();
  bad.edges.push({ id: "e3", source: "p", target: "ghost" });
  assert.throws(() => parseGraphJson(JSON.stringify(bad)), /failed validation: .*unknown target ghost/);
});

test("repairs a step with a missing lane from its neighbour", () => {
  const g = tinyGraph();
  g.actors.push({ id: "mgr", name: "Manager" });
  g.nodes.push({ id: "q", type: "process", label: "Review", actorId: "nobody" });
  g.edges.push({ id: "e3", source: "p", target: "q" });
  const parsed = parseGraphJson(JSON.stringify(g));
  assert.equal(parsed.nodes.find((n) => n.id === "q")?.actorId, "clerk");
});

test("turns labelled forks off a process node into an explicit decision", () => {
  const g = tinyGraph();
  g.nodes.push({ id: "fix", type: "process", label: "Fix", actorId: "clerk" });
  g.edges = [
    { id: "e1", source: "s", target: "p" },
    { id: "ok", source: "p", target: "e", label: "ok" },
    { id: "bad", source: "p", target: "fix", label: "error" },
  ];
  const parsed = parseGraphJson(JSON.stringify(g));
  const decision = parsed.nodes.find((n) => n.type === "decision");
  assert.ok(decision, "a decision node was inserted");
  assert.equal(parsed.edges.find((e) => e.id === "ok")?.source, decision!.id);
  assert.ok(parsed.edges.some((e) => e.source === "p" && e.target === decision!.id));
  assert.ok(validateProcessGraph(parsed).ok);
});

test("backfills missing control details", () => {
  const g = tinyGraph();
  g.nodes[1] = { ...g.nodes[1], type: "control" };
  const parsed = parseGraphJson(JSON.stringify(g));
  assert.equal(parsed.nodes[1].control?.riskAddressed, "Not specified.");
});

test("parseOpsJson keeps well-formed ops and drops malformed ones with reasons", () => {
  const parsed = parseOpsJson(
    JSON.stringify({
      ops: [
        { op: "add_actor", id: "mgr", name: "Manager" },
        { op: "teleport", id: "x" },
        { op: "update_node", id: 42 },
        { op: "update_node", id: "p", actorId: 7 },
        "not an object",
      ],
      note: "  ",
    }),
  );
  assert.equal(parsed.ops.length, 1);
  assert.equal(parsed.note, undefined);
  assert.deepEqual(
    parsed.dropped.map((d) => d.reason),
    [
      'unknown op kind "teleport"',
      'field "id" is not a string',
      "actorId is not a string or null",
      "op is not an object",
    ],
  );
});

test("parseOpsJson requires an ops array", () => {
  assert.throws(() => parseOpsJson('{"note":"hi"}'), /no ops array/);
});
