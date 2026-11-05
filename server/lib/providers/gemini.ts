// Google Gemini provider (Gemini API / Google AI Studio keys), via the
// official @google/genai SDK so the wire format stays current.
//
// - Extraction: JSON Schema-constrained output (responseMimeType +
//   responseJsonSchema) with the model's default thinking level.
// - Live mode: same, over a multi-turn history, with thinkingLevel LOW for
//   latency. Gemini caches repeated prompt prefixes implicitly, so the frozen
//   live system prompt is reused across turns without explicit breakpoints.
import { GoogleGenAI, ThinkingLevel, type Content, type Part } from "@google/genai";
import { PROCESS_GRAPH_SCHEMA, type ProcessGraph } from "@shared/processGraph.ts";
import { LIVE_OPS_SCHEMA } from "@shared/graphOps.ts";
import type { ExtractInput } from "../inputs.ts";
import type { ChatTurn, OpsGeneration } from "../liveTypes.ts";
import { parseGraphJson } from "../parse.ts";

/** Either name works: Google's docs use GEMINI_API_KEY; the SDK also reads GOOGLE_API_KEY. */
export function geminiApiKey(): string | undefined {
  return process.env.GEMINI_API_KEY || process.env.GOOGLE_API_KEY || undefined;
}

let _client: GoogleGenAI | null = null;
let _clientKey: string | undefined;
function client(): GoogleGenAI {
  const apiKey = geminiApiKey();
  if (!apiKey) {
    throw new Error(
      "GEMINI_API_KEY is not set. Create a key in Google AI Studio (aistudio.google.com/apikey), add it as a secret (or in .env) and restart, or pick an OpenRouter model.",
    );
  }
  // GEMINI_BASE_URL is for tests (a local fake server); leave unset in real use.
  if (!_client || _clientKey !== apiKey) {
    _client = new GoogleGenAI({
      apiKey,
      ...(process.env.GEMINI_BASE_URL ? { httpOptions: { baseUrl: process.env.GEMINI_BASE_URL } } : {}),
    });
    _clientKey = apiKey;
  }
  return _client;
}

/** Test hook: forget the cached client so a changed key/base URL takes effect. */
export function resetGeminiClient() {
  _client = null;
  _clientKey = undefined;
}

export function buildGeminiParts(inputs: ExtractInput[]): Part[] {
  const parts: Part[] = [];
  for (const input of inputs) {
    if (input.kind === "text") {
      parts.push({ text: input.text });
    } else if (input.kind === "pdf") {
      parts.push({ inlineData: { mimeType: "application/pdf", data: input.data } });
    } else {
      parts.push({ inlineData: { mimeType: input.mediaType, data: input.data } });
    }
  }
  if (parts.length === 0) parts.push({ text: "(no input provided)" });
  parts.push({ text: "Extract the process flow as structured JSON matching the required schema." });
  return parts;
}

/** Provider-neutral history → Gemini contents (assistant turns are role "model"). */
export function toGeminiContents(turns: ChatTurn[]): Content[] {
  return turns.map((turn) => ({
    role: turn.role === "assistant" ? "model" : "user",
    parts: [{ text: turn.text }],
  }));
}

/** Pull the JSON text out of a response, with a clear error when there is none. */
function responseText(response: {
  text?: string;
  candidates?: Array<{ finishReason?: string }>;
  promptFeedback?: { blockReason?: string };
}): string {
  const text = response.text;
  if (text && text.trim()) return text;
  const blocked = response.promptFeedback?.blockReason;
  if (blocked) throw new Error(`Gemini blocked the request (${blocked}).`);
  const reason = response.candidates?.[0]?.finishReason;
  if (reason === "MAX_TOKENS") {
    throw new Error("Gemini ran out of output tokens before finishing the map. Try a shorter input or split it up.");
  }
  throw new Error(`Gemini returned no text${reason ? ` (finish reason: ${reason})` : ""}.`);
}

/** Turn SDK/HTTP errors into messages a user can act on. */
function friendlyError(err: unknown): Error {
  const e = err as { status?: number; message?: string };
  const message = e?.message ?? String(err);
  if (e?.status === 400 && /API key not valid|API_KEY_INVALID/i.test(message)) {
    return new Error("Gemini rejected the API key. Check GEMINI_API_KEY (from aistudio.google.com/apikey).");
  }
  if (e?.status === 403) return new Error(`Gemini refused the request (403): ${message}`);
  if (e?.status === 404) {
    return new Error(`Gemini doesn't recognise that model (404). It may have been renamed or retired — update shared/models.ts. ${message}`);
  }
  if (e?.status === 429) return new Error("Gemini rate limit or quota reached (429). Wait a moment and retry, or check your quota in Google AI Studio.");
  return err instanceof Error ? err : new Error(message);
}

const EXTRACT_MAX_OUTPUT_TOKENS = 32000;
const OPS_MAX_OUTPUT_TOKENS = 8000;

export async function generateGraphGemini(
  model: string,
  system: string,
  inputs: ExtractInput[],
): Promise<ProcessGraph> {
  let response;
  try {
    response = await client().models.generateContent({
      model,
      contents: [{ role: "user", parts: buildGeminiParts(inputs) }],
      config: {
        systemInstruction: system,
        maxOutputTokens: EXTRACT_MAX_OUTPUT_TOKENS,
        responseMimeType: "application/json",
        responseJsonSchema: PROCESS_GRAPH_SCHEMA,
      },
    });
  } catch (err) {
    throw friendlyError(err);
  }
  return parseGraphJson(responseText(response));
}

export async function generateOpsGemini(
  model: string,
  system: string,
  turns: ChatTurn[],
): Promise<OpsGeneration> {
  let response;
  try {
    response = await client().models.generateContent({
      model,
      contents: toGeminiContents(turns),
      config: {
        systemInstruction: system,
        maxOutputTokens: OPS_MAX_OUTPUT_TOKENS,
        responseMimeType: "application/json",
        responseJsonSchema: LIVE_OPS_SCHEMA,
        // Latency lever for live updates (ops are small). Raise to MEDIUM if
        // dense narration gets under-extracted.
        thinkingConfig: { thinkingLevel: ThinkingLevel.LOW },
      },
    });
  } catch (err) {
    throw friendlyError(err);
  }
  const usage = response.usageMetadata;
  return {
    text: responseText(response),
    cacheReadInputTokens: usage?.cachedContentTokenCount ?? null,
    inputTokens: usage?.promptTokenCount ?? 0,
    outputTokens: (usage?.candidatesTokenCount ?? 0) + (usage?.thoughtsTokenCount ?? 0),
  };
}
