import type { InputTab } from "./InputPanel";
import Icon from "./Icon";

interface EmptyStateProps {
  demoMode: boolean;
  keyMissing: boolean;
  onStart: (tab: InputTab) => void;
  onOpenSample: () => void;
}

/** The canvas before there's a map: three ways in, plus a sample to explore. */
export default function EmptyState({ demoMode, keyMissing, onStart, onOpenSample }: EmptyStateProps) {
  if (demoMode) {
    return (
      <div className="pf-empty">
        <h1>Explore an example process map</h1>
        <p>Open an example from Maps. You can move steps and try edits; nothing here is saved.</p>
      </div>
    );
  }
  const ways: Array<{ tab: InputTab; icon: "text" | "upload" | "mic"; title: string; body: string }> = [
    { tab: "paste", icon: "text", title: "Paste walkthrough notes", body: "Meeting notes, a transcript or a procedure write-up." },
    { tab: "upload", icon: "upload", title: "Upload a document", body: "Word, PDF, text, or a photo of a whiteboard." },
    { tab: "live", icon: "mic", title: "Map a live walkthrough", body: "The map builds as the process owner talks you through it." },
  ];
  return (
    <div className="pf-empty">
      <EmptyArt />
      <h1>Start a process map</h1>
      <p>
        Give the assistant your walkthrough material. It draws the flow with lanes, decisions and controls, quotes
        the source for each step, and lists what still needs confirming.
      </p>
      <div className="pf-ways">
        {ways.map((w) => (
          <button key={w.tab} type="button" onClick={() => onStart(w.tab)}>
            <span className="pf-way-icon">
              <Icon name={w.icon} size={18} />
            </span>
            <strong>{w.title}</strong>
            <span>{w.body}</span>
          </button>
        ))}
      </div>
      <button type="button" className="pf-link pf-sample-link" onClick={onOpenSample}>
        Or open the sample purchase-to-pay map
      </button>
      {keyMissing && (
        <p className="pf-empty-note">
          To map your own material, add an AI key (GEMINI_API_KEY) to the server. The sample map works without one.
        </p>
      )}
    </div>
  );
}

/** A tiny process map: start, step, decision, control — in the map's own colours. */
function EmptyArt() {
  return (
    <svg className="pf-empty-art" width="236" height="64" viewBox="0 0 236 64" fill="none" aria-hidden="true">
      <rect x="1" y="21" width="40" height="22" rx="11" fill="#fff" stroke="#9CC5B0" strokeWidth="1.5" />
      <circle cx="14" cy="32" r="3" fill="#2F7D5B" />
      <path d="M41 32h18" stroke="#8E98A6" strokeWidth="1.5" />
      <rect x="60" y="17" width="54" height="30" rx="5" fill="#fff" stroke="#C9CFD8" strokeWidth="1.5" />
      <path d="M68 28h30M68 35h20" stroke="#C9CFD8" strokeWidth="2" strokeLinecap="round" />
      <path d="M114 32h16" stroke="#8E98A6" strokeWidth="1.5" />
      <rect x="138" y="20" width="17" height="17" rx="3" transform="rotate(45 146.5 28.5)" fill="#F4F0FA" stroke="#9B86C2" strokeWidth="1.5" />
      <path d="M159 32h16" stroke="#8E98A6" strokeWidth="1.5" />
      <rect x="176" y="13" width="58" height="38" rx="5" fill="#FBF3E6" stroke="#E2C48F" strokeWidth="1.5" />
      <path d="M185 22l3.5-1.4 3.5 1.4v3.4c0 2-1.4 3.4-3.5 4.4-2.1-1-3.5-2.4-3.5-4.4z" fill="#A8661B" />
      <path d="M197 25h28M185 37h34" stroke="#E2C48F" strokeWidth="2" strokeLinecap="round" />
    </svg>
  );
}
