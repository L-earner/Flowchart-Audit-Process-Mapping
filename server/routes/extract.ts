import { Router } from "express";
import multer from "multer";
import { extractGraph, refineGraph } from "../lib/llm.ts";
import type { ExtractInput } from "../lib/inputs.ts";
import { fileToInput } from "../lib/documents.ts";
import {
  normalizeProcessGraph,
  validateProcessGraph,
  type ProcessGraph,
} from "@shared/processGraph.ts";

const upload = multer({
  storage: multer.memoryStorage(),
  limits: { fileSize: 25 * 1024 * 1024 }, // 25 MB per file
});

export const extractRouter = Router();

/**
 * POST /api/extract
 * multipart/form-data: optional `text` field + any number of `files`.
 * Returns the extracted ProcessGraph.
 */
extractRouter.post("/", upload.array("files"), async (req, res) => {
  try {
    const inputs: ExtractInput[] = [];

    const text = typeof req.body?.text === "string" ? req.body.text.trim() : "";
    if (text) inputs.push({ kind: "text", text });

    const files = (req.files as Express.Multer.File[] | undefined) ?? [];
    for (const f of files) {
      inputs.push(await fileToInput(f));
    }

    if (inputs.length === 0) {
      return res
        .status(400)
        .json({ error: "Provide some text or at least one file to extract from." });
    }

    const model = typeof req.body?.model === "string" ? req.body.model : undefined;
    const graph = await extractGraph(inputs, model);
    res.json({ graph });
  } catch (err) {
    res.status(500).json({ error: (err as Error).message });
  }
});

/**
 * POST /api/extract/refine
 * JSON: { graph: ProcessGraph, transcriptChunk: string }
 * Returns the updated ProcessGraph for live transcript or explicit instructions.
 */
extractRouter.post("/refine", async (req, res) => {
  try {
    const { graph, transcriptChunk, model } = req.body as {
      graph?: ProcessGraph;
      transcriptChunk?: string;
      model?: string;
    };
    if (!transcriptChunk || !transcriptChunk.trim()) {
      return res.status(400).json({ error: "transcriptChunk is required." });
    }
    const normalizedGraph = graph ? normalizeProcessGraph(graph) : undefined;
    if (normalizedGraph) {
      const { ok, errors } = validateProcessGraph(normalizedGraph);
      if (!ok) {
        return res
          .status(400)
          .json({ error: `Invalid current graph: ${errors.join("; ")}` });
      }
    }

    const base: ProcessGraph = normalizedGraph ?? {
      title: "Untitled process",
      actors: [],
      nodes: [],
      edges: [],
    };
    const updated = await refineGraph(base, transcriptChunk, model);
    res.json({ graph: updated });
  } catch (err) {
    res.status(500).json({ error: (err as Error).message });
  }
});
