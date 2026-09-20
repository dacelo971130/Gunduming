/**
 * VOICE — speech recognition, defensively wrapped.
 *
 * Web Speech API has no official TS lib types worth trusting across browsers,
 * so we declare the minimal shape we actually use ourselves (no @types
 * package). Everything here must degrade instead of throw: no mic, no
 * permission, no browser support — the demo keeps running on keyboard input.
 */
import { SPEECH_LANG } from "@/lib/config";

/* ------------------------------------------------------- local Web Speech shims */

interface SpeechRecognitionAlternative {
  readonly transcript: string;
  readonly confidence: number;
}

interface SpeechRecognitionResultLike {
  readonly length: number;
  readonly isFinal: boolean;
  [index: number]: SpeechRecognitionAlternative;
}

interface SpeechRecognitionResultListLike {
  readonly length: number;
  [index: number]: SpeechRecognitionResultLike;
}

interface SpeechRecognitionEventLike extends Event {
  readonly resultIndex: number;
  readonly results: SpeechRecognitionResultListLike;
}

interface SpeechRecognitionErrorEventLike extends Event {
  readonly error: string;
  readonly message?: string;
}

interface SpeechRecognitionLike extends EventTarget {
  continuous: boolean;
  interimResults: boolean;
  lang: string;
  maxAlternatives: number;
  start(): void;
  stop(): void;
  abort(): void;
  onstart: ((this: SpeechRecognitionLike, ev: Event) => void) | null;
  onresult: ((this: SpeechRecognitionLike, ev: SpeechRecognitionEventLike) => void) | null;
  onerror: ((this: SpeechRecognitionLike, ev: SpeechRecognitionErrorEventLike) => void) | null;
  onend: ((this: SpeechRecognitionLike, ev: Event) => void) | null;
}

type SpeechRecognitionCtor = new () => SpeechRecognitionLike;

interface SpeechWindow extends Window {
  webkitSpeechRecognition?: SpeechRecognitionCtor;
  SpeechRecognition?: SpeechRecognitionCtor;
}

/* Errors that are noisy but harmless — swallowed entirely, never surfaced. */
const SILENT_ERRORS = new Set(["no-speech", "aborted"]);
/* Errors that mean the mic is fundamentally unavailable. */
const PERMISSION_ERRORS = new Set(["not-allowed", "service-not-allowed"]);

const MIN_BACKOFF_MS = 250;
const MAX_BACKOFF_MS = 4000;

export interface Recognizer {
  start(): void;
  stop(): void;
  mute(m: boolean): void;
  readonly supported: boolean;
}

export function createRecognizer(opts: {
  onInterim(t: string): void;
  onFinal(t: string): void;
  onError(e: string): void;
  onEnd(): void;
}): Recognizer {
  const Ctor =
    typeof window !== "undefined"
      ? (window as SpeechWindow).webkitSpeechRecognition ?? (window as SpeechWindow).SpeechRecognition
      : undefined;

  const supported = typeof Ctor === "function";

  if (!supported || !Ctor) {
    // Fully inert stub — callers can rely on start/stop/mute never throwing.
    return {
      supported: false,
      start() {},
      stop() {},
      mute() {},
    };
  }

  // Re-bind to a definitely-defined const so the type guard above survives
  // into the nested `build` closure (TS does not narrow across function
  // boundaries even for `const` captures).
  const RecognitionCtor: SpeechRecognitionCtor = Ctor;

  let recognition: SpeechRecognitionLike | null = null;
  let muted = false;
  let deliberatelyStopped = true; // not started yet
  let restartTimer: ReturnType<typeof setTimeout> | null = null;
  let backoffMs = MIN_BACKOFF_MS;

  function clearRestartTimer() {
    if (restartTimer) {
      clearTimeout(restartTimer);
      restartTimer = null;
    }
  }

  function scheduleRestart() {
    if (deliberatelyStopped || muted) return;
    clearRestartTimer();
    const delay = backoffMs;
    backoffMs = Math.min(MAX_BACKOFF_MS, Math.round(backoffMs * 1.6));
    restartTimer = setTimeout(() => {
      restartTimer = null;
      if (deliberatelyStopped || muted || !recognition) return;
      try {
        recognition.start();
      } catch {
        // Already started, or the browser is between stop/start — try again later.
        scheduleRestart();
      }
    }, delay);
  }

  function build(): SpeechRecognitionLike {
    const r = new RecognitionCtor();
    r.continuous = true;
    r.interimResults = true;
    r.lang = SPEECH_LANG;
    r.maxAlternatives = 1;

    r.onstart = () => {
      backoffMs = MIN_BACKOFF_MS;
    };

    r.onresult = (ev) => {
      if (muted) return;
      let interim = "";
      let final = "";
      for (let i = ev.resultIndex; i < ev.results.length; i++) {
        const result = ev.results[i];
        const alt = result[0];
        const text = alt ? alt.transcript : "";
        if (!text) continue;
        if (result.isFinal) final += text;
        else interim += text;
      }
      if (interim) opts.onInterim(interim);
      if (final) opts.onFinal(final);
    };

    r.onerror = (ev) => {
      const err = ev.error;
      if (SILENT_ERRORS.has(err)) return; // never surfaced
      opts.onError(err);
    };

    r.onend = () => {
      opts.onEnd();
      scheduleRestart();
    };

    return r;
  }

  recognition = build();

  return {
    supported: true,
    start() {
      if (!recognition) return;
      deliberatelyStopped = false;
      clearRestartTimer();
      backoffMs = MIN_BACKOFF_MS;
      try {
        recognition.start();
      } catch {
        // Already running — fine, ignore.
      }
    },
    stop() {
      deliberatelyStopped = true;
      clearRestartTimer();
      if (!recognition) return;
      try {
        recognition.stop();
      } catch {
        // Nothing to stop — fine.
      }
    },
    mute(m: boolean) {
      if (muted === m) return;
      muted = m;
      if (m) {
        clearRestartTimer();
        if (recognition) {
          try {
            recognition.stop();
          } catch {
            // ignore
          }
        }
      } else if (!deliberatelyStopped) {
        backoffMs = MIN_BACKOFF_MS;
        if (recognition) {
          try {
            recognition.start();
          } catch {
            // ignore — onend/backoff will retry if needed
          }
        }
      }
    },
  };
}
