import { useEffect, useRef, useState } from "react";
import type { DiagramSummary } from "../types";
import Icon from "./Icon";

interface FileMenuProps {
  diagrams: DiagramSummary[];
  currentId: string | null;
  hasGraph: boolean;
  demoMode: boolean;
  busy: boolean;
  onOpen: (id: string) => void;
  onNew: () => void;
  onImport: (file: File) => void;
  onDelete: (id: string) => void;
}

/** "Maps" menu: open a saved map, start a new one, import a file, delete. */
export default function FileMenu({
  diagrams,
  currentId,
  hasGraph,
  demoMode,
  busy,
  onOpen,
  onNew,
  onImport,
  onDelete,
}: FileMenuProps) {
  const [open, setOpen] = useState(false);
  const ref = useRef<HTMLDivElement | null>(null);
  const fileRef = useRef<HTMLInputElement | null>(null);

  useEffect(() => {
    if (!open) return;
    const close = (e: MouseEvent | KeyboardEvent) => {
      if (e instanceof KeyboardEvent ? e.key === "Escape" : !ref.current?.contains(e.target as Node)) {
        setOpen(false);
      }
    };
    window.addEventListener("mousedown", close);
    window.addEventListener("keydown", close);
    return () => {
      window.removeEventListener("mousedown", close);
      window.removeEventListener("keydown", close);
    };
  }, [open]);

  const run = (fn: () => void) => {
    setOpen(false);
    fn();
  };

  return (
    <div className="pf-filemenu" ref={ref}>
      <button
        type="button"
        className="pf-filemenu-button"
        aria-haspopup="menu"
        aria-expanded={open}
        onClick={() => setOpen((v) => !v)}
        title="Your maps"
      >
        <Icon name="folder" />
        <span className="pf-only-wide">Maps</span>
        <Icon name="chevron" size={12} />
      </button>
      {open && (
        <div className="pf-popover pf-filemenu-list" role="menu">
          <div className="pf-popover-section">
            <div className="pf-popover-title">{demoMode ? "Example maps" : "Saved maps"}</div>
            {diagrams.length === 0 ? (
              <p className="pf-popover-empty">No saved maps yet. Maps you save appear here.</p>
            ) : (
              <ul>
                {diagrams.map((d) => (
                  <li key={d.id}>
                    <button
                      type="button"
                      role="menuitem"
                      className={d.id === currentId ? "current" : ""}
                      disabled={busy}
                      onClick={() => run(() => onOpen(d.id))}
                    >
                      <span>{d.title}</span>
                      <small>{new Date(d.updatedAt).toLocaleDateString(undefined, { day: "numeric", month: "short" })}</small>
                    </button>
                  </li>
                ))}
              </ul>
            )}
          </div>
          {!demoMode && (
            <div className="pf-popover-section">
              <button type="button" role="menuitem" onClick={() => run(onNew)} disabled={busy || !hasGraph}>
                <Icon name="plus" /> New map
              </button>
              <button type="button" role="menuitem" onClick={() => fileRef.current?.click()} disabled={busy}>
                <Icon name="upload" /> Import from a JSON file
              </button>
              {currentId && (
                <button type="button" role="menuitem" className="danger" onClick={() => run(() => onDelete(currentId))} disabled={busy}>
                  <Icon name="trash" /> Delete this map
                </button>
              )}
            </div>
          )}
          <input
            ref={fileRef}
            type="file"
            accept="application/json,.json"
            hidden
            onChange={(e) => {
              const file = e.target.files?.[0];
              e.target.value = "";
              if (file) run(() => onImport(file));
            }}
          />
        </div>
      )}
    </div>
  );
}
