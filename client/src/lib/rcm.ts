// Risk & Control Matrix: one row per control, in process order. Pure builders
// (tested) plus browser-only file writers that lazy-load their libraries.
import type { ProcessGraph, ProcessNode } from "../types";
import { flowOrder } from "./flowOrder";
import { assignControlIds } from "./controlIds";

export interface RcmRow {
  controlId: string;
  process: string;
  control: string;
  description: string;
  owner: string;
  controlType: string;
  frequency: string;
  risk: string;
  precededBy: string;
  followedBy: string;
}

export const RCM_COLUMNS: Array<{ key: keyof RcmRow; header: string; width: number }> = [
  { key: "controlId", header: "Control ID", width: 11 },
  { key: "process", header: "Process", width: 22 },
  { key: "control", header: "Control activity", width: 32 },
  { key: "description", header: "Description", width: 40 },
  { key: "owner", header: "Control owner", width: 20 },
  { key: "controlType", header: "Control type", width: 14 },
  { key: "frequency", header: "Frequency", width: 16 },
  { key: "risk", header: "Risk addressed", width: 40 },
  { key: "precededBy", header: "Preceding step", width: 28 },
  { key: "followedBy", header: "Next step(s)", width: 32 },
];

const NOT_RECORDED = "Not recorded";

function describeLink(label: string | undefined, node: ProcessNode | undefined): string {
  if (!node) return "";
  return label?.trim() ? `${node.label} (${label.trim()})` : node.label;
}

export function buildRcm(input: ProcessGraph): RcmRow[] {
  const graph = assignControlIds(input);
  const byId = new Map(graph.nodes.map((n) => [n.id, n]));
  const actor = new Map(graph.actors.map((a) => [a.id, a.name]));
  return flowOrder(graph)
    .filter((n) => n.type === "control")
    .map((n) => ({
      controlId: n.control?.controlId ?? "",
      process: graph.title,
      control: n.label,
      description: n.description?.trim() ?? "",
      owner: (n.actorId && actor.get(n.actorId)) || NOT_RECORDED,
      controlType: n.control?.controlType ?? "",
      frequency: n.control?.frequency?.trim() || NOT_RECORDED,
      risk: n.control?.riskAddressed?.trim() || NOT_RECORDED,
      precededBy: graph.edges
        .filter((e) => e.target === n.id)
        .map((e) => describeLink(e.label, byId.get(e.source)))
        .filter(Boolean)
        .join("; "),
      followedBy: graph.edges
        .filter((e) => e.source === n.id)
        .map((e) => describeLink(e.label, byId.get(e.target)))
        .filter(Boolean)
        .join("; "),
    }));
}

export interface StepRow {
  step: number;
  label: string;
  type: string;
  owner: string;
  controlId: string;
  leadsTo: string;
}

/** Every step in reading order, numbered, with where it leads. */
export function buildStepList(input: ProcessGraph): StepRow[] {
  const graph = assignControlIds(input);
  const order = flowOrder(graph);
  const number = new Map(order.map((n, i) => [n.id, i + 1]));
  const actor = new Map(graph.actors.map((a) => [a.id, a.name]));
  return order.map((n) => ({
    step: number.get(n.id)!,
    label: n.label,
    type: n.type,
    owner: n.actorId ? actor.get(n.actorId) ?? "" : "",
    controlId: n.type === "control" ? n.control?.controlId ?? "" : "",
    leadsTo: graph.edges
      .filter((e) => e.source === n.id && number.has(e.target))
      .map((e) => `${number.get(e.target)}${e.label?.trim() ? ` (${e.label.trim()})` : ""}`)
      .join(", "),
  }));
}

/** RFC 4180 CSV with a UTF-8 BOM so Excel opens accents/dashes correctly. */
export function rcmToCsv(rows: RcmRow[]): string {
  const escape = (v: string) => (/[",\r\n]/.test(v) ? `"${v.replace(/"/g, '""')}"` : v);
  const lines = [
    RCM_COLUMNS.map((c) => escape(c.header)).join(","),
    ...rows.map((r) => RCM_COLUMNS.map((c) => escape(r[c.key])).join(",")),
  ];
  return "﻿" + lines.join("\r\n") + "\r\n";
}

export function fileSlug(s: string): string {
  return s.toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-|-$/g, "") || "process";
}

export function downloadBlob(blob: Blob, filename: string) {
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = filename;
  a.click();
  setTimeout(() => URL.revokeObjectURL(url), 1000);
}

export function exportRcmCsv(graph: ProcessGraph) {
  const blob = new Blob([rcmToCsv(buildRcm(graph))], { type: "text/csv;charset=utf-8" });
  downloadBlob(blob, `${fileSlug(graph.title)}-rcm.csv`);
}

const HEADER_STYLE = {
  fontWeight: "bold",
  backgroundColor: "#EEF2FF",
  borderColor: "#C7D2FE",
  borderStyle: "thin",
  alignVertical: "center",
  wrap: true,
} as const;
const CELL_STYLE = { wrap: true, alignVertical: "top" } as const;

/** Excel workbook: "Risk & Control Matrix" + "Process steps" sheets. */
export async function exportRcmXlsx(graph: ProcessGraph) {
  const { default: writeXlsxFile } = await import("write-excel-file/browser");
  const rcm = buildRcm(graph);
  const steps = buildStepList(graph);

  const rcmData = [
    RCM_COLUMNS.map((c) => ({ value: c.header, ...HEADER_STYLE })),
    ...rcm.map((r) => RCM_COLUMNS.map((c) => ({ value: r[c.key], ...CELL_STYLE }))),
  ];
  if (rcm.length === 0) {
    rcmData.push([
      { value: "No control points are mapped in this process yet.", ...CELL_STYLE },
      ...RCM_COLUMNS.slice(1).map(() => ({ value: "", ...CELL_STYLE })),
    ]);
  }

  const stepColumns = [
    { header: "Step #", width: 8, get: (r: StepRow) => r.step },
    { header: "Step", width: 36, get: (r: StepRow) => r.label },
    { header: "Type", width: 11, get: (r: StepRow) => r.type },
    { header: "Owner", width: 22, get: (r: StepRow) => r.owner },
    { header: "Control ID", width: 11, get: (r: StepRow) => r.controlId },
    { header: "Leads to step(s)", width: 30, get: (r: StepRow) => r.leadsTo },
  ];
  const stepData = [
    stepColumns.map((c) => ({ value: c.header, ...HEADER_STYLE })),
    ...steps.map((r) => stepColumns.map((c) => ({ value: c.get(r), ...CELL_STYLE }))),
  ];

  const blob = await writeXlsxFile(
    [
      {
        data: rcmData,
        sheet: "Risk & Control Matrix",
        columns: RCM_COLUMNS.map((c) => ({ width: c.width })),
        stickyRowsCount: 1,
        orientation: "landscape",
      },
      {
        data: stepData,
        sheet: "Process steps",
        columns: stepColumns.map((c) => ({ width: c.width })),
        stickyRowsCount: 1,
      },
    ],
    { fontFamily: "Calibri", fontSize: 11 },
  ).toBlob();
  downloadBlob(blob, `${fileSlug(graph.title)}-rcm.xlsx`);
}
