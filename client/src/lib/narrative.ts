// Written process narrative, generated deterministically from the graph (no
// model call): numbered steps in reading order, decisions spelled out with
// their branches, and the key controls. Exported as a Word document.
import type { ProcessGraph } from "../types";
import { flowOrder } from "./flowOrder";
import { assignControlIds } from "./controlIds";
import { buildRcm, downloadBlob, fileSlug, type RcmRow } from "./rcm";
import { KIND_LABEL, orderedOpenPoints } from "./openPoints";

export interface NarrativeStep {
  number: number;
  text: string;
  isControl: boolean;
}

export interface Narrative {
  title: string;
  summary: string;
  participants: Array<{ name: string; steps: number; controls: number }>;
  steps: NarrativeStep[];
  controls: RcmRow[];
  openPoints: Array<{ kind: string; step: string; issue: string; question: string }>;
}

const sentence = (s: string) => {
  const t = s.trim();
  return t && !/[.!?]$/.test(t) ? `${t}.` : t;
};

export function buildNarrative(input: ProcessGraph): Narrative {
  const graph = assignControlIds(input);
  const order = flowOrder(graph);
  const number = new Map(order.map((n, i) => [n.id, i + 1]));
  const byId = new Map(graph.nodes.map((n) => [n.id, n]));
  const actor = new Map(graph.actors.map((a) => [a.id, a.name]));

  const ref = (id: string) => {
    const n = byId.get(id);
    return n ? `step ${number.get(id)} (${n.label})` : "an unmapped step";
  };

  const steps: NarrativeStep[] = order.map((n) => {
    const who = n.actorId ? actor.get(n.actorId) : undefined;
    const outgoing = graph.edges.filter((e) => e.source === n.id && byId.has(e.target));
    const parts: string[] = [];

    if (n.type === "start") {
      parts.push(`The process starts when: ${sentence(n.label)}`);
    } else if (n.type === "end") {
      parts.push(`The process ends: ${sentence(n.label)}`);
    } else if (n.type === "decision") {
      parts.push(`${who ?? "The process"} decides: ${n.label.trim()}`);
    } else if (n.type === "system") {
      parts.push(`${who ?? "The system"} (automated): ${sentence(n.label)}`);
    } else {
      parts.push(`${who ?? "Unassigned"}: ${sentence(n.label)}`);
    }

    if (n.description?.trim()) parts.push(sentence(n.description));

    if (n.type === "control" && n.control) {
      const meta = [n.control.controlType, n.control.frequency?.trim()].filter(Boolean).join(", ");
      parts.push(
        `This is control ${n.control.controlId}${meta ? ` (${meta})` : ""}, addressing the risk: ${sentence(
          n.control.riskAddressed || "not recorded",
        )}`,
      );
    }

    if (n.type === "decision") {
      if (outgoing.length) {
        parts.push(
          outgoing
            .map((e, i) => {
              const cond = e.label?.trim() ? `if ${e.label.trim()}` : "otherwise";
              const clause = `${cond}, go to ${ref(e.target)}`;
              return i === 0 ? clause[0].toUpperCase() + clause.slice(1) : clause;
            })
            .join("; ") + ".",
        );
      } else {
        parts.push("No outcomes are mapped for this decision.");
      }
    } else if (n.type !== "end") {
      const next = number.get(n.id)! + 1;
      const onlyNextInOrder =
        outgoing.length === 1 && !outgoing[0].label?.trim() && number.get(outgoing[0].target) === next;
      if (outgoing.length === 0) {
        parts.push("No next step is mapped.");
      } else if (!onlyNextInOrder) {
        parts.push(
          `Then ${outgoing
            .map((e) => `${e.label?.trim() ? `${e.label.trim()}: ` : ""}${ref(e.target)}`)
            .join("; ")}.`,
        );
      }
    }

    return { number: number.get(n.id)!, text: parts.join(" "), isControl: n.type === "control" };
  });

  const participants = graph.actors.map((a) => ({
    name: a.name,
    steps: graph.nodes.filter((n) => n.actorId === a.id).length,
    controls: graph.nodes.filter((n) => n.actorId === a.id && n.type === "control").length,
  }));

  return {
    title: graph.title,
    summary: graph.summary?.trim() ?? "",
    participants,
    steps,
    controls: buildRcm(graph),
    openPoints: orderedOpenPoints(graph).map((p) => ({
      kind: KIND_LABEL[p.kind],
      step: p.nodeId && number.has(p.nodeId) ? `${number.get(p.nodeId)}. ${byId.get(p.nodeId)!.label}` : "Whole process",
      issue: p.issue,
      question: p.question,
    })),
  };
}

