import type { ProcessGraph, ViewMode } from "../types";
import type { DiagramSummary } from "../types";

async function asJson<T>(res: Response): Promise<T> {
  const body = await res.json().catch(() => ({}));
  if (!res.ok) {
    throw new Error((body as { error?: string }).error ?? `Request failed (${res.status})`);
  }
  return body as T;
}

/** Extract a graph from pasted text and/or uploaded files. */
export async function extract(opts: {
  text?: string;
  files?: File[];
}): Promise<ProcessGraph> {
  const form = new FormData();
  if (opts.text) form.append("text", opts.text);
  for (const f of opts.files ?? []) form.append("files", f);
  const res = await fetch("/api/extract", { method: "POST", body: form });
  return (await asJson<{ graph: ProcessGraph }>(res)).graph;
}

/** Merge a transcript chunk into the current graph (live mode). */
export async function refine(
  graph: ProcessGraph | null,
  transcriptChunk: string,
): Promise<ProcessGraph> {
  const res = await fetch("/api/extract/refine", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ graph, transcriptChunk }),
  });
  return (await asJson<{ graph: ProcessGraph }>(res)).graph;
}

export async function listDiagrams(): Promise<DiagramSummary[]> {
  const res = await fetch("/api/diagrams");
  return (await asJson<{ diagrams: DiagramSummary[] }>(res)).diagrams;
}

export async function loadDiagram(
  id: string,
): Promise<{ id: string; title: string; graph: ProcessGraph; viewMode: ViewMode }> {
  const res = await fetch(`/api/diagrams/${id}`);
  return (await asJson<{ diagram: { id: string; title: string; graph: ProcessGraph; viewMode: ViewMode } }>(res)).diagram;
}

export async function createDiagram(
  graph: ProcessGraph,
  viewMode: ViewMode,
): Promise<{ id: string }> {
  const res = await fetch("/api/diagrams", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ graph, viewMode }),
  });
  return (await asJson<{ diagram: { id: string } }>(res)).diagram;
}

export async function saveDiagram(
  id: string,
  graph: ProcessGraph,
  viewMode: ViewMode,
): Promise<void> {
  const res = await fetch(`/api/diagrams/${id}`, {
    method: "PUT",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ graph, viewMode }),
  });
  await asJson(res);
}
