import { useRef, useState } from "react";
import { SAMPLE_WALKTHROUGH } from "../lib/sample";
import Icon from "./Icon";

export type InputTab = "paste" | "upload" | "live";

interface InputPanelProps {
  tab: InputTab;
  onTabChange: (tab: InputTab) => void;
  busy: boolean;
  blockedReason?: string;
  supportsImages: boolean;
  supportsPdf: boolean;
  onExtract: (opts: { text?: string; files?: File[] }) => void;
  // Live mode
  liveActive: boolean;
  liveSupported: boolean;
  liveTranscript: string;
  liveInterim: string;
  liveStatus: string | null;
  onToggleLive: () => void;
  onSubmitLive: () => void;
  hasGraph: boolean;
}

const TABS: Array<{ id: InputTab; label: string; icon: "text" | "upload" | "mic" }> = [
  { id: "paste", label: "Notes", icon: "text" },
  { id: "upload", label: "Document", icon: "upload" },
  { id: "live", label: "Live", icon: "mic" },
];

export default function InputPanel({
  tab,
  onTabChange,
  busy,
  blockedReason,
  supportsImages,
  supportsPdf,
  onExtract,
  liveActive,
  liveSupported,
  liveTranscript,
  liveInterim,
  liveStatus,
  onToggleLive,
  onSubmitLive,
  hasGraph,
}: InputPanelProps) {
  const [text, setText] = useState("");
  const [files, setFiles] = useState<File[]>([]);
  const fileRef = useRef<HTMLInputElement>(null);
  const incompatibleFiles = files.filter((file) => {
    const isPdf = file.type === "application/pdf" || file.name.toLowerCase().endsWith(".pdf");
    const isImage = file.type.startsWith("image/");
    return (isPdf && !supportsPdf) || (isImage && !supportsImages);
  });
  const action = hasGraph ? "Replace map" : "Map the process";

  return (
    <div className="pf-input">
      <div className="pf-segmented" role="tablist" aria-label="Source">
        {TABS.map((t) => (
          <button
            key={t.id}
            role="tab"
            aria-selected={tab === t.id}
            className={tab === t.id ? "active" : ""}
            onClick={() => onTabChange(t.id)}
          >
            <Icon name={t.icon} size={14} />
            {t.label}
          </button>
        ))}
      </div>

      {tab === "paste" && (
        <div className="pf-tabpane">
          <label className="pf-field-label" htmlFor="pf-notes">
            Walkthrough notes or transcript
          </label>
          <textarea
            id="pf-notes"
            placeholder="Paste meeting notes, a transcript, or a procedure description."
            value={text}
            onChange={(e) => setText(e.target.value)}
            rows={11}
          />
          <div className="pf-row-between">
            <button className="pf-link" type="button" onClick={() => setText(SAMPLE_WALKTHROUGH)} disabled={busy}>
              Fill in sample notes
            </button>
            <span className="pf-meta">{text.trim() ? `${text.trim().split(/\s+/).length} words` : ""}</span>
          </div>
          <button
            className="pf-primary pf-block"
            disabled={busy || Boolean(blockedReason) || !text.trim()}
            onClick={() => onExtract({ text })}
          >
            {busy ? "Mapping the process…" : action}
          </button>
        </div>
      )}

      {tab === "upload" && (
        <div className="pf-tabpane">
          <button
            type="button"
            className="pf-dropzone"
            onClick={() => fileRef.current?.click()}
            onDragOver={(e) => e.preventDefault()}
            onDrop={(e) => {
              e.preventDefault();
              setFiles(Array.from(e.dataTransfer.files ?? []));
            }}
          >
            <Icon name="upload" size={20} />
            <span>{files.length ? "Choose different files" : "Choose files or drop them here"}</span>
            <small>
              Word, text{supportsPdf ? ", PDF" : ""}
              {supportsImages ? " and images" : ""}
            </small>
          </button>
          <input
            ref={fileRef}
            type="file"
            multiple
            hidden
            accept=".pdf,.docx,.txt,.md,.csv,image/*"
            onChange={(e) => setFiles(Array.from(e.target.files ?? []))}
          />
          {files.length > 0 && (
            <ul className="pf-filelist">
              {files.map((f) => (
                <li key={f.name}>
                  <Icon name="file" size={14} />
                  {f.name}
                </li>
              ))}
            </ul>
          )}
          {incompatibleFiles.length > 0 && (
            <p className="pf-warn">
              The selected AI model can't read {incompatibleFiles.map((file) => file.name).join(", ")}.
              {!supportsPdf && " Choose a Gemini model for PDFs."}
            </p>
          )}
          <label className="pf-field-label" htmlFor="pf-context">
            Extra context (optional)
          </label>
          <textarea
            id="pf-context"
            placeholder="e.g. Focus on the approval steps."
            value={text}
            onChange={(e) => setText(e.target.value)}
            rows={3}
          />
          <button
            className="pf-primary pf-block"
            disabled={
              busy ||
              Boolean(blockedReason) ||
              incompatibleFiles.length > 0 ||
              (files.length === 0 && !text.trim())
            }
            onClick={() => onExtract({ text: text.trim() || undefined, files })}
          >
            {busy ? "Mapping the process…" : action}
          </button>
        </div>
      )}

      {tab === "live" && (
        <div className="pf-tabpane">
          {!liveSupported ? (
            <p className="pf-hint">
              Live mapping uses your browser's speech recognition, which works in Chrome and Edge. Open this page in
              one of those to use it.
            </p>
          ) : (
            <>
              <p className="pf-hint">
                Talk through the process and the map builds as you speak. You can also say things like "remove that
                approval step", "rename it to…" or "undo that".
              </p>
              <button
                className={`pf-block ${liveActive ? "pf-danger" : "pf-primary"}`}
                onClick={onToggleLive}
                disabled={Boolean(blockedReason)}
              >
                <span className={`pf-rec ${liveActive ? "on" : ""}`} aria-hidden="true" />
                {liveActive ? "Stop listening" : "Start listening"}
              </button>
              {liveStatus && <p className="pf-live-status" role="status">{liveStatus}</p>}
              <div className="pf-transcript" aria-live="polite">
                {liveTranscript || liveInterim ? (
                  <>
                    {liveTranscript}
                    {liveInterim && <span className="pf-muted"> {liveInterim}</span>}
                  </>
                ) : (
                  <span className="pf-muted">The transcript appears here as you speak.</span>
                )}
              </div>
              {liveTranscript.trim() && (
                <button
                  className="pf-secondary pf-block"
                  type="button"
                  onClick={onSubmitLive}
                  disabled={busy || liveActive || Boolean(blockedReason)}
                  title="Replace the map with a fresh one built from the whole transcript"
                >
                  {busy ? "Mapping the process…" : hasGraph ? "Rebuild map from full transcript" : "Map transcript"}
                </button>
              )}
            </>
          )}
        </div>
      )}

      {blockedReason && <p className="pf-warn">{blockedReason}</p>}
    </div>
  );
}
