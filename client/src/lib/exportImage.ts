import { toPng } from "html-to-image";
import type { ProcessGraph } from "../types";

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

export async function exportPng(graph: ProcessGraph) {
  const viewport = document.querySelector(
    ".react-flow__viewport",
  ) as HTMLElement | null;
  if (!viewport) throw new Error("Canvas not ready.");
  const dataUrl = await toPng(viewport, {
    backgroundColor: "#ffffff",
    pixelRatio: 2,
  });
  download(dataUrl, `${slug(graph.title)}.png`);
}

function slug(s: string): string {
  return s.toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-|-$/g, "") || "process";
}
