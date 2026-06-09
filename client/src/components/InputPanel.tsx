import { useRef, useState } from "react";

export type InputTab = "paste" | "upload" | "live";

interface InputPanelProps {
  busy: boolean;
  onExtract: (opts: { text?: string; files?: File[] }) => void;
  // Live mode
  liveActive: boolean;
  liveSupported: boolean;
  liveTranscript: string;
  onToggleLive: () => void;
}

export default function InputPanel({
  busy,
  onExtract,
  liveActive,
  liveSupported,
  liveTranscript,
  onToggleLive,
}: InputPanelProps) {
  const [tab, setTab] = useState<InputTab>("paste");
  const [text, setText] = useState("");
  const [files, setFiles] = useState<File[]>([]);
  const fileRef = useRef<HTMLInputElement>(null);

  return (
    <div className="pf-input">
      <div className="pf-tabs">
        <button className={tab === "paste" ? "active" : ""} onClick={() => setTab("paste")}>
          📝 Paste
        </button>
        <button className={tab === "upload" ? "active" : ""} onClick={() => setTab("upload")}>
          📎 Upload
        </button>
        <button className={tab === "live" ? "active" : ""} onClick={() => setTab("live")}>
          🎤 Live
        </button>
      </div>

      {tab === "paste" && (
        <div className="pf-tabpane">
          <textarea
            placeholder="Paste a walkthrough transcript or process notes here…"
            value={text}
            onChange={(e) => setText(e.target.value)}
            rows={10}
          />
          <button
            className="pf-primary"
            disabled={busy || !text.trim()}
            onClick={() => onExtract({ text })}
          >
            {busy ? "Mapping…" : "Map the process"}
          </button>
        </div>
      )}

      {tab === "upload" && (
        <div className="pf-tabpane">
          <input
            ref={fileRef}
            type="file"
            multiple
            accept=".pdf,.docx,.txt,.md,.csv,image/*"
            onChange={(e) => setFiles(Array.from(e.target.files ?? []))}
          />
          <p className="pf-hint">
            PDF, Word (.docx), text, or images (screenshots / photos of whiteboards &
            existing diagrams). You can also add notes:
          </p>
          <textarea
            placeholder="Optional extra context…"
            value={text}
            onChange={(e) => setText(e.target.value)}
            rows={3}
          />
          {files.length > 0 && (
            <ul className="pf-filelist">
              {files.map((f) => (
                <li key={f.name}>{f.name}</li>
              ))}
            </ul>
          )}
          <button
            className="pf-primary"
            disabled={busy || (files.length === 0 && !text.trim())}
            onClick={() => onExtract({ text: text.trim() || undefined, files })}
          >
            {busy ? "Mapping…" : "Map the process"}
          </button>
        </div>
      )}

      {tab === "live" && (
        <div className="pf-tabpane">
          {!liveSupported ? (
            <p className="pf-hint">
              Live transcription uses the browser Speech Recognition API, which works in
              Chrome / Edge. It isn't available in this browser.
            </p>
          ) : (
            <>
              <p className="pf-hint">
                Start a stakeholder walkthrough — the diagram updates as you speak.
              </p>
              <button
                className={liveActive ? "pf-danger" : "pf-primary"}
                onClick={onToggleLive}
              >
                {liveActive ? "■ Stop listening" : "● Start listening"}
              </button>
              <div className="pf-transcript">
                {liveTranscript || <span className="pf-muted">(transcript will appear here)</span>}
              </div>
            </>
          )}
        </div>
      )}
    </div>
  );
}
