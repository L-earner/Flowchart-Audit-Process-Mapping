import { validateProcessGraph, type ProcessGraph } from "@shared/processGraph.ts";

/**
 * Parse model text into a validated ProcessGraph. Lenient about wrapping:
 * strips ```json fences and, failing that, extracts the outermost {...} block —
 * open models sometimes add prose or fences despite instructions.
 */
export function parseGraphJson(text: string): ProcessGraph {
  let t = text.trim();

  // Strip a leading/trailing markdown code fence if present.
  if (t.startsWith("```")) {
    t = t.replace(/^```[a-zA-Z]*\s*/, "").replace(/\s*```$/, "").trim();
  }

  let obj: unknown;
  try {
    obj = JSON.parse(t);
  } catch {
    const start = t.indexOf("{");
    const end = t.lastIndexOf("}");
    if (start >= 0 && end > start) {
      try {
        obj = JSON.parse(t.slice(start, end + 1));
      } catch {
        throw new Error("Model output was not valid JSON.");
      }
    } else {
      throw new Error("Model output was not valid JSON.");
    }
  }

  const { ok, errors } = validateProcessGraph(obj);
  if (!ok) {
    throw new Error(`Extracted graph failed validation: ${errors.join("; ")}`);
  }
  return obj as ProcessGraph;
}
