import {
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
} from "react";
import type {
  NodeType,
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
import { applyOps, summarizeOps } from "@shared/graphOps.ts";
import { exportJson, exportPng } from "./lib/exportImage";
import { assignControlIds } from "./lib/controlIds";
import { parseImportedDiagram } from "./lib/importJson";
import Stepper, { type StepId, type StepState } from "./components/Stepper";
import FileMenu from "./components/FileMenu";
import ReviewPanel from "./components/ReviewPanel";
import ExportPanel from "./components/ExportPanel";
import Inspector from "./components/Inspector";
import EmptyState from "./components/EmptyState";
import Icon from "./components/Icon";
import sampleMap from "../../scripts/fixtures/p2p-sample-graph.json";
import {
  createTranscriber,
  isLiveSupported,
  type LiveTranscriber,
} from "./lib/liveTranscribe";
import Canvas from "./components/Canvas";
import InputPanel, { type InputTab } from "./components/InputPanel";
import RefinePanel from "./components/RefinePanel";
import ActorPanel from "./components/ActorPanel";
import { assessGraph } from "./lib/graphQuality";
import { summarizeChange } from "./lib/graphDiff";
import "./styles.css";

function Logo() {
  // A start node, a step and a decision on one flow line: the product in miniature.
  return (
    <svg className="pf-logo" width="28" height="28" viewBox="0 0 28 28" aria-hidden="true">
      <rect width="28" height="28" rx="7" fill="#2B5F86" />
      <circle cx="7" cy="14" r="2.6" fill="#fff" />
      <path d="M9.6 14h2.6" stroke="#fff" strokeWidth="1.6" strokeLinecap="round" />
      <rect x="12.4" y="10.6" width="5.6" height="6.8" rx="1.4" fill="#fff" />
      <path d="M18 14h1.6" stroke="#fff" strokeWidth="1.6" strokeLinecap="round" />
      <rect x="20.2" y="11.6" width="4.8" height="4.8" rx="0.8" transform="rotate(45 22.6 14)" fill="none" stroke="#fff" strokeWidth="1.6" />
    </svg>
  );
}

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
  /** Bumped when a different map appears or the view changes: re-frames the canvas. */
  const [fitKey, setFitKey] = useState(0);
  const reframe = useCallback(() => setFitKey((k) => k + 1), []);
  const [focusRequest, setFocusRequest] = useState<{ nodeId: string; seq: number } | null>(null);
  const [addAfterRequest, setAddAfterRequest] = useState<{ type: NodeType; seq: number } | null>(null);
  /** Which workflow step's panel is showing. */
  const [step, setStep] = useState<StepId>("capture");
  const [inputTab, setInputTab] = useState<InputTab>("paste");

  // ----- live mode -----
  const liveSupported = isLiveSupported();
  const [liveActive, setLiveActive] = useState(false);
  const [liveTranscript, setLiveTranscript] = useState("");
  const [liveInterim, setLiveInterim] = useState("");
  const [liveStatus, setLiveStatus] = useState<string | null>(null);
  const transcriberRef = useRef<LiveTranscriber | null>(null);
  const pendingChunks = useRef<string[]>([]);
  const refineTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const liveSessionRef = useRef<string | null>(null);
  const inFlightRef = useRef(false);
  const liveFailuresRef = useRef(0);
  const liveActiveRef = useRef(false);
  liveActiveRef.current = liveActive;
  const graphRef = useRef<ProcessGraph | null>(null);
  graphRef.current = graph;
  const viewModeRef = useRef<ViewMode>(viewMode);
  viewModeRef.current = viewMode;
  const dirtyRef = useRef(dirty);
  dirtyRef.current = dirty;
  const modelRef = useRef<string>(model);
  modelRef.current = model;

  const demoMode = healthInfo?.demoMode ?? false;

  const refreshList = useCallback(() => {
    api.listDiagrams().then(setDiagrams).catch(() => {});
  }, []);
  useEffect(refreshList, [refreshList]);
  useEffect(() => {
    if (demoMode && !graph && !diagramId && diagrams.length > 0) {
      void handleLoad(diagrams[0].id);
    }
  }, [demoMode, diagrams, graph, diagramId]);
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
        : healthInfo.hasGeminiKey;
    };
    if (!isReady(model)) {
      const fallback = MODELS.find((candidate) => isReady(candidate.id));
      if (fallback) setModel(fallback.id);
    }
  }, [healthInfo, model]);
  useEffect(() => {
    if (!refineNote) return;
    const timer = setTimeout(() => setRefineNote(null), 8000);
    return () => clearTimeout(timer);
  }, [refineNote]);
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
    ((provider === "gemini" && !healthInfo.hasGeminiKey) ||
      (provider === "openrouter" && !healthInfo.hasOpenRouterKey));

  const update = useCallback((proposed: ProcessGraph) => {
    const current = graphRef.current;
    // Every edit path (canvas, inspector, AI update, live ops) funnels through
    // here, so this one call keeps control references stable everywhere.
    const next = assignControlIds(proposed, current);
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
  const handleUndoRef = useRef(handleUndo);
  handleUndoRef.current = handleUndo;

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

  // Escape closes the inspector (unless you're typing in a field).
  useEffect(() => {
    const onKey = (event: KeyboardEvent) => {
      if (event.key !== "Escape") return;
      const el = event.target as HTMLElement | null;
      if (el && (el.tagName === "INPUT" || el.tagName === "TEXTAREA" || el.tagName === "SELECT")) return;
      setSelectedId(null);
      setSelectedEdgeId(null);
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, []);

  async function handleExtract(opts: { text?: string; files?: File[] }) {
    setBusy(true);
    setError(null);
    try {
      const g = await api.extract({ ...opts, model });
      setGraph(assignControlIds(g));
      setUndoStack([]);
      setRedoStack([]);
      setRefineNote(null);
      setDiagramId(null);
      setDirty(true);
      setSelectedId(null);
      setSelectedEdgeId(null);
      reframe();
      // Next thing to do with a fresh map: check it.
      setStep("review");
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

  // ----- live: incremental ops over a server session -----
  // Single-flight: at most one /api/live/chunk request at a time; speech that
  // arrives while a request is in flight buffers and goes out next. The
  // session holds the model's conversation context server-side; the client
  // graph rides along on every request as the source of truth.
  const endLiveSession = useCallback(() => {
    const sessionId = liveSessionRef.current;
    liveSessionRef.current = null;
    if (sessionId) void api.liveEnd(sessionId);
  }, []);

  const sendPendingRef = useRef<() => Promise<void>>(async () => {});
  const sendPending = useCallback(async () => {
    if (inFlightRef.current) return;
    const sessionId = liveSessionRef.current;
    if (!sessionId) return;
    const chunk = pendingChunks.current.join(" ").trim();
    if (!chunk) {
      if (!liveActiveRef.current) endLiveSession();
      return;
    }
    pendingChunks.current = [];
    inFlightRef.current = true;
    setLiveStatus("Updating the map…");
    try {
      let result: api.LiveChunkResult;
      try {
        result = await api.liveChunk(sessionId, chunk, graphRef.current, modelRef.current);
      } catch (e) {
        if (!(e instanceof api.SessionExpiredError)) throw e;
        // Server forgot us (restart / TTL). The client graph is authoritative,
        // so we can transparently re-seed a fresh session and retry once.
        const fresh = await api.liveStart(graphRef.current);
        liveSessionRef.current = fresh.sessionId;
        result = await api.liveChunk(fresh.sessionId, chunk, graphRef.current, modelRef.current);
      }
      liveFailuresRef.current = 0;
      if (result.ops.some((op) => op.op === "undo_last")) {
        handleUndoRef.current();
        setLiveStatus("Undid the last change");
      } else if (result.ops.length > 0) {
        // Apply ops to the *current* graph (not the server snapshot) so manual
        // edits made while the request was in flight survive; ops that now
        // target a deleted element are skipped harmlessly.
        const base = graphRef.current;
        const next = base ? applyOps(base, result.ops).graph : result.graph;
        update(next);
        setLiveStatus(result.note ?? summarizeOps(result.ops));
      } else {
        setLiveStatus(result.note ?? "Listening…");
      }
    } catch (e) {
      liveFailuresRef.current += 1;
      // Put the words back so they aren't lost — but give up after two
      // consecutive failures rather than retrying forever.
      if (liveFailuresRef.current < 2) pendingChunks.current.unshift(chunk);
      setError((e as Error).message);
      setLiveStatus(null);
    } finally {
      inFlightRef.current = false;
      const hasMore = pendingChunks.current.length > 0;
      if (hasMore && liveSessionRef.current) {
        setTimeout(() => void sendPendingRef.current(), 300);
      } else if (!liveActiveRef.current) {
        endLiveSession();
      }
    }
  }, [update, endLiveSession]);
  sendPendingRef.current = sendPending;

  const scheduleSend = useCallback(() => {
    if (refineTimer.current) clearTimeout(refineTimer.current);
    // Long monologues shouldn't wait for a pause; flush once enough buffered.
    if (pendingChunks.current.join(" ").length > 400) {
      void sendPending();
      return;
    }
    refineTimer.current = setTimeout(() => void sendPending(), 2500);
  }, [sendPending]);

  async function toggleLive() {
    if (liveActive) {
      transcriberRef.current?.stop();
      setLiveActive(false);
      liveActiveRef.current = false;
      setLiveInterim("");
      setLiveStatus(null);
      if (refineTimer.current) {
        clearTimeout(refineTimer.current);
        refineTimer.current = null;
      }
      // Flush whatever is buffered; sendPending ends the session once idle.
      void sendPending();
      return;
    }
    setError(null);
    let sessionId: string;
    try {
      ({ sessionId } = await api.liveStart(graphRef.current));
    } catch (e) {
      setError((e as Error).message);
      return;
    }
    const t = createTranscriber(
      (chunk) => {
        if (!chunk) return;
        setLiveTranscript((prev) => (prev ? prev + " " + chunk : chunk));
        pendingChunks.current.push(chunk);
        scheduleSend();
      },
      setLiveInterim,
    );
    if (!t) {
      void api.liveEnd(sessionId);
      return;
    }
    liveSessionRef.current = sessionId;
    liveFailuresRef.current = 0;
    transcriberRef.current = t;
    t.start();
    setLiveActive(true);
    setLiveStatus("Listening…");
  }

  function submitLiveTranscript() {
    const transcript = liveTranscript.trim();
    if (!transcript || busy) return;
    transcriberRef.current?.stop();
    setLiveActive(false);
    liveActiveRef.current = false;
    setLiveInterim("");
    setLiveStatus(null);
    if (refineTimer.current) {
      clearTimeout(refineTimer.current);
      refineTimer.current = null;
    }
    pendingChunks.current = [];
    endLiveSession();
    void handleExtract({ text: transcript });
  }

  useEffect(() => {
    return () => {
      transcriberRef.current?.stop();
      if (refineTimer.current) clearTimeout(refineTimer.current);
      endLiveSession();
    };
  }, [endLiveSession]);

  // ----- view toggle (re-layout) -----
  function changeView(mode: ViewMode) {
    if (graph && mode !== viewMode) update(edit.clearPositions(graph));
    setViewMode(mode);
    reframe();
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
      setGraph(assignControlIds(d.graph));
      setUndoStack([]);
      setRedoStack([]);
      setRefineNote(null);
      setViewMode(d.viewMode);
      setDiagramId(d.id);
      setDirty(false);
      setSelectedId(null);
      setSelectedEdgeId(null);
      reframe();
      setStep((current) => (current === "capture" ? "review" : current));
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setBusy(false);
    }
  }

  async function handleImportFile(file: File) {
    if (dirty && !window.confirm("Discard unsaved changes and open the imported map?")) {
      return;
    }
    setError(null);
    try {
      const imported = parseImportedDiagram(await file.text());
      setGraph(assignControlIds(imported.graph));
      setViewMode(imported.viewMode ?? viewMode);
      setUndoStack([]);
      setRedoStack([]);
      setRefineNote(null);
      setDiagramId(null);
      setDirty(true);
      setSelectedId(null);
      setSelectedEdgeId(null);
      reframe();
      setStep("review");
    } catch (e) {
      setError((e as Error).message);
    }
  }

  /** Open the bundled sample map locally: no AI call, works without a key. */
  function handleOpenSample() {
    if (dirty && !window.confirm("Discard unsaved changes and open the sample map?")) return;
    const sample = sampleMap as unknown as { graph: ProcessGraph; viewMode: ViewMode };
    setGraph(assignControlIds(structuredClone(sample.graph)));
    setViewMode(sample.viewMode);
    setUndoStack([]);
    setRedoStack([]);
    setRefineNote(null);
    setDiagramId(null);
    setDirty(true);
    setSelectedId(null);
    setSelectedEdgeId(null);
    reframe();
    setStep("review");
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
    setStep("capture");
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

  const keyName = provider === "openrouter" ? "OPENROUTER_API_KEY" : "GEMINI_API_KEY";
  const blockedReason = keyMissing
    ? `The server has no ${keyName}, so the AI can't run yet. Add it as a secret and restart the server.`
    : undefined;
  const openPointCount = graph?.openPoints?.length ?? 0;
  const reviewAttention = Boolean(graph && (openPointCount > 0 || (quality?.warnings.length ?? 0) > 0));

  const steps: StepState[] = [
    {
      id: "capture",
      label: "Capture",
      status: graph ? "Source mapped" : "Add material",
      done: Boolean(graph),
    },
    {
      id: "map",
      label: "Map",
      status: graph ? `${graph.nodes.length} steps, ${graph.actors.length} lanes` : undefined,
      done: Boolean(graph),
      disabled: !graph,
    },
    {
      id: "review",
      label: "Review",
      status: graph
        ? openPointCount > 0
          ? `${openPointCount} to confirm`
          : (quality?.warnings.length ?? 0) > 0
            ? `${quality!.warnings.length} to fix`
            : "Checks pass"
        : undefined,
      done: Boolean(graph) && !reviewAttention,
      attention: reviewAttention,
      disabled: !graph,
    },
    {
      id: "export",
      label: "Export",
      status: graph ? (dirty ? "Not saved" : diagramId ? "Saved" : undefined) : undefined,
      done: Boolean(graph && diagramId && !dirty),
      disabled: !graph,
    },
  ];
  const activeStep: StepId = graph ? step : "capture";
  const nextStep: Record<StepId, { id: StepId; label: string } | null> = {
    capture: graph ? { id: "map", label: "Next: arrange the map" } : null,
    map: { id: "review", label: "Next: review the map" },
    review: { id: "export", label: "Next: save and export" },
    export: null,
  };
  const next = graph ? nextStep[activeStep] : null;

  const showStep = (nodeId: string) => {
    setSelectedId(nodeId);
    setSelectedEdgeId(null);
    setFocusRequest((r) => ({ nodeId, seq: (r?.seq ?? 0) + 1 }));
  };

  return (
    <div className="pf-app">
      <header className="pf-topbar">
        <div className="pf-topbar-left">
          <Logo />
          {!graph && <span className="pf-wordmark">Process Mapper</span>}
          {demoMode && (
            <span className="pf-badge" title="Read-only example. Edits aren't saved and reset on reload.">
              Demo
            </span>
          )}
          <span className="pf-topbar-divider" aria-hidden="true" />
          <FileMenu
            diagrams={diagrams}
            currentId={diagramId}
            hasGraph={Boolean(graph)}
            demoMode={demoMode}
            busy={busy}
            onOpen={(id) => void handleLoad(id)}
            onNew={handleNew}
            onImport={(file) => void handleImportFile(file)}
            onDelete={(id) => void handleDeleteDiagram(id)}
          />
          {graph && (
            <input
              className="pf-title-input"
              aria-label="Map title"
              value={graph.title}
              onChange={(e) => update(edit.setTitle(graph, e.target.value))}
            />
          )}
        </div>

        <Stepper steps={steps} active={activeStep} onSelect={setStep} />

        <div className="pf-topbar-right">
          {graph && (
            <>
              <button
                type="button"
                className="pf-icon-button"
                onClick={handleUndo}
                disabled={busy || undoStack.length === 0}
                title="Undo (Ctrl/Cmd+Z)"
                aria-label="Undo"
              >
                <Icon name="undo" />
              </button>
              <button
                type="button"
                className="pf-icon-button"
                onClick={handleRedo}
                disabled={busy || redoStack.length === 0}
                title="Redo (Ctrl/Cmd+Shift+Z)"
                aria-label="Redo"
              >
                <Icon name="redo" />
              </button>
              {!demoMode && (
                <button
                  type="button"
                  className={`pf-save ${dirty || !diagramId ? "unsaved" : ""}`}
                  onClick={handleSave}
                  disabled={busy || (!dirty && Boolean(diagramId))}
                  title={dirty || !diagramId ? "Save to your maps" : "All changes saved"}
                >
                  {dirty || !diagramId ? (
                    <>
                      <span className="pf-save-dot" aria-hidden="true" /> Save
                    </>
                  ) : (
                    <>
                      <Icon name="check" size={14} /> Saved
                    </>
                  )}
                </button>
              )}
            </>
          )}
        </div>
      </header>

      <div className="pf-toasts" aria-live="polite">
        {error && (
          <div className="pf-toast danger" role="alert">
            <Icon name="alert" />
            <div>{error}</div>
            <button className="pf-icon-button" aria-label="Dismiss" onClick={() => setError(null)}>
              <Icon name="close" size={14} />
            </button>
          </div>
        )}
        {refineNote && (
          <div className="pf-toast" role="status">
            <Icon name="check" />
            <div>{refineNote}</div>
            <button className="pf-icon-button" aria-label="Dismiss" onClick={() => setRefineNote(null)}>
              <Icon name="close" size={14} />
            </button>
          </div>
        )}
      </div>

      <div className="pf-workspace">
        <aside className="pf-panel" aria-label={`${steps.find((s) => s.id === activeStep)!.label} panel`}>
          <div className="pf-panel-scroll">
            {activeStep === "capture" && (
              <>
                <div className="pf-panel-intro">
                  <h2>{graph ? "Add or replace material" : "Capture the walkthrough"}</h2>
                  <p>
                    {graph
                      ? "Correct the current map with AI, or build a fresh map from new material."
                      : "Choose how you'll give the assistant the process. It drafts a map you can then edit."}
                  </p>
                </div>
                {demoMode ? (
                  <p className="pf-hint pf-section">
                    This public demo is read-only. Explore and edit the map on the canvas; changes aren't saved and
                    reset when you reload.
                  </p>
                ) : (
                  <>
                    {graph && (
                      <RefinePanel
                        busy={busy}
                        blockedReason={blockedReason}
                        voiceSupported={liveSupported}
                        onRefine={handleRefine}
                      />
                    )}
                    <section className="pf-section">
                      {graph && <h3>Build a new map</h3>}
                      <InputPanel
                        tab={inputTab}
                        onTabChange={setInputTab}
                        busy={busy}
                        supportsImages={Boolean(selectedModel?.vision)}
                        supportsPdf={provider === "gemini"}
                        blockedReason={blockedReason}
                        onExtract={handleExtract}
                        liveActive={liveActive}
                        liveSupported={liveSupported}
                        liveTranscript={liveTranscript}
                        liveInterim={liveInterim}
                        liveStatus={liveStatus}
                        onToggleLive={() => void toggleLive()}
                        onSubmitLive={submitLiveTranscript}
                        hasGraph={Boolean(graph)}
                      />
                    </section>
                    <section className="pf-section pf-model">
                      <label className="pf-field-label" htmlFor="pf-model-select">
                        AI model
                      </label>
                      <select id="pf-model-select" value={model} onChange={(e) => setModel(e.target.value)}>
                        <optgroup label="Google Gemini">
                          {MODELS.filter((m) => m.provider === "gemini").map((m) => (
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
                      {!keyMissing && <p className="pf-hint">{selectedModel?.note ?? "Model via OpenRouter."}</p>}
                    </section>
                  </>
                )}
              </>
            )}

            {activeStep === "map" && graph && (
              <>
                <div className="pf-panel-intro">
                  <h2>Arrange the map</h2>
                  <p>Rename and reorder lanes here. Edit steps directly on the canvas: select one to change it.</p>
                </div>
                <ActorPanel
                  graph={graph}
                  onRename={(actorId, name) => update(edit.updateActor(graph, actorId, { name }))}
                  onMove={(actorId, dir) => update(edit.clearPositions(edit.moveActor(graph, actorId, dir)))}
                  onDelete={(actorId) => update(edit.clearPositions(edit.deleteActor(graph, actorId)))}
                  onAdd={() => {
                    const { graph: g } = edit.addActor(graph);
                    update(edit.clearPositions(g));
                  }}
                />
                <section className="pf-section">
                  <h3>Add a step</h3>
                  <p className="pf-hint">Adds to {selectedNode ? "the selected step's lane" : "the first lane"}. Connect it by dragging from one step's edge to another.</p>
                  <div className="pf-chip-row">
                    {(["process", "decision", "control", "system"] as const).map((t) => (
                      <button
                        key={t}
                        type="button"
                        className="pf-chip"
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
                        <span className={`pf-kind-dot ${t}`} aria-hidden="true" />
                        {t === "process" ? "Step" : t === "system" ? "Automated step" : t[0].toUpperCase() + t.slice(1)}
                      </button>
                    ))}
                  </div>
                </section>
                <section className="pf-section">
                  <h3>On the canvas</h3>
                  <ul className="pf-tips">
                    <li>Double-click a label to rename a step.</li>
                    <li>In swimlanes, drag a step into another lane to change who does it.</li>
                    <li>Select a step or connection and press Delete to remove it.</li>
                  </ul>
                </section>
              </>
            )}

            {activeStep === "review" && graph && quality && (
              <>
                <div className="pf-panel-intro">
                  <h2>Review the map</h2>
                  <p>Check the structure, then confirm the open points with the process owner.</p>
                </div>
                <ReviewPanel
                  graph={graph}
                  quality={quality}
                  selectedNodeId={selectedId}
                  onShowStep={showStep}
                  onResolve={(pointId) => update(edit.resolveOpenPoint(graph, pointId))}
                />
              </>
            )}

            {activeStep === "export" && graph && (
              <>
                <div className="pf-panel-intro">
                  <h2>Save and export</h2>
                  <p>Download the map as working-paper documents.</p>
                </div>
                <ExportPanel
                  graph={graph}
                  demoMode={demoMode}
                  dirty={dirty}
                  saved={Boolean(diagramId)}
                  busy={busy}
                  onSave={() => void handleSave()}
                  onError={setError}
                  onExportPng={() => exportPng(graph, viewMode)}
                  onExportJson={() => exportJson(graph)}
                />
              </>
            )}
          </div>
          {next && (
            <footer className="pf-panel-footer">
              <button type="button" className="pf-secondary pf-block" onClick={() => setStep(next.id)}>
                {next.label}
              </button>
            </footer>
          )}
        </aside>

        <main className="pf-stage">
          {graph ? (
            <Canvas
              graph={graph}
              viewMode={viewMode}
              fitKey={fitKey}
              focusRequest={focusRequest}
              onChangeView={changeView}
              addAfterRequest={addAfterRequest}
              selectedNodeId={selectedId}
              onSelectNode={setSelectedId}
              onSelectEdge={setSelectedEdgeId}
              onNodePositions={(pos) => update(edit.applyPositions(graph, pos))}
              onConnect={(s, t) => update(edit.addEdge(graph, s, t))}
              onReconnectEdge={(edgeId, s, t) => {
                if (graph.edges.some((e) => e.id !== edgeId && e.source === s && e.target === t)) {
                  return; // would duplicate an existing connection
                }
                update(edit.updateEdge(graph, edgeId, { source: s, target: t }));
              }}
              onRenameNode={(nodeId, label) => update(edit.updateNode(graph, nodeId, { label }))}
              onReassignActor={(nodeId, actorId) =>
                update(edit.updateNode(graph, nodeId, { actorId, position: undefined }))
              }
              onAddNode={(type, actorId, position, connectFrom) => {
                const { graph: withNode, nodeId } = edit.addNode(graph, type, actorId, position);
                const nextGraph = connectFrom ? edit.addEdge(withNode, connectFrom, nodeId) : withNode;
                update(nextGraph);
                setSelectedId(nodeId);
                setSelectedEdgeId(null);
              }}
              onDeleteElements={(nodeIds, edgeIds) => {
                if (nodeIds.length === 0 && edgeIds.length === 0) return;
                let nextGraph = graph;
                for (const id of nodeIds) nextGraph = edit.deleteNode(nextGraph, id);
                for (const id of edgeIds) nextGraph = edit.deleteEdge(nextGraph, id);
                update(nextGraph);
                setSelectedId(null);
                setSelectedEdgeId(null);
              }}
            />
          ) : busy ? (
            <div className="pf-skeleton" role="status" aria-live="polite">
              <div className="pf-skeleton-flow" aria-hidden="true">
                <div className="pf-skeleton-node" />
                <div className="pf-skeleton-link" />
                <div className="pf-skeleton-node wide" />
                <div className="pf-skeleton-link" />
                <div className="pf-skeleton-node" />
              </div>
              <p className="pf-skeleton-label">Mapping the process</p>
              <p className="pf-skeleton-sub">Reading the material, finding the lanes, steps and controls.</p>
            </div>
          ) : (
            <EmptyState
              demoMode={demoMode}
              keyMissing={keyMissing}
              onStart={(tab) => {
                setInputTab(tab);
                setStep("capture");
                window.setTimeout(() => {
                  document.querySelector<HTMLElement>(
                    tab === "paste" ? "#pf-notes" : tab === "upload" ? ".pf-dropzone" : ".pf-tabpane .pf-block",
                  )?.focus();
                }, 50);
              }}
              onOpenSample={handleOpenSample}
            />
          )}
          {busy && graph && <div className="pf-progress" aria-hidden="true" />}
        </main>

        {graph && (
          <Inspector
            graph={graph}
            node={selectedNode}
            edge={selectedEdge}
            onClose={() => {
              setSelectedId(null);
              setSelectedEdgeId(null);
            }}
            onPatchNode={(patch) => selectedNode && update(edit.updateNode(graph, selectedNode.id, patch))}
            onPatchControl={(patch) => selectedNode && update(edit.updateControl(graph, selectedNode.id, patch))}
            onDeleteNode={() => {
              if (!selectedNode) return;
              update(edit.deleteNode(graph, selectedNode.id));
              setSelectedId(null);
            }}
            onAddAfter={(type) => setAddAfterRequest((r) => ({ type, seq: (r?.seq ?? 0) + 1 }))}
            onPatchEdge={(patch) => {
              if (!selectedEdge) return;
              const nextSource = patch.source ?? selectedEdge.source;
              const nextTarget = patch.target ?? selectedEdge.target;
              if (patch.source || patch.target) {
                if (nextSource === nextTarget) {
                  setError("A connection can't start and end on the same step.");
                  return;
                }
                if (
                  graph.edges.some(
                    (e) => e.id !== selectedEdge.id && e.source === nextSource && e.target === nextTarget,
                  )
                ) {
                  setError("That connection already exists.");
                  return;
                }
              }
              update(edit.updateEdge(graph, selectedEdge.id, patch));
            }}
            onDeleteEdge={() => {
              if (!selectedEdge) return;
              update(edit.deleteEdge(graph, selectedEdge.id));
              setSelectedEdgeId(null);
            }}
          />
        )}
      </div>
    </div>
  );
}
