import { toPng } from "html-to-image";
import type { ProcessGraph, ViewMode } from "../types";
import { layout, layoutBounds } from "./layout";

function download(dataUrl: string, filename: string) {
  const a = document.createElement("a");
  a.href = dataUrl;
  a.download = filename;
  a.click();
}

export function exportJson(graph: ProcessGraph) {
  const blob = new Blob([JSON.stringify(graph, null, 2)], {
    type: "application/json",
  });
  const url = URL.createObjectURL(blob);
  download(url, `${slug(graph.title)}.json`);
  URL.revokeObjectURL(url);
}

const EXPORT_PADDING = 40;

/**
 * Export the whole map at 100% (×2 pixel ratio), independent of where the
 * camera is: re-render the viewport element with a transform that frames the
 * diagram's full bounds. Without this, the PNG was cropped to whatever part
 * of the map happened to be on screen.
 */
export async function exportPng(graph: ProcessGraph, viewMode: ViewMode) {
  const viewport = document.querySelector(
    ".react-flow__viewport",
  ) as HTMLElement | null;
  if (!viewport) throw new Error("Canvas not ready.");
  const bounds = layoutBounds(layout(graph, viewMode));
  if (!bounds) throw new Error("Nothing to export yet.");
  const width = Math.ceil(bounds.width + EXPORT_PADDING * 2);
  const height = Math.ceil(bounds.height + EXPORT_PADDING * 2);
  const dataUrl = await toPng(viewport, {
    backgroundColor: "#ffffff",
    pixelRatio: 2,
    width,
    height,
    style: {
      width: `${width}px`,
      height: `${height}px`,
      transform: `translate(${EXPORT_PADDING - bounds.x}px, ${EXPORT_PADDING - bounds.y}px) scale(1)`,
    },
  });
  download(dataUrl, `${slug(graph.title)}.png`);
}

function slug(s: string): string {
  return s.toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-|-$/g, "") || "process";
}