/** Plain-text rendering (used for tests and "copy as text"). */
export function narrativeToText(n: Narrative): string {
  const lines = [n.title, ""];
  if (n.summary) lines.push(n.summary, "");
  lines.push("Participants:");
  for (const p of n.participants) lines.push(`- ${p.name}: ${p.steps} step(s), ${p.controls} control(s)`);
  lines.push("", "Process narrative:");
  for (const s of n.steps) lines.push(`${s.number}. ${s.text}`);
  lines.push("", "Key controls:");
  if (!n.controls.length) lines.push("- None mapped.");
  for (const c of n.controls) lines.push(`- ${c.controlId} ${c.control} — ${c.owner}; ${c.controlType}; ${c.frequency}. Risk: ${c.risk}`);
  if (n.openPoints.length) {
    lines.push("", "Open points to confirm:");
    for (const p of n.openPoints) lines.push(`- [${p.kind}] ${p.step}: ${p.issue} Ask: ${p.question}`);
  }
  return lines.join("\n");
}

export async function exportNarrativeDocx(graph: ProcessGraph) {
  const d = await import("docx");
  const n = buildNarrative(graph);
  const date = new Date().toLocaleDateString(undefined, { day: "numeric", month: "long", year: "numeric" });

  const cell = (text: string, bold = false, shade = false) =>
    new d.TableCell({
      children: [new d.Paragraph({ children: [new d.TextRun({ text, bold, size: 19 })] })],
      ...(shade ? { shading: { type: d.ShadingType.CLEAR, color: "auto", fill: "EEF2FF" } } : {}),
      margins: { top: 60, bottom: 60, left: 90, right: 90 },
    });
  const table = (headers: string[], rows: string[][], widths: number[]) =>
    new d.Table({
      width: { size: 100, type: d.WidthType.PERCENTAGE },
      columnWidths: widths,
      rows: [
        new d.TableRow({ tableHeader: true, children: headers.map((h) => cell(h, true, true)) }),
        ...rows.map((r) => new d.TableRow({ children: r.map((v) => cell(v)) })),
      ],
    });

  const children = [
    new d.Paragraph({ heading: d.HeadingLevel.TITLE, children: [new d.TextRun(n.title)] }),
    new d.Paragraph({
      children: [new d.TextRun({ text: `Process narrative · generated ${date}`, color: "667085", size: 18 })],
      spacing: { after: 240 },
    }),
    ...(n.summary ? [new d.Paragraph({ children: [new d.TextRun(n.summary)], spacing: { after: 240 } })] : []),
    new d.Paragraph({ heading: d.HeadingLevel.HEADING_1, children: [new d.TextRun("Participants")] }),
    table(
      ["Role / system", "Steps", "Controls"],
      n.participants.map((p) => [p.name, String(p.steps), String(p.controls)]),
      [5200, 1900, 1900],
    ),
    new d.Paragraph({ heading: d.HeadingLevel.HEADING_1, children: [new d.TextRun("Process narrative")], spacing: { before: 320 } }),
    ...n.steps.map(
      (s) =>
        new d.Paragraph({
          spacing: { after: 120 },
          indent: { left: 440, hanging: 440 },
          children: [
            new d.TextRun({ text: `${s.number}.\t`, bold: true }),
            new d.TextRun({ text: s.text, ...(s.isControl ? { color: "92400E" } : {}) }),
          ],
          tabStops: [{ type: d.TabStopType.LEFT, position: 440 }],
        }),
    ),
    new d.Paragraph({ heading: d.HeadingLevel.HEADING_1, children: [new d.TextRun("Key controls")], spacing: { before: 320 } }),
    n.controls.length
      ? table(
          ["ID", "Control activity", "Owner", "Type / frequency", "Risk addressed"],
          n.controls.map((c) => [c.controlId, c.control, c.owner, `${c.controlType}; ${c.frequency}`, c.risk]),
          [800, 2400, 1600, 1600, 2600],
        )
      : new d.Paragraph("No control points are mapped in this process yet."),
    ...(n.openPoints.length
      ? [
          new d.Paragraph({
            heading: d.HeadingLevel.HEADING_1,
            children: [new d.TextRun("Open points to confirm")],
            spacing: { before: 320 },
          }),
          table(
            ["Type", "Step", "Issue", "Question for the process owner"],
            n.openPoints.map((p) => [p.kind, p.step, p.issue, p.question]),
            [1200, 2000, 2900, 2900],
          ),
        ]
      : []),
    new d.Paragraph({
      spacing: { before: 360 },
      children: [
        new d.TextRun({
          text: "Generated by Process-Flow Mapper from the process map. Review against the walkthrough evidence before relying on it.",
          italics: true,
          color: "667085",
          size: 17,
        }),
      ],
    }),
  ];

  const doc = new d.Document({
    creator: "Process-Flow Mapper",
    title: n.title,
    styles: { default: { document: { run: { font: "Calibri", size: 21 } } } },
    sections: [{ children }],
  });
  const blob = await d.Packer.toBlob(doc);
  downloadBlob(blob, `${fileSlug(graph.title)}-narrative.docx`);
}
