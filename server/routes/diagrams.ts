import { Router } from "express";
import {
  listDiagrams,
  getDiagram,
  createDiagram,
  updateDiagram,
} from "../db.ts";
import {
  validateProcessGraph,
  type ProcessGraph,
  type ViewMode,
} from "@shared/processGraph.ts";

export const diagramsRouter = Router();

diagramsRouter.get("/", (_req, res) => {
  res.json({ diagrams: listDiagrams() });
});

diagramsRouter.get("/:id", (req, res) => {
  const diagram = getDiagram(req.params.id);
  if (!diagram) return res.status(404).json({ error: "Diagram not found." });
  res.json({ diagram });
});

diagramsRouter.post("/", (req, res) => {
  const { graph, viewMode } = req.body as {
    graph?: ProcessGraph;
    viewMode?: ViewMode;
  };
  const { ok, errors } = validateProcessGraph(graph);
  if (!ok) return res.status(400).json({ error: errors.join("; ") });
  const diagram = createDiagram(graph!, viewMode ?? "flowchart");
  res.status(201).json({ diagram });
});

diagramsRouter.put("/:id", (req, res) => {
  const { graph, viewMode } = req.body as {
    graph?: ProcessGraph;
    viewMode?: ViewMode;
  };
  const { ok, errors } = validateProcessGraph(graph);
  if (!ok) return res.status(400).json({ error: errors.join("; ") });
  const diagram = updateDiagram(req.params.id, graph!, viewMode ?? "flowchart");
  if (!diagram) return res.status(404).json({ error: "Diagram not found." });
  res.json({ diagram });
});
