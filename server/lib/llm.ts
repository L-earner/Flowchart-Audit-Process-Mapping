import type { ProcessGraph } from "@shared/processGraph.ts";
import { DEFAULT_MODEL_ID, providerFor } from "@shared/models.ts";
import type { ExtractInput } from "./inputs.ts";
import { SYSTEM_PROMPT, REFINE_ADDENDUM } from "./prompts.ts";
import { generateGraphAnthropic } from "./providers/anthropic.ts";
import { generateGraphOpenRouter } from "./providers/openrouter.ts";

function resolveModel(modelId?: string): string {
  return modelId && modelId.trim() ? modelId : (process.env.LLM_MODEL ?? DEFAULT_MODEL_ID);
}

async function generate(
  model: string,
  system: string,
  inputs: ExtractInput[],
): Promise<ProcessGraph> {
  return providerFor(model) === "openrouter"
    ? generateGraphOpenRouter(model, system, inputs)
    : generateGraphAnthropic(model, system, inputs);
}

/** Extract a fresh process graph from one or more inputs. */
export async function extractGraph(
  inputs: ExtractInput[],
  modelId?: string,
): Promise<ProcessGraph> {
  return generate(resolveModel(modelId), SYSTEM_PROMPT, inputs);
}

/** Merge a new transcript chunk into an existing graph (live mode). */
export async function refineGraph(
  current: ProcessGraph,
  transcriptChunk: string,
  modelId?: string,
): Promise<ProcessGraph> {
  const inputs: ExtractInput[] = [
    {
      kind: "text",
      text:
        "Current graph JSON:\n" +
        JSON.stringify(current) +
        "\n\nNew transcript since last update:\n" +
        transcriptChunk +
        "\n\nReturn the full updated process graph as JSON.",
    },
  ];
  return generate(resolveModel(modelId), SYSTEM_PROMPT + REFINE_ADDENDUM, inputs);
}
