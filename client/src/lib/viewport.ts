// Where to put the camera when a map opens. Fitting a whole process into the
// canvas usually shrinks node text below legibility (the sample P2P swimlane
// fit at ~19%), so we only fit when the result is readable; otherwise we open
// at a readable zoom framed on where the process starts, and leave the full
// overview to the "Fit entire map" button.
import type { ViewMode } from "../types";
import type { Bounds } from "./layout";

/** Below this zoom node labels (13px) drop under ~9px on screen. */
export const MIN_READABLE_ZOOM = 0.7;
/** Zoom used when the whole map can't be shown legibly. */
export const READABLE_ZOOM = 0.85;
/** Phone-width canvases trade a little legibility for context. */
export const NARROW_READABLE_ZOOM = 0.65;
const NARROW_PANE = 600;
const MAX_FIT_ZOOM = 1;
const PADDING = 32;
/** Extra room at the top so the canvas's help box doesn't cover the first lane name. */
const TOP_PADDING = 64;

export interface Viewport {
  x: number;
  y: number;
  zoom: number;
  /** True when the entire map is on screen. */
  fitsAll: boolean;
}

export function readableViewport(
  bounds: Bounds,
  pane: { width: number; height: number },
  mode: ViewMode,
  anchor?: { x: number; y: number } | null,
): Viewport {
  const availW = Math.max(1, pane.width - PADDING * 2);
  const availH = Math.max(1, pane.height - PADDING - TOP_PADDING);
  const fitZoom = Math.min(
    MAX_FIT_ZOOM,
    availW / Math.max(1, bounds.width),
    availH / Math.max(1, bounds.height),
  );

  if (fitZoom >= MIN_READABLE_ZOOM) {
    const zoom = fitZoom;
    return {
      x: (pane.width - bounds.width * zoom) / 2 - bounds.x * zoom,
      y: TOP_PADDING + (availH - bounds.height * zoom) / 2 - bounds.y * zoom,
      zoom,
      fitsAll: true,
    };
  }

  const zoom = pane.width < NARROW_PANE ? NARROW_READABLE_ZOOM : READABLE_ZOOM;
  const top = TOP_PADDING - bounds.y * zoom;
  const fitsWidth = bounds.width * zoom <= availW;
  const fitsHeight = bounds.height * zoom <= availH;

  // Swimlanes read left → right from the lane names; flowcharts read top →
  // down from the start node. Centre any axis that does fit.
  let x: number;
  if (fitsWidth) {
    x = (pane.width - bounds.width * zoom) / 2 - bounds.x * zoom;
  } else if (mode === "flowchart" && anchor) {
    const centred = pane.width / 2 - anchor.x * zoom;
    // Don't leave empty space beyond either edge of the map.
    const minX = pane.width - PADDING - (bounds.x + bounds.width) * zoom;
    const maxX = PADDING - bounds.x * zoom;
    x = Math.min(maxX, Math.max(minX, centred));
  } else {
    x = PADDING - bounds.x * zoom;
  }
  const y = fitsHeight
    ? TOP_PADDING + (availH - bounds.height * zoom) / 2 - bounds.y * zoom
    : top;

  return { x, y, zoom, fitsAll: false };
}
