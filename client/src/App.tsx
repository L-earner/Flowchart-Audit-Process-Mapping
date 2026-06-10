import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import type {
  ProcessEdge,
  ProcessGraph,
  ProcessNode,
  ViewMode,
  DiagramSummary,
} from "./types";
import {
  MODELS,
  DEFAULT_MODEL_ID,
  modelInfo,
  providerFor,
} from "@shared/models.ts";
import type { Health } from "./lib/api";
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
import EdgeInspector from "./components/EdgeInspector";
import RefinePanel from "./components/RefinePanel";
import ActorPanel from "./components/ActorPanel";
import { assessGraph } from "./lib/graphQuality";
import { summarizeChange } from "./lib/graphDiff";
import "./styles.css";

interface UndoEntry {
  graph: ProcessGraph;
  viewMode: ViewMode;
  dirty: boolean;
}

const MAX_UNDO_ENTRIES = 50;

export default function App() {
  const [graph, setGraph] = useState<ProcessGraph | null>(null);
  const [viewMode, setViewMode] = useState<ViewMode>("flowchart");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [selectedEdgeId, setSelectedEdgeId] = useState<string | null>(null);
  const [diagramId, setDiagramId] = useState<string | null>(null);
  const [diagrams, setDiagrams] = useState<DiagramSummary[]>([]);
  const [dirty, setDirty] = useState(false);
  const [undoStack, setUndoStack] = useState<UndoEntry[]>([]);
  const [redoStack, setRedoStack] = useState<UndoEntry[]>([]);
  const [refineNote, setRefineNote] = useState<string | null>(null);
  const [model, setModel] = useState<string>(() => {
    const stored = window.localStorage.getItem("pf-model");
    return stored && modelInfo(stored) ? stored : DEFAULT_MODEL_ID;
  });
  const [healthInfo, setHealthInfo] = useState<Health | null>(null);

  // ----- live mode -----
  const liveSupported = isLiveSupported();
  const [liveActive, setLiveActive] = useState(false);
  const [liveTranscript, setLiveTranscript] = useState("");
  const transcriberRef = useRef<LiveTranscriber | null>(null);
  const pendingChunks = useRef<string[]>([]);
  const refineTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const graphRef = useRef<ProcessGraph | null>(null);
  graphRef.current = graph;
  const viewModeRef = useRef<ViewMode>(viewMode);
  viewModeRef.current = viewMode;
  const dirtyRef = useRef(dirty);
  dirtyRef.current = dirty;
  const modelRef = useRef<string>(model);
  modelRef.current = model;

  const refreshList = useCallback(() => {
    api.listDiagrams().then(setDiagrams).catch(() => {});
  }, []);
  useEffect(refreshList, [refreshList]);
  useEffect(() => {
    api.health().then(setHealthInfo).catch(() => {});
  }, []);
  useEffect(() => {
    window.localStorage.setItem("pf-model", model);
  }, [model]);
  useEffect(() => {
    if (!healthInfo) return;
    const isReady = (candidate: string) => {
      const candidateProvider = providerFor(candidate);
      return candidateProvider === "openrouter"
        ? healthInfo.hasOpenRouterKey
        : healthInfo.hasAnthropicKey;
    };
    if (!isReady(model)) {
      const fallback = MODELS.find((candidate) => isReady(candidate.id));
      if (fallback) setModel(fallback.id);
    }
  }, [healthInfo, model]);
  useEffect(() => {
    const warn = (event: BeforeUnloadEvent) => {
      if (!dirty) return;
      event.preventDefault();
      event.returnValue = "";
    };
    window.addEventListener("beforeunload", warn);
    return () => window.removeEventListener("beforeunload", warn);
  }, [dirty]);

  const provider = providerFor(model);
  const selectedModel = modelInfo(model);
  const keyMissing =
    healthInfo != null &&
    ((provider === "anthropic" && !healthInfo.hasAnthropicKey) ||
      (provider === "openrouter" && !healthInfo.hasOpenRouterKey));

  const update = useCallback((next: ProcessGraph) => {
    const current = graphRef.current;
    if (current && current !== next) {
      setUndoStack((entries) => [
        ...entries.slice(-(MAX_UNDO_ENTRIES - 1)),
        {
          graph: current,
          viewMode: viewModeRef.current,
          dirty: dirtyRef.current,
        },
      ]);
      setRedoStack([]); // a fresh edit invalidates the redo branch
    }
    setGraph(next);
    setDirty(true);
  }, []);

  const handleUndo = useCallback(() => {
    if (busy) return;
    const previous = undoStack.at(-1);
    if (!previous) return;
    const current = graphRef.current;
    if (current) {
      setRedoStack((entries) => [
        ...entries.slice(-(MAX_UNDO_ENTRIES - 1)),
        {
          graph: current,
          viewMode: viewModeRef.current,
          dirty: dirtyRef.current,
        },
      ]);
    }
    setGraph(previous.graph);
    setViewMode(previous.viewMode);
    setDirty(previous.dirty);
    setSelectedId(null);
    setSelectedEdgeId(null);
    setUndoStack((entries) => entries.slice(0, -1));
  }, [busy, undoStack]);

  const handleRedo = useCallback(() => {
    if (busy) return;
    const nextState = redoStack.at(-1);
    if (!nextState) return;
    const current = graphRef.current;
    if (current) {
      setUndoStack((entries) => [
        ...entries.slice(-(MAX_UNDO_ENTRIES - 1)),
        {
          graph: current,
          viewMode: viewModeRef.current,
          dirty: dirtyRef.current,
        },
      ]);
    }
    setGraph(nextState.graph);
    setViewMode(nextState.viewMode);
    setDirty(nextState.dirty);
    setSelectedId(null);
    setSelectedEdgeId(null);
    setRedoStack((entries) => entries.slice(0, -1));
  }, [busy, redoStack]);

  useEffect(() => {
    const handleKeyDown = (event: KeyboardEvent) => {
      if (busy || !(event.ctrlKey || event.metaKey)) return;
      const key = event.key.toLowerCase();
      const isRedo =
        (key === "z" && event.shiftKey) || (key === "y" && !event.shiftKey);
      if (isRedo && redoStack.length > 0) {
        event.preventDefault();
        handleRedo();
      } else if (key === "z" && !event.shiftKey && undoStack.length > 0) {
        event.preventDefault();
        handleUndo();
      }
    };
    window.addEventListener("keydown", handleKeyDown);
    return () => window.removeEventListener("keydown", handleKeyDown);
  }, [busy, handleUndo, handleRedo, undoStack.length, redoStack.length]);

  async function handleExtract(opts: { text?: string; files?: File[] }) {
    setBusy(true);
    setError(null);
    try {
      const g = await api.extract({ ...opts, model });
      setGraph(g);
      setUndoStack([]);
      setRedoStack([]);
      setRefineNote(null);
      setDiagramId(null);
      setDirty(true);
      setSelectedId(null);
      setSelectedEdgeId(null);
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setBusy(false);
    }
  }

  async function handleRefine(instruction: string): Promise<boolean> {
    if (!graph) return false;
    setBusy(true);
    setError(null);
    try {
      const updated = await api.refine(graph, instruction, model);
      const summary = summarizeChange(graph, updated);
      update(updated);
      setRefineNote(`AI update: ${summary} — Undo (Ctrl/Cmd+Z) to revert.`);
      setSelectedId(null);
      setSelectedEdgeId(null);
      return true;
    } catch (e) {
      setError((e as Error).message);
      return false;
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
      if (!graphRef.current) return;
      try {
        const updated = await api.refine(graphRef.current, chunk, modelRef.current);
        update(updated);
      } catch (e) {
        setError((e as Error).message);
      }
    }, 2500);
  }, [update]);

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

  function submitLiveTranscript() {
    const transcript = liveTranscript.trim();
    if (!transcript || busy) return;
    transcriberRef.current?.stop();
    setLiveActive(false);
    if (refineTimer.current) {
      clearTimeout(refineTimer.current);
      refineTimer.current = null;
    }
    pendingChunks.current = [];
    void handleExtract({ text: transcript });
  }

  useEffect(() => {
    return () => {
      transcriberRef.current?.stop();
      if (refineTimer.current) clearTimeout(refineTimer.current);
    };
  }, []);

  // ----- view toggle (re-layout) -----
  function changeView(mode: ViewMode) {
    if (graph && mode !== viewMode) update(edit.clearPositions(graph));
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
      setUndoStack((entries) =>
        entries.map((entry) => ({ ...entry, dirty: true })),
      );
      setDirty(false);
      refreshList();
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setBusy(false);
    }
  }

  async function handleLoad(id: string) {
    if (id === diagramId) return;
    if (dirty && !window.confirm("Discard unsaved changes and open another diagram?")) {
      return;
    }
    setBusy(true);
    setError(null);
    try {
      const d = await api.loadDiagram(id);
      setGraph(d.graph);
      setUndoStack([]);
      setRedoStack([]);
      setRefineNote(null);
      setViewMode(d.viewMode);
      setDiagramId(d.id);
      setDirty(false);
      setSelectedId(null);
      setSelectedEdgeId(null);
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setBusy(false);
    }
  }

  function handleNew() {
    if (dirty && !window.confirm("Discard unsaved changes and start a new diagram?")) {
      return;
    }
    setGraph(null);
    setUndoStack([]);
    setRedoStack([]);
    setRefineNote(null);
    setDiagramId(null);
    setSelectedId(null);
    setSelectedEdgeId(null);
    setDirty(false);
  }

  async function handleDeleteDiagram(id: string) {
    const diagram = diagrams.find((item) => item.id === id);
    if (!window.confirm(`Delete "${diagram?.title ?? "this diagram"}"? This cannot be undone.`)) {
      return;
    }
    setBusy(true);
    setError(null);
    try {
      await api.deleteDiagram(id);
      if (id === diagramId) {
        setGraph(null);
        setUndoStack([]);
        setRedoStack([]);
        setRefineNote(null);
        setDiagramId(null);
        setSelectedId(null);
        setSelectedEdgeId(null);
        setDirty(false);
      }
      refreshList();
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setBusy(false);
    }
  }

  const selectedNode: ProcessNode | null =
    (graph && selectedId && graph.nodes.find((n) => n.id === selectedId)) || null;
  const selectedEdge: ProcessEdge | null =
    (graph &&
      selectedEdgeId &&
      graph.edges.find((edge) => edge.id === selectedEdgeId)) ||
    null;
  const quality = useMemo(() => (graph ? assessGraph(graph) : null), [graph]);

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
              <button
                onClick={handleUndo}
                disabled={busy || undoStack.length === 0}
                title="Undo last change (Ctrl/Cmd+Z)"
              >
                Undo
              </button>
              <button
                onClick={handleRedo}
                disabled={busy || redoStack.length === 0}
                title="Redo (Ctrl/Cmd+Shift+Z)"
              >
                Redo
              </button>
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

      {refineNote && (
        <div className="pf-refine-note" onClick={() => setRefineNote(null)}>
          {refineNote} <span className="pf-muted">(click to dismiss)</span>
        </div>
      )}

      <div className="pf-body">
        <aside className="pf-sidebar">
          <div className="pf-model">
            <label htmlFor="pf-model-select">Model</label>
            <select
              id="pf-model-select"
              value={model}
              onChange={(e) => setModel(e.target.value)}
            >
              <optgroup label="Anthropic (Claude)">
                {MODELS.filter((m) => m.provider === "anthropic").map((m) => (
                  <option key={m.id} value={m.id}>
                    {m.label}
                  </option>
                ))}
              </optgroup>
              <optgroup label="OpenRouter">
                {MODELS.filter((m) => m.provider === "openrouter").map((m) => (
                  <option key={m.id} value={m.id}>
                    {m.label}
                  </option>
                ))}
              </optgroup>
            </select>
            {keyMissing ? (
              <p className="pf-key-warn">
                ⚠ No {provider === "openrouter" ? "OPENROUTER_API_KEY" : "ANTHROPIC_API_KEY"}{" "}
                set — add it as a secret to use this model.
              </p>
            ) : (
              <p className="pf-hint">
                {selectedModel?.note ??
                  (provider === "openrouter"
                    ? "Model via OpenRouter."
                    : "Claude with schema-enforced extraction.")}
              </p>
            )}
          </div>
          <InputPanel
            busy={busy}
            supportsImages={Boolean(selectedModel?.vision)}
            supportsPdf={provider === "anthropic"}
            blockedReason={
              keyMissing
                ? `Add ${provider === "openrouter" ? "OPENROUTER_API_KEY" : "ANTHROPIC_API_KEY"} to use this model.`
                : undefined
            }
            onExtract={handleExtract}
            liveActive={liveActive}
            liveSupported={liveSupported}
            liveTranscript={liveTranscript}
            onToggleLive={toggleLive}
            onSubmitLive={submitLiveTranscript}
            hasGraph={Boolean(graph)}
          />
          {graph && (
            <RefinePanel
              busy={busy}
              blockedReason={
                keyMissing
                  ? `Add ${provider === "openrouter" ? "OPENROUTER_API_KEY" : "ANTHROPIC_API_KEY"} to update this map.`
                  : undefined
              }
              voiceSupported={liveSupported}
              onRefine={handleRefine}
            />
          )}
          <div className="pf-saved">
            <h4>Saved diagrams</h4>
            {diagrams.length === 0 && <p className="pf-muted">None yet.</p>}
            <ul>
              {diagrams.map((d) => (
                <li key={d.id}>
                  <button
                    className={d.id === diagramId ? "active" : ""}
                    onClick={() => handleLoad(d.id)}
                    disabled={busy}
                  >
                    {d.title}
                  </button>
                </li>
              ))}
            </ul>
            {diagramId && (
              <button
                className="pf-delete-selected"
                onClick={() => handleDeleteDiagram(diagramId)}
                disabled={busy}
              >
                Delete selected diagram
              </button>
            )}
          </div>
        </aside>

        <main className="pf-main">
          {graph ? (
            <Canvas
              graph={graph}
              viewMode={viewMode}
              selectedNodeId={selectedId}
              onSelectNode={setSelectedId}
              onSelectEdge={setSelectedEdgeId}
              onNodePositions={(pos) => update(edit.applyPositions(graph, pos))}
              onConnect={(s, t) => update(edit.addEdge(graph, s, t))}
              onReconnectEdge={(edgeId, s, t) => {
                if (
                  graph.edges.some(
                    (e) => e.id !== edgeId && e.source === s && e.target === t,
                  )
                ) {
                  return; // would duplicate an existing connection
                }
                update(edit.updateEdge(graph, edgeId, { source: s, target: t }));
              }}
              onRenameNode={(nodeId, label) =>
                update(edit.updateNode(graph, nodeId, { label }))
              }
              onReassignActor={(nodeId, actorId) =>
                update(
                  edit.updateNode(graph, nodeId, { actorId, position: undefined }),
                )
              }
              onAddNode={(type, actorId, position, connectFrom) => {
                const { graph: withNode, nodeId } = edit.addNode(
                  graph,
                  type,
                  actorId,
                  position,
                );
                const next = connectFrom
                  ? edit.addEdge(withNode, connectFrom, nodeId)
                  : withNode;
                update(next);
                setSelectedId(nodeId);
                setSelectedEdgeId(null);
              }}
              onDeleteElements={(nodeIds, edgeIds) => {
                if (nodeIds.length === 0 && edgeIds.length === 0) return;
                let next = graph;
                for (const id of nodeIds) next = edit.deleteNode(next, id);
                for (const id of edgeIds) next = edit.deleteEdge(next, id);
                update(next);
                setSelectedId(null);
                setSelectedEdgeId(null);
              }}
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
            {quality && (
              <section className="pf-quality">
                <div className="pf-quality-head">
                  <h3>Map quality</h3>
                  <strong>{quality.score}%</strong>
                </div>
                <div className="pf-quality-grid">
                  {quality.checks.map((check) => (
                    <div className={`pf-quality-stat ${check.status}`} key={check.label}>
                      <span>{check.value}</span>
                      {check.label}
                    </div>
                  ))}
                </div>
                {quality.warnings.length > 0 ? (
                  <ul className="pf-quality-warnings">
                    {quality.warnings.map((warning) => (
                      <li key={warning}>{warning}</li>
                    ))}
                  </ul>
                ) : (
                  <p className="pf-quality-good">Core mapping checks passed.</p>
                )}
              </section>
            )}
            <ActorPanel
              graph={graph}
              onRename={(actorId, name) =>
                update(edit.updateActor(graph, actorId, { name }))
              }
              onMove={(actorId, dir) =>
                update(edit.clearPositions(edit.moveActor(graph, actorId, dir)))
              }
              onDelete={(actorId) =>
                update(edit.clearPositions(edit.deleteActor(graph, actorId)))
              }
              onAdd={() => {
                const { graph: g } = edit.addActor(graph);
                update(edit.clearPositions(g));
              }}
            />
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
                      setSelectedEdgeId(null);
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
            {selectedEdge && (
              <EdgeInspector
                graph={graph}
                edge={selectedEdge}
                onPatch={(patch) => {
                  const nextSource = patch.source ?? selectedEdge.source;
                  const nextTarget = patch.target ?? selectedEdge.target;
                  if (patch.source || patch.target) {
                    if (nextSource === nextTarget) {
                      setError("A connection can't start and end on the same step.");
                      return;
                    }
                    if (
                      graph.edges.some(
                        (e) =>
                          e.id !== selectedEdge.id &&
                          e.source === nextSource &&
                          e.target === nextTarget,
                      )
                    ) {
                      setError("That connection already exists.");
                      return;
                    }
                  }
                  update(edit.updateEdge(graph, selectedEdge.id, patch));
                }}
                onDelete={() => {
                  update(edit.deleteEdge(graph, selectedEdge.id));
                  setSelectedEdgeId(null);
                }}
              />
            )}
          </aside>
        )}
      </div>
    </div>
  );
}
