// Registry of selectable models. Imported by both the client (for the picker)
// and the server (to route to the right provider). Pure data — no provider SDKs.

export type Provider = "gemini" | "openrouter";

export interface ModelInfo {
  id: string;
  label: string;
  provider: Provider;
  /** Whether the model can accept image input. */
  vision: boolean;
  note?: string;
}

// OpenRouter model ids occasionally change as new versions ship. If one stops
// working, update the id here (see https://openrouter.ai/models).
export const MODELS: ModelInfo[] = [
  // --- Google Gemini (JSON Schema-constrained output; text, PDF, images) ---
  // Ids from ai.google.dev/gemini-api/docs/models (Nov 2026). Google retires
  // ids regularly — if one 404s, update it here.
  { id: "gemini-3.8-flash", label: "Gemini 3.8 Flash", provider: "gemini", vision: true, note: "Recommended default; text, PDF, images." },
  { id: "gemini-4-argon", label: "Gemini 4 Argon", provider: "gemini", vision: true, note: "Flagship reasoning model; best for long or messy material." },
  { id: "gemini-3.5-flash-lite", label: "Gemini 3.5 Flash-Lite", provider: "gemini", vision: true, note: "Fastest and cheapest; good for live mode." },

  // --- OpenRouter models (schema-constrained output) ---
  { id: "openai/gpt-5.3-codex", label: "OpenAI GPT-5.3-Codex", provider: "openrouter", vision: false, note: "Advanced reasoning and coding model; text input." },
  { id: "openai/gpt-oss-120b", label: "OpenAI gpt-oss 120B", provider: "openrouter", vision: false, note: "OpenAI open-weight reasoning model; text input." },
  { id: "deepseek/deepseek-chat", label: "DeepSeek V3", provider: "openrouter", vision: false, note: "Strong, cheap, open-weight." },
  { id: "meta-llama/llama-3.3-70b-instruct", label: "Llama 3.3 70B", provider: "openrouter", vision: false },
  { id: "qwen/qwen-2.5-72b-instruct", label: "Qwen 2.5 72B", provider: "openrouter", vision: false },
  { id: "mistralai/mistral-small-3.2-24b-instruct", label: "Mistral Small 3.2 24B", provider: "openrouter", vision: true, note: "Text and image input." },
  { id: "qwen/qwen2.5-vl-72b-instruct", label: "Qwen2.5-VL 72B", provider: "openrouter", vision: true, note: "Open-weight with vision (images)." },
];

export const DEFAULT_MODEL_ID = "gemini-3.8-flash";

export function modelInfo(id: string): ModelInfo | undefined {
  return MODELS.find((m) => m.id === id);
}

export function providerFor(id: string): Provider {
  return (
    modelInfo(id)?.provider ?? (id.startsWith("gemini") ? "gemini" : "openrouter")
  );
}
