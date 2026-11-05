import { useEffect, useRef, useState } from "react";
import type { ProcessGraph, ViewMode } from "../types";
import { exportRcmCsv, exportRcmXlsx } from "../lib/rcm";
import { exportNarrativeDocx } from "../lib/narrative";

interface ExportMenuProps {
  graph: ProcessGraph;
  viewMode: ViewMode;
  onError: (message: string) => void;
  onExportPng: () => Promise<void>;
  onExportJson: () => void;
}

/** Header "Export" dropdown: diagram image, audit documents, raw data. */
export default function ExportMenu({ graph, onError, onExportPng, onExportJson }: ExportMenuProps) {
  const [open, setOpen] = useState(false);
  const [working, setWorking] = useState<string | null>(null);
  const ref = useRef<HTMLDivElement | null>(null);

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

  const controls = graph.nodes.filter((n) => n.type === "control").length;

  async function run(label: string, fn: () => Promise<void> | void) {
    setOpen(false);
    setWorking(label);
    try {
      await fn();
    } catch (e) {
      onError(`Couldn't export ${label}: ${(e as Error).message}`);
    } finally {
      setWorking(null);
    }
  }

  const items: Array<{ label: string; hint: string; group: string; action: () => Promise<void> | void }> = [
    { group: "Diagram", label: "Image (PNG)", hint: "Whole map at full size", action: onExportPng },
    {
      group: "Audit documents",
      label: "Risk & Control Matrix (Excel)",
      hint: `${controls} control${controls === 1 ? "" : "s"} + numbered step list`,
      action: () => exportRcmXlsx(graph),
    },
    { group: "Audit documents", label: "Risk & Control Matrix (CSV)", hint: "For import into other tools", action: () => exportRcmCsv(graph) },
    { group: "Audit documents", label: "Process narrative (Word)", hint: "Numbered steps, decisions, key controls", action: () => exportNarrativeDocx(graph) },
    { group: "Data", label: "Map data (JSON)", hint: "Re-open later with Import", action: onExportJson },
  ];

  return (
    <div className="pf-menu" ref={ref}>
      <button
        type="button"
        aria-haspopup="menu"
        aria-expanded={open}
        onClick={() => setOpen((v) => !v)}
        disabled={working !== null}
      >
        {working ? "Exporting…" : "Export ▾"}
      </button>
      {open && (
        <div className="pf-menu-list" role="menu">
          {items.map((item, i) => (
            <div key={item.label}>
              {(i === 0 || items[i - 1].group !== item.group) && (
                <div className="pf-menu-group">{item.group}</div>
              )}
              <button type="button" role="menuitem" onClick={() => void run(item.label, item.action)}>
                <span>{item.label}</span>
                <small>{item.hint}</small>
              </button>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}
