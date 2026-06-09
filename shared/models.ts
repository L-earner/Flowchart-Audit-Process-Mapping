// Registry of selectable models. Imported by both the client (for the picker)
// and the server (to route to the right provider). Pure data — no provider SDKs.

export type Provider = "anthropic" | "openrouter";

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
  // --- Anthropic (schema-enforced structured output, vision, PDF) ---
  { id: "claude-opus-4-8", label: "Claude Opus 4.8", provider: "anthropic", vision: true, note: "Best quality; text, PDF, images." },
  { id: "claude-sonnet-4-6", label: "Claude Sonnet 4.6", provider: "anthropic", vision: true, note: "Faster / cheaper than Opus." },

  // --- OpenRouter open-weight models (JSON-prompted; text-focused) ---
  { id: "deepseek/deepseek-chat", label: "DeepSeek V3", provider: "openrouter", vision: false, note: "Strong, cheap, open-weight." },
  { id: "meta-llama/llama-3.3-70b-instruct", label: "Llama 3.3 70B", provider: "openrouter", vision: false },
  { id: "qwen/qwen-2.5-72b-instruct", label: "Qwen 2.5 72B", provider: "openrouter", vision: false },
  { id: "mistralai/mistral-small-3.2-24b-instruct", label: "Mistral Small 3.2 24B", provider: "openrouter", vision: false },
  { id: "qwen/qwen2.5-vl-72b-instruct", label: "Qwen2.5-VL 72B", provider: "openrouter", vision: true, note: "Open-weight with vision (images)." },
];

export const DEFAULT_MODEL_ID = "claude-opus-4-8";

export function modelInfo(id: string): ModelInfo | undefined {
  return MODELS.find((m) => m.id === id);
}

export function providerFor(id: string): Provider {
  return (
    modelInfo(id)?.provider ?? (id.startsWith("claude") ? "anthropic" : "openrouter")
  );
}
