import Database from "better-sqlite3";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";
import type { ProcessGraph, ViewMode } from "@shared/processGraph.ts";

const __dirname = dirname(fileURLToPath(import.meta.url));
const DB_PATH = process.env.DB_PATH ?? join(__dirname, "..", "diagrams.db");

const db = new Database(DB_PATH);
db.pragma("journal_mode = WAL");
db.exec(`
  CREATE TABLE IF NOT EXISTS diagrams (
    id          TEXT PRIMARY KEY,
    title       TEXT NOT NULL,
    graph_json  TEXT NOT NULL,
    view_mode   TEXT NOT NULL DEFAULT 'flowchart',
    created_at  TEXT NOT NULL,
    updated_at  TEXT NOT NULL
  );
`);

export interface DiagramRow {
  id: string;
  title: string;
  graph: ProcessGraph;
  viewMode: ViewMode;
  createdAt: string;
  updatedAt: string;
}

export interface DiagramSummary {
  id: string;
  title: string;
  createdAt: string;
  updatedAt: string;
}

function rowToDiagram(row: {
  id: string;
  title: string;
  graph_json: string;
  view_mode: string;
  created_at: string;
  updated_at: string;
}): DiagramRow {
  return {
    id: row.id,
    title: row.title,
    graph: JSON.parse(row.graph_json),
    viewMode: row.view_mode as ViewMode,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  };
}

function newId(): string {
  return "dg_" + Math.random().toString(36).slice(2, 10) + Date.now().toString(36);
}

export function listDiagrams(): DiagramSummary[] {
  const rows = db
    .prepare(
      "SELECT id, title, created_at, updated_at FROM diagrams ORDER BY updated_at DESC",
    )
    .all() as Array<{
    id: string;
    title: string;
    created_at: string;
    updated_at: string;
  }>;
  return rows.map((r) => ({
    id: r.id,
    title: r.title,
    createdAt: r.created_at,
    updatedAt: r.updated_at,
  }));
}

export function getDiagram(id: string): DiagramRow | null {
  const row = db.prepare("SELECT * FROM diagrams WHERE id = ?").get(id) as
    | Parameters<typeof rowToDiagram>[0]
    | undefined;
  return row ? rowToDiagram(row) : null;
}

export function createDiagram(
  graph: ProcessGraph,
  viewMode: ViewMode = "flowchart",
): DiagramRow {
  const id = newId();
  const now = new Date().toISOString();
  db.prepare(
    `INSERT INTO diagrams (id, title, graph_json, view_mode, created_at, updated_at)
     VALUES (?, ?, ?, ?, ?, ?)`,
  ).run(id, graph.title, JSON.stringify(graph), viewMode, now, now);
  return getDiagram(id)!;
}

export function updateDiagram(
  id: string,
  graph: ProcessGraph,
  viewMode: ViewMode,
): DiagramRow | null {
  const existing = getDiagram(id);
  if (!existing) return null;
  const now = new Date().toISOString();
  db.prepare(
    `UPDATE diagrams SET title = ?, graph_json = ?, view_mode = ?, updated_at = ? WHERE id = ?`,
  ).run(graph.title, JSON.stringify(graph), viewMode, now, id);
  return getDiagram(id);
}
