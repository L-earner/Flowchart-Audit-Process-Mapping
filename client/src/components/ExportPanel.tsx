import { useState } from "react";
import type { ProcessGraph } from "../types";
import { exportRcmCsv, exportRcmXlsx } from "../lib/rcm";
import { exportNarrativeDocx } from "../lib/narrative";
import Icon from "./Icon";

interface ExportPanelProps {
  graph: ProcessGraph;
  demoMode: boolean;
  dirty: boolean;
  saved: boolean;
  busy: boolean;
  onSave: () => void;
  onError: (message: string) => void;
  onExportPng: () => Promise<void>;
  onExportJson: () => void;
}

/** Save the map, and download it as working-paper documents. */
export default function ExportPanel({
  graph,
  demoMode,
  dirty,
  saved,
  busy,
  onSave,
  onError,
  onExportPng,
  onExportJson,
}: ExportPanelProps) {
  const [working, setWorking] = useState<string | null>(null);
  const controls = graph.nodes.filter((n) => n.type === "control").length;
  const points = graph.openPoints?.length ?? 0;

  async function run(label: string, fn: () => Promise<void> | void) {
    setWorking(label);
    try {
      await fn();
    } catch (e) {
      onError(`Couldn't create the ${label}: ${(e as Error).message}`);
    } finally {
      setWorking(null);
    }
  }

  const items: Array<{ label: string; file: string; detail: string; action: () => Promise<void> | void }> = [
    {
      label: "Risk & Control Matrix",
      file: "Excel",
      detail: `${controls} control${controls === 1 ? "" : "s"}, a numbered step list${points ? ` and ${points} open point${points === 1 ? "" : "s"} with a response column` : ""}.`,
      action: () => exportRcmXlsx(graph),
    },
    {
      label: "Process narrative",
      file: "Word",
      detail: "Numbered steps in order, decisions with each branch, key controls and open points.",
      action: () => exportNarrativeDocx(graph),
    },
    { label: "Diagram", file: "PNG", detail: "The whole map at full size, in the current view.", action: onExportPng },
    { label: "Risk & Control Matrix", file: "CSV", detail: "Plain table for importing into other tools.", action: () => exportRcmCsv(graph) },
    { label: "Map file", file: "JSON", detail: "Re-open it later with Maps, then Import.", action: onExportJson },
  ];

  return (
    <>
      {!demoMode && (
        <section className="pf-section">
          <h3>Save</h3>
          <p className="pf-hint">
            {saved && !dirty ? "This map is saved to your maps." : "Save the map so you can reopen it from Maps."}
          </p>
          <button type="button" className={dirty || !saved ? "pf-primary pf-block" : "pf-secondary pf-block"} onClick={onSave} disabled={busy || (saved && !dirty)}>
            <Icon name={saved && !dirty ? "check" : "save"} size={14} />
            {saved && !dirty ? "Saved" : saved ? "Save changes" : "Save map"}
          </button>
        </section>
      )}
      <section className="pf-section">
        <h3>Download</h3>
        <ul className="pf-export-list">
          {items.map((item) => (
            <li key={item.label + item.file}>
              <button type="button" onClick={() => void run(`${item.label} (${item.file})`, item.action)} disabled={working !== null}>
                <span className="pf-export-file">{item.file}</span>
                <span className="pf-export-text">
                  <strong>{item.label}</strong>
                  <span>{item.detail}</span>
                </span>
                <span className="pf-export-go">
                  {working === `${item.label} (${item.file})` ? "Creating…" : <Icon name="download" size={16} />}
                </span>
              </button>
            </li>
          ))}
        </ul>
      </section>
    </>
  );
}
