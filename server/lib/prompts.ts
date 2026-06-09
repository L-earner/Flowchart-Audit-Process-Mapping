import { PROCESS_GRAPH_SCHEMA } from "@shared/processGraph.ts";

export const SYSTEM_PROMPT = `You are an audit process-mapping assistant. From the provided material (a walkthrough transcript, a procedure document, an image of a diagram/whiteboard, or a mix), extract a single structured process flow.

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

export const REFINE_ADDENDUM = `\n\nYou are updating an EXISTING process graph as a live conversation continues. Merge the new information into the current graph: add new actors/steps/edges, refine labels, and add controls as they are described. PRESERVE existing node and actor ids wherever the concept is unchanged so the canvas stays stable. Return the full updated graph.`;

/**
 * Appended to the system prompt for providers WITHOUT enforced structured
 * output (OpenRouter / open models). Embeds the schema and demands raw JSON.
 */
export const SCHEMA_INSTRUCTION = `\n\nRespond with ONLY a single JSON object — no markdown, no code fences, no commentary before or after. The object MUST conform to this JSON Schema:\n${JSON.stringify(
  PROCESS_GRAPH_SCHEMA,
)}`;
