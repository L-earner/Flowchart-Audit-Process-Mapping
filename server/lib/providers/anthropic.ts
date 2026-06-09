import Anthropic from "@anthropic-ai/sdk";
import { PROCESS_GRAPH_SCHEMA, type ProcessGraph } from "@shared/processGraph.ts";
import type { ExtractInput } from "../inputs.ts";
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
