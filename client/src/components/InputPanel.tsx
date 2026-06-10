import { useRef, useState } from "react";

export type InputTab = "paste" | "upload" | "live";

interface InputPanelProps {
  busy: boolean;
  blockedReason?: string;
  supportsImages: boolean;
  supportsPdf: boolean;
  onExtract: (opts: { text?: string; files?: File[] }) => void;
  // Live mode
  liveActive: boolean;
  liveSupported: boolean;
  liveTranscript: string;
  onToggleLive: () => void;
  onSubmitLive: () => void;
  hasGraph: boolean;
}

export default function InputPanel({
  busy,
  blockedReason,
  supportsImages,
  supportsPdf,
  onExtract,
  liveActive,
  liveSupported,
  liveTranscript,
  onToggleLive,
  onSubmitLive,
  hasGraph,
}: InputPanelProps) {
  const [tab, setTab] = useState<InputTab>("paste");
  const [text, setText] = useState("");
  const [files, setFiles] = useState<File[]>([]);
  const fileRef = useRef<HTMLInputElement>(null);
  const sample = `Purchase-to-Pay walkthrough.

A requester raises a purchase requisition in the ERP. The cost-centre manager reviews it against budget and approves or rejects it. This is a manual preventive control on every requisition to prevent unauthorised spend.

If approved, Procurement creates a purchase order. The ERP checks that the PO value does not exceed the approved requisition. After goods are received, Accounts Payable performs a three-way match between the PO, receipt, and invoice. If the match fails, the invoice is parked for investigation. If it passes, the invoice is posted and paid in the weekly payment run.`;
  const incompatibleFiles = files.filter((file) => {
    const isPdf = file.type === "application/pdf" || file.name.toLowerCase().endsWith(".pdf");
    const isImage = file.type.startsWith("image/");
    return (isPdf && !supportsPdf) || (isImage && !supportsImages);
  });

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
          <button
            className="pf-sample"
            type="button"
            onClick={() => setText(sample)}
            disabled={busy}
          >
            Use a sample walkthrough
          </button>
          <textarea
            placeholder="Paste a walkthrough transcript or process notes here…"
            value={text}
            onChange={(e) => setText(e.target.value)}
            rows={10}
          />
          <button
            className="pf-primary"
            disabled={busy || Boolean(blockedReason) || !text.trim()}
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
            Word and text files are supported.
            {supportsPdf ? " PDFs are supported." : " PDFs require a Claude model."}
            {supportsImages
              ? " Images are supported."
              : " Images require a vision-capable model."}
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
          {incompatibleFiles.length > 0 && (
            <p className="pf-key-warn">
              The selected model cannot read:{" "}
              {incompatibleFiles.map((file) => file.name).join(", ")}.
            </p>
          )}
          <button
            className="pf-primary"
            disabled={
              busy ||
              Boolean(blockedReason) ||
              incompatibleFiles.length > 0 ||
              (files.length === 0 && !text.trim())
            }
            onClick={() => onExtract({ text: text.trim() || undefined, files })}
          >
            {busy ? "Mapping…" : "Map the process"}
          </button>
        </div>
      )}

      {blockedReason && <p className="pf-key-warn">{blockedReason}</p>}

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
                {hasGraph
                  ? "Continue the walkthrough and the current map updates as you speak."
                  : "Record the walkthrough, then submit the transcript to create the map."}
              </p>
              <button
                className={liveActive ? "pf-danger" : "pf-primary"}
                onClick={onToggleLive}
                disabled={Boolean(blockedReason)}
              >
                {liveActive ? "■ Stop listening" : "● Start listening"}
              </button>
              <div className="pf-transcript">
                {liveTranscript || <span className="pf-muted">(transcript will appear here)</span>}
              </div>
              {!hasGraph && (
                <button
                  className="pf-primary pf-live-submit"
                  type="button"
                  onClick={onSubmitLive}
                  disabled={
                    busy ||
                    liveActive ||
                    Boolean(blockedReason) ||
                    !liveTranscript.trim()
                  }
                >
                  {busy ? "Mapping..." : "Map transcript"}
                </button>
              )}
            </>
          )}
        </div>
      )}
    </div>
  );
}
