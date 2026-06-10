import type { ProcessGraph } from "../types";

export interface GraphQuality {
  score: number;
  checks: Array<{
    label: string;
    value: number;
    status: "good" | "warning";
  }>;
  warnings: string[];
}

export function assessGraph(graph: ProcessGraph): GraphQuality {
  const starts = graph.nodes.filter((node) => node.type === "start").length;
  const ends = graph.nodes.filter((node) => node.type === "end").length;
  const controls = graph.nodes.filter((node) => node.type === "control").length;
  const decisions = graph.nodes.filter((node) => node.type === "decision").length;
  const connected = new Set(
    graph.edges.flatMap((edge) => [edge.source, edge.target]),
  );
  const disconnected = graph.nodes.filter(
    (node) => graph.nodes.length > 1 && !connected.has(node.id),
  );
  const incompleteControls = graph.nodes.filter(
    (node) =>
      node.type === "control" &&
      (!node.control?.riskAddressed.trim() || !node.control?.controlType),
  );
  const unlabelledBranches = graph.nodes.flatMap((node) => {
    if (node.type !== "decision") return [];
    const outgoing = graph.edges.filter((edge) => edge.source === node.id);
    return outgoing.length < 2 || outgoing.some((edge) => !edge.label?.trim())
      ? [node]
      : [];
  });

  const warnings: string[] = [];
  if (starts === 0) warnings.push("Add a start node to show the process trigger.");
  if (ends === 0) warnings.push("Add an end node to show the process outcome.");
  if (disconnected.length > 0) {
    warnings.push(`${disconnected.length} step${disconnected.length === 1 ? " is" : "s are"} disconnected.`);
  }
  if (incompleteControls.length > 0) {
    warnings.push(`${incompleteControls.length} control${incompleteControls.length === 1 ? " needs" : "s need"} a risk addressed.`);
  }
  if (unlabelledBranches.length > 0) {
    warnings.push(`${unlabelledBranches.length} decision${unlabelledBranches.length === 1 ? " needs" : "s need"} two labelled outcomes.`);
  }

  const checks: GraphQuality["checks"] = [
    { label: "Actors", value: graph.actors.length, status: graph.actors.length > 0 ? "good" : "warning" },
    { label: "Steps", value: graph.nodes.length, status: graph.nodes.length > 1 ? "good" : "warning" },
    { label: "Controls", value: controls, status: "good" },
    { label: "Decisions", value: decisions, status: unlabelledBranches.length === 0 ? "good" : "warning" },
  ];

  const totalChecks = 5;
  const failedChecks =
    Number(starts === 0) +
    Number(ends === 0) +
    Number(disconnected.length > 0) +
    Number(incompleteControls.length > 0) +
    Number(unlabelledBranches.length > 0);

  return {
    score: Math.round(((totalChecks - failedChecks) / totalChecks) * 100),
    checks,
    warnings,
  };
}
