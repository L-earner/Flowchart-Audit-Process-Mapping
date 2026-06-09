import Anthropic from "@anthropic-ai/sdk";
import {
  PROCESS_GRAPH_SCHEMA,
  validateProcessGraph,
  type ProcessGraph,
} from "@shared/processGraph.ts";

const MODEL = "claude-opus-4-8";

let _client: Anthropic | null = null;
function client(): Anthropic {
  if (!process.env.ANTHROPIC_API_KEY) {
    throw new Error(
      "ANTHROPIC_API_KEY is not set. Add it as a Replit secret (or in .env) and restart.",
    );
  }
  if (!_client) _client = new Anthropic();
  return _client;
}

/** A piece of input to extract a process from. */
export type ExtractInput =
  | { kind: "text"; text: string }
  | { kind: "pdf"; data: string; filename?: string } // base64
  | { kind: "image"; data: string; mediaType: string }; // base64

const SYSTEM_PROMPT = `You are an audit process-mapping assistant. From the provided material (a walkthrough transcript, a procedure document, an image of a diagram/whiteboard, or a mix), extract a single structured process flow.

Guidelines:
- Identify the distinct ACTORS (roles, teams, or systems) that perform steps. Each becomes a swimlane. Use stable, lowercase slug ids (e.g. "ap_clerk").
- Capture steps in execution order as nodes. Use node types precisely:
  - "start"/"end": the trigger and the terminal outcome(s). actorId is null for these.
  - "process": a manual/business action performed by an actor.
  - "system": an automated/system-performed action.
  - "decision": a branch point. Outgoing edges should be labelled with the conditions ("if approved", "if rejected").
  - "control": an audit control point. ALWAYS set the "control" object: controlType (preventive/detective/manual/automated), the riskAddressed, and frequency if known. Flag approvals, reconciliations, segregation-of-duties checks, validations, and reviews as controls.
- Every non-start/end node MUST have an actorId that exists in actors.
- Edge ids and node ids must be unique and stable. Edges reference node ids only.
- Be faithful to the source; do not invent steps. If the source is sparse, produce a small but correct graph.`;

function buildUserContent(inputs: ExtractInput[]): Anthropic.ContentBlockParam[] {
  const blocks: Anthropic.ContentBlockParam[] = [];
  for (const input of inputs) {
    if (input.kind === "text") {
      blocks.push({ type: "text", text: input.text });
    } else if (input.kind === "pdf") {
      blocks.push({
        type: "document",
        source: {
          type: "base64",
          media_type: "application/pdf",
          data: input.data,
        },
      });
    } else if (input.kind === "image") {
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
  if (blocks.length === 0) {
    blocks.push({ type: "text", text: "(no input provided)" });
  }
  blocks.push({
    type: "text",
    text: "Extract the process flow as structured JSON matching the required schema.",
  });
  return blocks;
}

function parseGraph(message: Anthropic.Message): ProcessGraph {
  const textBlock = message.content.find((b) => b.type === "text");
  if (!textBlock || textBlock.type !== "text") {
    throw new Error("Model returned no text content.");
  }
  let graph: ProcessGraph;
  try {
    graph = JSON.parse(textBlock.text);
  } catch {
    throw new Error("Model output was not valid JSON.");
  }
  const { ok, errors } = validateProcessGraph(graph);
  if (!ok) {
    throw new Error(`Extracted graph failed validation: ${errors.join("; ")}`);
  }
  return graph;
}

const GRAPH_FORMAT = {
  type: "json_schema",
  schema: PROCESS_GRAPH_SCHEMA as unknown as { [key: string]: unknown },
} as const;

/** Extract a fresh process graph from one or more inputs. */
export async function extractGraph(inputs: ExtractInput[]): Promise<ProcessGraph> {
  const message = await client().messages.create({
    model: MODEL,
    max_tokens: 16000,
    thinking: { type: "adaptive" },
    system: SYSTEM_PROMPT,
    output_config: { format: GRAPH_FORMAT },
    messages: [{ role: "user", content: buildUserContent(inputs) }],
  });

  return parseGraph(message);
}

/** Merge a new transcript chunk into an existing graph (live mode). */
export async function refineGraph(
  current: ProcessGraph,
  transcriptChunk: string,
): Promise<ProcessGraph> {
  const message = await client().messages.create({
    model: MODEL,
    max_tokens: 16000,
    thinking: { type: "adaptive" },
    system:
      SYSTEM_PROMPT +
      `\n\nYou are updating an EXISTING process graph as a live conversation continues. Merge the new information into the current graph: add new actors/steps/edges, refine labels, and add controls as they are described. PRESERVE existing node and actor ids wherever the concept is unchanged so the canvas stays stable. Return the full updated graph.`,
    output_config: { format: GRAPH_FORMAT },
    messages: [
      {
        role: "user",
        content: [
          {
            type: "text",
            text:
              "Current graph JSON:\n" +
              JSON.stringify(current) +
              "\n\nNew transcript since last update:\n" +
              transcriptChunk +
              "\n\nReturn the full updated process graph as JSON.",
          },
        ],
      },
    ],
  });

  return parseGraph(message);
}
