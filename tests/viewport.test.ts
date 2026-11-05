import { test } from "node:test";
import assert from "node:assert/strict";
import {
  readableViewport,
  MIN_READABLE_ZOOM,
  READABLE_ZOOM,
  NARROW_READABLE_ZOOM,
} from "../client/src/lib/viewport.ts";
import { layout, layoutBounds, flowAnchor } from "../client/src/lib/layout.ts";
import { sampleGraph, tinyGraph } from "./helpers.ts";

const desktop = { width: 770, height: 830 };

test("a small map is fitted whole and centred, never above 100%", () => {
  const laid = layout(tinyGraph(), "flowchart");
  const v = readableViewport(layoutBounds(laid)!, desktop, "flowchart", flowAnchor(laid));
  assert.equal(v.fitsAll, true);
  assert.ok(v.zoom <= 1 && v.zoom >= MIN_READABLE_ZOOM);
});

test("a large swimlane opens at a readable zoom on the lane names, not at ~19%", () => {
  const laid = layout(sampleGraph(), "swimlane");
  const bounds = layoutBounds(laid)!;
  const v = readableViewport(bounds, desktop, "swimlane", flowAnchor(laid));
  assert.equal(v.fitsAll, false);
  assert.equal(v.zoom, READABLE_ZOOM);
  // Left edge of the lanes (the lane-name column) sits just inside the pane.
  const screenLeft = v.x + bounds.x * v.zoom;
  assert.ok(screenLeft > 0 && screenLeft < 60, `left edge at ${screenLeft}px`);
});

test("a tall flowchart opens on its start node, horizontally on screen", () => {
  const laid = layout(sampleGraph(), "flowchart");
  const anchor = flowAnchor(laid)!;
  const v = readableViewport(layoutBounds(laid)!, desktop, "flowchart", anchor);
  const screenX = v.x + anchor.x * v.zoom;
  const screenY = v.y + anchor.y * v.zoom;
  assert.ok(screenX > 0 && screenX < desktop.width, `start node x ${screenX}`);
  assert.ok(screenY > 0 && screenY < desktop.height / 3, `start node y ${screenY}`);
});

test("phone-width canvases use the narrower readable zoom", () => {
  const laid = layout(sampleGraph(), "swimlane");
  const v = readableViewport(layoutBounds(laid)!, { width: 370, height: 600 }, "swimlane");
  assert.equal(v.zoom, NARROW_READABLE_ZOOM);
});

test("layoutBounds is null for an empty diagram", () => {
  assert.equal(layoutBounds(layout({ title: "E", actors: [], nodes: [], edges: [] }, "swimlane")), null);
});
