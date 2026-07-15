import { Router } from "express";
import {
  listDiagrams,
  getDiagram,
  createDiagram,
  deleteDiagram,
  updateDiagram,
} from "../db.ts";
import {
  normalizeProcessGraph,
  validateProcessGraph,
  type ProcessGraph,
  type ViewMode,
} from "@shared/processGraph.ts";
import { demoModeGuard } from "../lib/demoMode.ts";

export const diagramsRouter = Router();

diagramsRouter.get("/", (_req, res) => {
  res.json({ diagrams: listDiagrams() });
});

diagramsRouter.get("/:id", (req, res) => {
  const diagram = getDiagram(req.params.id);
  if (!diagram) return res.status(404).json({ error: "Diagram not found." });
  res.json({
    diagram: { ...diagram, graph: normalizeProcessGraph(diagram.graph) },
  });
});

diagramsRouter.post("/", demoModeGuard, (req, res) => {
  const { graph, viewMode } = req.body as {
    graph?: ProcessGraph;
    viewMode?: ViewMode;
  };
  const normalizedGraph = graph ? normalizeProcessGraph(graph) : graph;
  const { ok, errors } = validateProcessGraph(normalizedGraph);
  if (!ok) return res.status(400).json({ error: errors.join("; ") });
  const diagram = createDiagram(normalizedGraph!, viewMode ?? "flowchart");
  res.status(201).json({ diagram });
});

diagramsRouter.put("/:id", demoModeGuard, (req, res) => {
  const { graph, viewMode } = req.body as {
    graph?: ProcessGraph;
    viewMode?: ViewMode;
  };
  const normalizedGraph = graph ? normalizeProcessGraph(graph) : graph;
  const { ok, errors } = validateProcessGraph(normalizedGraph);
  if (!ok) return res.status(400).json({ error: errors.join("; ") });
  const diagram = updateDiagram(
    req.params.id,
    normalizedGraph!,
    viewMode ?? "flowchart",
  );
  if (!diagram) return res.status(404).json({ error: "Diagram not found." });
  res.json({ diagram });
});

diagramsRouter.delete("/:id", demoModeGuard, (req, res) => {
  if (!deleteDiagram(req.params.id)) {
    return res.status(404).json({ error: "Diagram not found." });
  }
  res.json({ ok: true });
});
