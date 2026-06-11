// End-to-end check of the live (incremental ops) pipeline: replays a fixture
// walkthrough in chunks through the same processChunk path the /api/live
// routes use, then exercises voice commands, undo, manual canvas edits, and
// history compaction.
// Run with: npm run verify:live   (requires the selected provider's API key)
import "dotenv/config";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";
import { createSession, historyTokens } from "../server/lib/liveSession.ts";
import { processChunk } from "../server/lib/liveOps.ts";
import { validateProcessGraph, type ProcessGraph } from "../shared/processGraph.ts";
import { DEFAULT_MODEL_ID, providerFor } from "../shared/models.ts";

const __dirname = dirname(fileURLToPath(import.meta.url));

const checks: Array<[string, boolean]> = [];
function check(name: string, pass: boolean) {
  checks.push([name, pass]);
  console.log(`${pass ? "✓" : "✗"} ${name}`);
}

async function main() {
  const model = process.env.LLM_MODEL ?? DEFAULT_MODEL_ID;
  const provider = providerFor(model);
  const needKey = provider === "openrouter" ? "OPENROUTER_API_KEY" : "ANTHROPIC_API_KEY";
  if (!process.env[needKey]) {
    console.error(`✗ ${needKey} is not set (needed for model "${model}"). Set it and re-run.`);
    process.exit(2);
  }

  const transcript = readFileSync(
    join(__dirname, "fixtures", "p2p-walkthrough.txt"),
    "utf-8",
  );
  // Paragraphs ≈ the cadence of debounced speech chunks.
  const chunks = transcript
    .split(/\n\s*\n/)
    .map((p) => p.replace(/\s+/g, " ").trim())
    .filter(Boolean)
    .slice(1); // drop the "notes from meeting" header line

  console.log(`→ Live replay with ${provider} model "${model}" — ${chunks.length} chunks\n`);

  const session = createSession({ title: "Untitled process", actors: [], nodes: [], edges: [] });
  // The "client" mirrors the canvas: it applies returned ops (here we adopt
  // the server graph directly — equivalent while no manual edits happen).
  let client: ProcessGraph = session.graph;

  const send = async (chunk: string) => {
    const result = await processChunk(session, { chunk, clientGraph: client, model });
    console.log(
      `  [turn] ops=${result.ops.length} rejected=${result.rejected.length} ` +
        `history≈${result.usage.historyTokensEstimate}tok cacheRead=${result.usage.cacheReadInputTokens ?? "-"} ` +
        `nodes=${result.graph.nodes.length} edges=${result.graph.edges.length}` +
        (result.note ? ` note="${result.note}"` : ""),
    );
    if (result.rejected.length) console.log(`    rejected: ${result.rejected.join("; ")}`);
    return result;
  };

  // --- 1. Incremental build from empty -------------------------------------
  for (const chunk of chunks) {
    const result = await send(chunk);
    if (!result.ops.some((op) => op.op === "undo_last")) client = result.graph;
  }
  const { ok, errors } = validateProcessGraph(client);
  if (!ok) console.error("  validation errors:", errors);
  check("replayed graph validates structurally", ok);
  check("has >= 2 actors", client.actors.length >= 2);
  check("has >= 4 nodes", client.nodes.length >= 4);
  check("has >= 1 decision node", client.nodes.some((n) => n.type === "decision"));
  const connected = client.nodes.every(
    (n) => client.edges.some((e) => e.source === n.id || e.target === n.id) || client.nodes.length <= 1,
  );
  check("every node has at least one edge", connected);
  console.log(
    `\n  Built: "${client.title}" — actors: ${client.actors.map((a) => a.name).join(", ")}; ` +
      `${client.nodes.length} nodes, ${client.edges.length} edges, ` +
      `${client.nodes.filter((n) => n.type === "control").length} controls\n`,
  );

  // --- 2. Filler speech must produce no ops --------------------------------
  const filler = await send("um so anyway, sorry, where were we — how was your weekend by the way");
  check("filler chunk produces zero ops", filler.ops.length === 0);
  client = filler.graph;

  // --- 3. Voice command: remove a step -------------------------------------
  const match = client.nodes.find((n) => /three.?way|match/i.test(n.label));
  check("graph contains a three-way match step to remove", Boolean(match));
  const preDelete = client;
  if (match) {
    const cmd = await send("actually, remove the three-way match step from the diagram");
    check(
      "voice command emits delete for the matched step",
      cmd.ops.some((op) => op.op === "delete_node" && op.id === match.id) &&
        !cmd.graph.nodes.some((n) => n.id === match.id),
    );
    client = cmd.graph;

    // --- 4. Voice undo ------------------------------------------------------
    const undo = await send("no wait, undo that");
    check(
      "undo request emits a lone undo_last op",
      undo.ops.length === 1 && undo.ops[0].op === "undo_last",
    );
    // Simulate the client popping its undo stack: restore the pre-delete
    // graph. The next request's graph sync reconciles the server mirror.
    client = preDelete;
  }

  // --- 5. Manual canvas delete must not be resurrected ----------------------
  const victim = client.nodes.find((n) => n.type === "process" || n.type === "system");
  check("graph has a node to manually delete", Boolean(victim));
  if (victim) {
    client = {
      ...client,
      nodes: client.nodes.filter((n) => n.id !== victim.id),
      edges: client.edges.filter((e) => e.source !== victim.id && e.target !== victim.id),
    };
    const after = await send(
      "one more thing — the payments team also reconciles the bank statement after each payment run",
    );
    check(
      "manually deleted node stays deleted",
      !after.graph.nodes.some((n) => n.id === victim.id),
    );
    check(
      "manual edit notice landed in history",
      session.history.some((t) => t.text.includes("changed the canvas")),
    );
    client = after.graph;
  }

  // --- 6. Compaction ---------------------------------------------------------
  process.env.LIVE_COMPACT_TOKENS = "300";
  const turnsBefore = session.history.length;
  const compacted = await send("the bank reconciliation is a detective control done weekly by the payments supervisor");
  client = compacted.graph;
  check(
    "history compacted under a low token budget",
    session.history.length < turnsBefore && session.history.some((t) => t.text.includes("[Context compacted")),
  );
  console.log(`  history after compaction: ${session.history.length} turns ≈${historyTokens(session)}tok`);
  const postCompact = validateProcessGraph(client);
  check("graph still valid after post-compaction turn", postCompact.ok);

  // ---------------------------------------------------------------------------
  const failed = checks.filter(([, pass]) => !pass);
  if (failed.length) {
    console.error(`\n✗ Live verification FAILED (${failed.length}/${checks.length} checks)`);
    process.exit(1);
  }
  console.log(`\n✓ Live verification PASSED (${checks.length} checks)`);
}

main().catch((e) => {
  console.error("✗ Error:", (e as Error).message);
  process.exit(1);
});
