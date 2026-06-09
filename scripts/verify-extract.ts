// End-to-end check of the extraction pipeline against a fixture transcript.
// Run with: npm run verify   (requires ANTHROPIC_API_KEY)
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";
import { extractGraph } from "../server/lib/anthropic.ts";
import { validateProcessGraph } from "../shared/processGraph.ts";

const __dirname = dirname(fileURLToPath(import.meta.url));

async function main() {
  if (!process.env.ANTHROPIC_API_KEY) {
    console.error("✗ ANTHROPIC_API_KEY is not set. Set it and re-run `npm run verify`.");
    process.exit(2);
  }

  const transcript = readFileSync(
    join(__dirname, "fixtures", "p2p-walkthrough.txt"),
    "utf-8",
  );

  console.log("→ Extracting process graph from the P2P fixture transcript…");
  const graph = await extractGraph([{ kind: "text", text: transcript }]);

  const { ok, errors } = validateProcessGraph(graph);
  const checks: Array<[string, boolean]> = [
    ["graph validates structurally", ok],
    ["has a title", Boolean(graph.title)],
    ["has >= 2 actors", graph.actors.length >= 2],
    ["has >= 4 nodes", graph.nodes.length >= 4],
    ["has edges", graph.edges.length >= 3],
    [
      "has at least one control node",
      graph.nodes.some((n) => n.type === "control"),
    ],
    [
      "has at least one decision node",
      graph.nodes.some((n) => n.type === "decision"),
    ],
  ];

  console.log(`\nTitle: ${graph.title}`);
  console.log(
    `Actors: ${graph.actors.map((a) => a.name).join(", ")}\n` +
      `Nodes: ${graph.nodes.length}  Edges: ${graph.edges.length}  ` +
      `Controls: ${graph.nodes.filter((n) => n.type === "control").length}\n`,
  );

  let failed = false;
  for (const [name, pass] of checks) {
    console.log(`${pass ? "✓" : "✗"} ${name}`);
    if (!pass) failed = true;
  }
  if (!ok) console.error("Validation errors:", errors);

  if (failed) {
    console.error("\n✗ Verification FAILED");
    process.exit(1);
  }
  console.log("\n✓ Verification PASSED");
}

main().catch((e) => {
  console.error("✗ Error:", (e as Error).message);
  process.exit(1);
});
