// Thin wrapper over the browser Web Speech API (SpeechRecognition).
// Accumulates finalized transcript segments and reports them via callbacks.

type SpeechRecognitionCtor = new () => SpeechRecognitionLike;

interface SpeechRecognitionLike {
  continuous: boolean;
  interimResults: boolean;
  lang: string;
  onresult: ((event: SpeechRecognitionEventLike) => void) | null;
  onerror: ((event: { error: string }) => void) | null;
  onend: (() => void) | null;
  start(): void;
  stop(): void;
}

interface SpeechRecognitionEventLike {
  resultIndex: number;
  results: ArrayLike<{
    isFinal: boolean;
    0: { transcript: string };
  }>;
}

function getCtor(): SpeechRecognitionCtor | null {
  const w = window as unknown as {
    SpeechRecognition?: SpeechRecognitionCtor;
    webkitSpeechRecognition?: SpeechRecognitionCtor;
  };
  return w.SpeechRecognition ?? w.webkitSpeechRecognition ?? null;
}

export function isLiveSupported(): boolean {
  return getCtor() !== null;
}

export interface LiveTranscriber {
  start(): void;
  stop(): void;
}

/**
 * @param onFinalChunk  called with each newly finalized chunk of speech.
 * @param onInterim     called with the current (non-final) interim text.
 */
export function createTranscriber(
  onFinalChunk: (chunk: string) => void,
  onInterim: (interim: string) => void,
): LiveTranscriber | null {
  const Ctor = getCtor();
  if (!Ctor) return null;

  const rec = new Ctor();
  rec.continuous = true;
  rec.interimResults = true;
  rec.lang = "en-US";
  let running = false;

  rec.onresult = (event) => {
    let interim = "";
    for (let i = event.resultIndex; i < event.results.length; i++) {
      const result = event.results[i];
      const transcript = result[0].transcript;
      if (result.isFinal) {
        onFinalChunk(transcript.trim());
      } else {
        interim += transcript;
      }
    }
    onInterim(interim);
  };

  rec.onerror = (e) => {
    // "no-speech" / "aborted" are benign; surface others to console.
    if (e.error !== "no-speech" && e.error !== "aborted") {
      console.warn("[live] recognition error:", e.error);
    }
  };

  // Auto-restart while the user intends to keep listening (the API stops on
  // silence). running===false means the user pressed Stop.
  rec.onend = () => {
    if (running) {
      try {
        rec.start();
      } catch {
        /* already started */
      }
    }
  };

  return {
    start() {
      running = true;
      try {
        rec.start();
      } catch {
        /* already started */
      }
    },
    stop() {
      running = false;
      rec.stop();
    },
  };
}
