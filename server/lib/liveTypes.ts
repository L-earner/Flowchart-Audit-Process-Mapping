// Provider-neutral types for live mode. History is stored as plain
// {role, text} turns and converted to each provider's wire format at call
// time, so switching models mid-session (even across providers) just works.

export interface ChatTurn {
  role: "user" | "assistant";
  text: string;
}

/** Raw ops-generation result; usage fields feed the verify-live printout. */
export interface OpsGeneration {
  text: string;
  cacheReadInputTokens: number | null;
  inputTokens: number;
  outputTokens: number;
}
