// A single piece of material to extract a process from. Provider-agnostic;
// each LLM provider knows how to render these into its own message format.
export type ExtractInput =
  | { kind: "text"; text: string }
  | { kind: "pdf"; data: string; filename?: string } // base64
  | { kind: "image"; data: string; mediaType: string }; // base64
