import { useCallback, useEffect, useRef, useState } from "react";
import type { ProcessGraph, ProcessNode, ViewMode, DiagramSummary } from "./types";
import * as api from "./lib/api";
import * as edit from "./lib/graphEdit";
import { exportJson, exportPng } from "./lib/exportImage";
import {
  createTranscriber,
  isLiveSupported,
  type LiveTranscriber,
} from "./lib/liveTranscribe";
import Canvas from "./components/Canvas";
import InputPanel from "./components/InputPanel";
import NodeInspector from "./components/NodeInspector";
import "./styles.css";

export default function App() {
  const [graph, setGraph] = useState<ProcessGraph | null>(null);
  const [viewMode, setViewMode] = useState<ViewMode>("flowchart");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [diagramId, setDiagramId] = useState<string | null>(null);
  const [diagrams, setDiagrams] = useState<DiagramSummary[]>([]);
  const [dirty, setDirty] = useState(false);

  // ----- live mode -----
  const liveSupported = isLiveSupported();
  const [liveActive, setLiveActive] = useState(false);
  const [liveTranscript, setLiveTranscript] = useState("");
  const transcriberRef = useRef<LiveTranscriber | null>(null);
  const pendingChunks = useRef<string[]>([]);
  const refineTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const graphRef = useRef<ProcessGraph | null>(null);
  graphRef.current = graph;

  const refreshList = useCallback(() => {
    api.listDiagrams().then(setDiagrams).catch(() => {});
  }, []);
  useEffect(refreshList, [refreshList]);

  function update(next: ProcessGraph) {
    setGraph(next);
    setDirty(true);
  }

  async function handleExtract(opts: { text?: string; files?: File[] }) {
    setBusy(true);
    setError(null);
    try {
      const g = await api.extract(opts);
      setGraph(g);
      setDiagramId(null);
      setDirty(true);
      setSelectedId(null);
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setBusy(false);
    }
  }

  // ----- live: debounced refine -----
  const scheduleRefine = useCallback(() => {
    if (refineTimer.current) clearTimeout(refineTimer.current);
    refineTimer.current = setTimeout(async () => {
      const chunk = pendingChunks.current.join(" ").trim();
      if (!chunk) return;
      pendingChunks.current = [];
      try {
        const updated = await api.refine(graphRef.current, chunk);
        setGraph(updated);
        setDirty(true);
      } catch (e) {
        setError((e as Error).message);
      }
    }, 2500);
  }, []);

  function toggleLive() {
    if (liveActive) {
      transcriberRef.current?.stop();
      setLiveActive(false);
      return;
    }
    const t = createTranscriber(
      (chunk) => {
        if (!chunk) return;
        setLiveTranscript((prev) => (prev ? prev + " " + chunk : chunk));
        pendingChunks.current.push(chunk);
        scheduleRefine();
      },
      () => {},
    );
    if (!t) return;
    transcriberRef.current = t;
    t.start();
    setLiveActive(true);
  }

  useEffect(() => {
    return () => transcriberRef.current?.stop();
  }, []);

  // ----- view toggle (re-layout) -----
  function changeView(mode: ViewMode) {
    if (graph) setGraph(edit.clearPositions(graph));
    setViewMode(mode);
  }

  // ----- persistence -----
  async function handleSave() {
    if (!graph) return;
    setBusy(true);
    setError(null);
    try {
      if (diagramId) {
        await api.saveDiagram(diagramId, graph, viewMode);
      } else {
        const { id } = await api.createDiagram(graph, viewMode);
        setDiagramId(id);
      }
      setDirty(false);
      refreshList();
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setBusy(false);
    }
  }

  async function handleLoad(id: string) {
    setBusy(true);
    setError(null);
    try {
      const d = await api.loadDiagram(id);
      setGraph(d.graph);
      setViewMode(d.viewMode);
      setDiagramId(d.id);
      setDirty(false);
      setSelectedId(null);
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setBusy(false);
    }
  }

  function handleNew() {
    setGraph(null);
    setDiagramId(null);
    setSelectedId(null);
    setDirty(false);
  }

  const selectedNode: ProcessNode | null =
    (graph && selectedId && graph.nodes.find((n) => n.id === selectedId)) || null;

  return (
    <div className="pf-app">
      <header className="pf-header">
        <div className="pf-brand">🔎 Audit Process-Flow Mapper</div>
        {graph && (
          <input
            className="pf-title-input"
            value={graph.title}
            onChange={(e) => update(edit.setTitle(graph, e.target.value))}
          />
        )}
        <div className="pf-header-actions">
          {graph && (
            <>
              <div className="pf-toggle">
                <button
                  className={viewMode === "flowchart" ? "active" : ""}
                  onClick={() => changeView("flowchart")}
                >
                  Flowchart
                </button>
                <button
                  className={viewMode === "swimlane" ? "active" : ""}
                  onClick={() => changeView("swimlane")}
                >
                  Swimlane
                </button>
              </div>
              <button onClick={handleSave} disabled={busy}>
                {diagramId ? (dirty ? "Save*" : "Saved") : "Save"}
              </button>
              <button onClick={() => exportPng(graph).catch((e) => setError(e.message))}>
                PNG
              </button>
              <button onClick={() => exportJson(graph)}>JSON</button>
              <button onClick={handleNew}>New</button>
            </>
          )}
        </div>
      </header>

      {error && (
        <div className="pf-error" onClick={() => setError(null)}>
          {error} <span className="pf-muted">(click to dismiss)</span>
        </div>
      )}

      <div className="pf-body">
        <aside className="pf-sidebar">
          <InputPanel
            busy={busy}
            onExtract={handleExtract}
            liveActive={liveActive}
            liveSupported={liveSupported}
            liveTranscript={liveTranscript}
            onToggleLive={toggleLive}
          />
          <div className="pf-saved">
            <h4>Saved diagrams</h4>
            {diagrams.length === 0 && <p className="pf-muted">None yet.</p>}
            <ul>
              {diagrams.map((d) => (
                <li key={d.id}>
                  <button
                    className={d.id === diagramId ? "active" : ""}
                    onClick={() => handleLoad(d.id)}
                  >
                    {d.title}
                  </button>
                </li>
              ))}
            </ul>
          </div>
        </aside>

        <main className="pf-main">
          {graph ? (
            <Canvas
              graph={graph}
              viewMode={viewMode}
              onSelectNode={setSelectedId}
              onNodePositions={(pos) => update(edit.applyPositions(graph, pos))}
              onConnect={(s, t) => update(edit.addEdge(graph, s, t))}
            />
          ) : (
            <div className="pf-empty">
              <p>
                Paste a walkthrough transcript, upload a document or image, or start a
                live conversation — and the process flow appears here.
              </p>
            </div>
          )}
        </main>

        {graph && (
          <aside className="pf-rightbar">
            <div className="pf-add">
              <h4>Add step</h4>
              <div className="pf-add-buttons">
                {(["process", "decision", "control", "system"] as const).map((t) => (
                  <button
                    key={t}
                    onClick={() => {
                      const { graph: g, nodeId } = edit.addNode(
                        graph,
                        t,
                        selectedNode?.actorId ?? graph.actors[0]?.id ?? null,
                      );
                      update(g);
                      setSelectedId(nodeId);
                    }}
                  >
                    + {t}
                  </button>
                ))}
              </div>
              <p className="pf-hint">
                Drag from a node's handle to another to connect steps.
              </p>
            </div>
            {selectedNode && (
              <NodeInspector
                graph={graph}
                node={selectedNode}
                onPatch={(patch) => update(edit.updateNode(graph, selectedNode.id, patch))}
                onPatchControl={(patch) =>
                  update(edit.updateControl(graph, selectedNode.id, patch))
                }
                onDelete={() => {
                  update(edit.deleteNode(graph, selectedNode.id));
                  setSelectedId(null);
                }}
              />
            )}
          </aside>
        )}
      </div>
    </div>
  );
}
