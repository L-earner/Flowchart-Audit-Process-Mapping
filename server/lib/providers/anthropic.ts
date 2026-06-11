import Anthropic from "@anthropic-ai/sdk";
import { PROCESS_GRAPH_SCHEMA, type ProcessGraph } from "@shared/processGraph.ts";
import { LIVE_OPS_SCHEMA } from "@shared/graphOps.ts";
import type { ExtractInput } from "../inputs.ts";
import type { ChatTurn, OpsGeneration } from "../liveTypes.ts";
import { parseGraphJson } from "../parse.ts";

let _client: Anthropic | null = null;
function client(): Anthropic {
  if (!process.env.ANTHROPIC_API_KEY) {
    throw new Error(
      "ANTHROPIC_API_KEY is not set. Add it as a secret (or in .env) and restart, or pick an OpenRouter model.",
    );
  }
  if (!_client) _client = new Anthropic();
  return _client;
}

const GRAPH_FORMAT = {
  type: "json_schema",
  schema: PROCESS_GRAPH_SCHEMA as unknown as { [key: string]: unknown },
} as const;

function buildContent(inputs: ExtractInput[]): Anthropic.ContentBlockParam[] {
  const blocks: Anthropic.ContentBlockParam[] = [];
  for (const input of inputs) {
    if (input.kind === "text") {
      blocks.push({ type: "text", text: input.text });
    } else if (input.kind === "pdf") {
      blocks.push({
        type: "document",
        source: { type: "base64", media_type: "application/pdf", data: input.data },
      });
    } else {
      blocks.push({
        type: "image",
        source: {
          type: "base64",
          media_type: input.mediaType as
            | "image/jpeg"
            | "image/png"
            | "image/gif"
            | "image/webp",
          data: input.data,
        },
      });
    }
  }
  if (blocks.length === 0) blocks.push({ type: "text", text: "(no input provided)" });
  blocks.push({
    type: "text",
    text: "Extract the process flow as structured JSON matching the required schema.",
  });
  return blocks;
}

/** Anthropic provider: schema-enforced structured output + adaptive thinking. */
export async function generateGraphAnthropic(
  model: string,
  system: string,
  inputs: ExtractInput[],
): Promise<ProcessGraph> {
  const message = await client().messages.create({
    model,
    max_tokens: 16000,
    thinking: { type: "adaptive" },
    system,
    output_config: { format: GRAPH_FORMAT },
    messages: [{ role: "user", content: buildContent(inputs) }],
  });
  const textBlock = message.content.find((b) => b.type === "text");
  if (!textBlock || textBlock.type !== "text") {
    throw new Error("Model returned no text content.");
  }
  return parseGraphJson(textBlock.text);
}

const OPS_FORMAT = {
  type: "json_schema",
  schema: LIVE_OPS_SCHEMA as unknown as { [key: string]: unknown },
} as const;

/**
 * Live mode: multi-turn ops generation over the session history.
 * effort "low" is the latency lever for live updates (ops are small);
 * bump to "medium" if dense narration gets under-extracted.
 *
 * Prompt caching: breakpoint 1 on the frozen system prompt, breakpoint 2 on
 * the last message block — each request re-reads the prior history prefix.
 * Minimum cacheable prefix is 4096 tokens (Opus 4.8) / 2048 (Sonnet 4.6), so
 * early-session requests silently won't cache; hits begin as history grows.
 */
export async function generateOpsAnthropic(
  model: string,
  system: string,
  turns: ChatTurn[],
): Promise<OpsGeneration> {
  const messages: Anthropic.MessageParam[] = turns.map((turn, i) => ({
    role: turn.role,
    content:
      i === turns.length - 1
        ? [{ type: "text", text: turn.text, cache_control: { type: "ephemeral" } }]
        : turn.text,
  }));

  const message = await client().messages.create({
    model,
    max_tokens: 8000,
    thinking: { type: "adaptive" },
    system: [{ type: "text", text: system, cache_control: { type: "ephemeral" } }],
    output_config: { effort: "low", format: OPS_FORMAT },
    messages,
  });

  const textBlock = message.content.find((b) => b.type === "text");
  if (!textBlock || textBlock.type !== "text") {
    throw new Error("Model returned no text content.");
  }
  return {
    text: textBlock.text,
    cacheReadInputTokens: message.usage.cache_read_input_tokens ?? null,
    inputTokens: message.usage.input_tokens,
    outputTokens: message.usage.output_tokens,
  };
}
