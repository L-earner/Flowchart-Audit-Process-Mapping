import type { ProcessGraph } from "@shared/processGraph.ts";
import { type ModelInfo, modelInfo as lookupModel } from "@shared/models.ts";
import { LIVE_OPS_SCHEMA } from "@shared/graphOps.ts";
import type { ExtractInput } from "../inputs.ts";
import type { ChatTurn, OpsGeneration } from "../liveTypes.ts";
import { parseGraphJson } from "../parse.ts";
import { PROCESS_GRAPH_SCHEMA } from "@shared/processGraph.ts";

const ENDPOINT = "https://openrouter.ai/api/v1/chat/completions";

type Part =
  | { type: "text"; text: string }
  | { type: "image_url"; image_url: { url: string } };

function buildParts(inputs: ExtractInput[], model: ModelInfo | undefined): Part[] {
  const parts: Part[] = [];
  for (const input of inputs) {
    if (input.kind === "text") {
      parts.push({ type: "text", text: input.text });
    } else if (input.kind === "image") {
      if (!model?.vision) {
        throw new Error(
          `Model "${model?.id ?? "selected"}" can't read images. Pick a vision model (e.g. Qwen2.5-VL) or the Anthropic provider.`,
        );
      }
      parts.push({
        type: "image_url",
        image_url: { url: `data:${input.mediaType};base64,${input.data}` },
      });
    } else if (input.kind === "pdf") {
      throw new Error(
        "PDF input isn't supported on OpenRouter models here. Use an Anthropic model for PDFs, or upload a .docx / text / image instead.",
      );
    }
  }
  if (parts.length === 0) parts.push({ type: "text", text: "(no input provided)" });
  parts.push({
    type: "text",
    text: "Extract the process flow now. Output only the JSON object.",
  });
  return parts;
}

/** POST a chat-completions body and return the assistant text content. */
async function postChat(body: object): Promise<string> {
  const key = process.env.OPENROUTER_API_KEY;
  if (!key) {
    throw new Error(
      "OPENROUTER_API_KEY is not set. Add it as a secret (or in .env) and restart, or pick an Anthropic model.",
    );
  }

  const res = await fetch(ENDPOINT, {
    method: "POST",
    headers: {
      Authorization: `Bearer ${key}`,
      "Content-Type": "application/json",
      "X-Title": "Audit Process-Flow Mapper",
    },
    body: JSON.stringify(body),
  });

  if (!res.ok) {
    const detail = await res.text().catch(() => "");
    throw new Error(
      `OpenRouter request failed (${res.status}): ${detail.slice(0, 400)}`,
    );
  }

  const json = (await res.json()) as {
    choices?: Array<{ message?: { content?: string } }>;
    error?: { message?: string };
  };
  if (json.error) throw new Error(`OpenRouter error: ${json.error.message}`);
  const content = json.choices?.[0]?.message?.content;
  if (!content) throw new Error("OpenRouter returned no content.");
  return content;
}

/** OpenRouter provider: OpenAI-compatible chat completions with structured output. */
export async function generateGraphOpenRouter(
  model: string,
  system: string,
  inputs: ExtractInput[],
): Promise<ProcessGraph> {
  const info = lookupModel(model);

  const content = await postChat({
    model,
    max_tokens: 8000,
    temperature: 0,
    response_format: {
      type: "json_schema" as const,
      json_schema: {
        name: "process_graph",
        strict: false,
        schema: PROCESS_GRAPH_SCHEMA,
      },
    },
    messages: [
      { role: "system", content: system },
      { role: "user", content: buildParts(inputs, info) },
    ],
  });
  return parseGraphJson(content);
}

/** Live mode: multi-turn ops generation over the session history. */
export async function generateOpsOpenRouter(
  model: string,
  system: string,
  turns: ChatTurn[],
): Promise<OpsGeneration> {
  const content = await postChat({
    model,
    max_tokens: 4000,
    temperature: 0,
    response_format: {
      type: "json_schema" as const,
      json_schema: {
        name: "graph_ops",
        strict: false,
        schema: LIVE_OPS_SCHEMA,
      },
    },
    messages: [
      { role: "system", content: system },
      ...turns.map((turn) => ({ role: turn.role, content: turn.text })),
    ],
  });
  return { text: content, cacheReadInputTokens: null, inputTokens: 0, outputTokens: 0 };
}
