import { useEffect, useRef, useState } from "react";
import {
  createTranscriber,
  type LiveTranscriber,
} from "../lib/liveTranscribe";

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
    <section className="pf-refine">
      <div className="pf-refine-head">
        <div>
          <h3>Update current map</h3>
          <p>Describe what to add, remove, rename, or correct.</p>
        </div>
        <span>AI edit</span>
      </div>
      <textarea
        rows={4}
        value={instruction}
        placeholder='e.g. "Add a Finance Director approval after the manager review and mark it as a preventive control."'
        onChange={(event) => setInstruction(event.target.value)}
        disabled={busy}
      />
      {interim && <p className="pf-refine-interim">{interim}</p>}
      <div className="pf-refine-actions">
        {voiceSupported && (
          <button
            className={listening ? "pf-voice active" : "pf-voice"}
            type="button"
            onClick={toggleListening}
            disabled={busy || Boolean(blockedReason)}
          >
            {listening ? "Stop voice" : "Use voice"}
          </button>
        )}
        <button
          className="pf-primary"
          type="button"
          onClick={applyUpdate}
          disabled={busy || Boolean(blockedReason) || !instruction.trim()}
        >
          {busy ? "Updating map..." : "Apply update"}
        </button>
      </div>
      {blockedReason && <p className="pf-key-warn">{blockedReason}</p>}
    </section>
  );
}
