import { useEffect, useRef, useState } from "react";
import {
  createTranscriber,
  type LiveTranscriber,
} from "../lib/liveTranscribe";
import Icon from "./Icon";

interface RefinePanelProps {
  busy: boolean;
  blockedReason?: string;
  voiceSupported: boolean;
  onRefine: (instruction: string) => Promise<boolean>;
}

export default function RefinePanel({
  busy,
  blockedReason,
  voiceSupported,
  onRefine,
}: RefinePanelProps) {
  const [instruction, setInstruction] = useState("");
  const [interim, setInterim] = useState("");
  const [listening, setListening] = useState(false);
  const transcriberRef = useRef<LiveTranscriber | null>(null);

  function toggleListening() {
    if (listening) {
      transcriberRef.current?.stop();
      setListening(false);
      setInterim("");
      return;
    }

    const transcriber = createTranscriber(
      (chunk) => {
        if (!chunk) return;
        setInstruction((current) => (current ? `${current} ${chunk}` : chunk));
      },
      setInterim,
    );
    if (!transcriber) return;
    transcriberRef.current = transcriber;
    transcriber.start();
    setListening(true);
  }

  async function applyUpdate() {
    const nextInstruction = instruction.trim();
    if (!nextInstruction) return;
    if (listening) toggleListening();
    if (await onRefine(nextInstruction)) {
      setInstruction("");
      setInterim("");
    }
  }

  useEffect(() => {
    return () => transcriberRef.current?.stop();
  }, []);

  return (
    <section className="pf-section pf-refine">
      <h3>Change the map with AI</h3>
      <p className="pf-hint">Describe a correction or new information. You can undo the result.</p>
      <textarea
        rows={4}
        value={instruction}
        aria-label="Describe the change"
        placeholder='e.g. "Add a Finance Director approval after the manager review, as a preventive control."'
        onChange={(event) => setInstruction(event.target.value)}
        disabled={busy}
      />
      {interim && <p className="pf-refine-interim">{interim}</p>}
      <div className="pf-button-row">
        {voiceSupported && (
          <button
            className={listening ? "pf-secondary active" : "pf-secondary"}
            type="button"
            onClick={toggleListening}
            disabled={busy || Boolean(blockedReason)}
          >
            <Icon name="mic" size={14} />
            {listening ? "Stop" : "Dictate"}
          </button>
        )}
        <button
          className="pf-primary pf-grow"
          type="button"
          onClick={applyUpdate}
          disabled={busy || Boolean(blockedReason) || !instruction.trim()}
        >
          {busy ? "Updating the map…" : "Update map"}
        </button>
      </div>
      {blockedReason && <p className="pf-warn">{blockedReason}</p>}
    </section>
  );
}
