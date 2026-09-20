"use client";

/**
 * VOICE — the loop. Mounted once at app root as an invisible component.
 * Wires: mic -> recognizer -> pipeline (wake/reflex/neural) -> store/bus,
 * and bus "ai:say" -> TTS queue, with an echo guard around every spoken
 * line so ECHO-01's own voice can never re-trigger itself through the mic.
 * Also mounts the global keyboard fallback so the demo survives a dead mic.
 */
import { useEffect, useRef } from "react";
import { game } from "@/game/store";
import { bus } from "@/lib/bus";
import { createRecognizer, type Recognizer } from "./stt";
import { attachKeyboardFallback, isTypingTarget } from "./keyboard";
import { speak, cancelSpeech } from "./tts";
import {
  beginEchoGuard,
  endEchoGuard,
  isMicOpen,
  isPttHeld,
  isPttMode,
  onMuteChange,
  processHeardText,
  runManualCommand,
  setPttHeld,
  toggleManualMute,
  togglePttMode,
} from "./pipeline";
import type { Phase } from "@/game/types";

/**
 * Push-to-talk keys: hold `M` (primary) or `Shift` (secondary) to open the
 * mic; release to close it and submit whatever was heard. `Ctrl+V` toggles
 * between push-to-talk (the default — the venue is loud) and always-on
 * listening. `M` used to be the mute toggle; that moved to `N` (see
 * keyboard.ts) so it doesn't collide with the hold-to-talk key.
 */
function isPttKey(key: string): boolean {
  return key === "m" || key === "M" || key === "Shift";
}

/** Rehearsal hotkeys 1-7 jump straight to a phase so the pilot can practise any beat. */
const REHEARSAL_PHASES: Record<number, Phase | undefined> = {
  1: "STANDBY",
  2: "BOOT",
  3: "COCKPIT_BOOT",
  4: "BRIEFING",
  5: "COMBAT",
  6: "BOSS_INTRO",
  7: "VICTORY",
};

const POST_SPEECH_RECHECK_MS = 400;

export function VoiceLink() {
  const recognizerRef = useRef<Recognizer | null>(null);
  /** Latest interim transcript while push-to-talk is held, submitted as the
   *  final transcript on key-up (Web Speech doesn't always finalize before
   *  the pilot lets go of the key). */
  const lastInterimRef = useRef("");

  useEffect(() => {
    function refreshVoiceLinkStatus(): void {
      const s = game.get();
      const rec = recognizerRef.current;
      if (!rec || !rec.supported) {
        s.setVoiceLink("ERROR");
        return;
      }
      if (!isMicOpen()) {
        s.setVoiceLink("MUTED");
        return;
      }
      s.setVoiceLink(s.phase === "STANDBY" ? "STANDBY" : "LISTENING");
    }

    const offMute = onMuteChange(() => {
      recognizerRef.current?.mute(!isMicOpen());
      refreshVoiceLinkStatus();
    });

    const offPhase = bus.on("phase:changed", () => refreshVoiceLinkStatus());

    // Echo guard: mute the mic for every line ECHO-01 speaks, plus a tail.
    const offAiSay = bus.on("ai:say", ({ text, priority }) => {
      void (async () => {
        beginEchoGuard(text);
        recognizerRef.current?.mute(true);
        try {
          await speak(text, priority === "urgent");
        } finally {
          endEchoGuard();
          setTimeout(() => {
            recognizerRef.current?.mute(!isMicOpen());
            refreshVoiceLinkStatus();
          }, POST_SPEECH_RECHECK_MS);
        }
      })();
    });

    /** Release push-to-talk: close the mic and submit whatever was heard as
     *  a final transcript. Safe to call even when PTT isn't currently held. */
    function releasePtt(): void {
      if (!isPttHeld()) return;
      const heard = lastInterimRef.current.trim();
      lastInterimRef.current = "";
      game.get().setTranscript("");
      setPttHeld(false);
      if (heard) processHeardText(heard);
    }

    function handlePttKeyDown(e: KeyboardEvent): void {
      if (isTypingTarget(e.target)) return;
      if (e.ctrlKey && (e.key === "v" || e.key === "V")) {
        e.preventDefault();
        const enabled = togglePttMode();
        game
          .get()
          .pushLog(
            "INFO",
            enabled
              ? "Push-to-talk ENABLED — hold M (or Shift) to talk."
              : "Push-to-talk DISABLED — always-on listening.",
          );
        return;
      }
      if (e.metaKey || e.ctrlKey || e.altKey) return;
      if (!isPttMode() || !isPttKey(e.key)) return;
      if (e.repeat || isPttHeld()) return;
      lastInterimRef.current = "";
      game.get().setTranscript("");
      setPttHeld(true);
      // Hold must work even if the recognizer had stopped or errored out —
      // force a restart attempt on every press rather than trusting whatever
      // state it was left in.
      recognizerRef.current?.start();
    }

    function handlePttKeyUp(e: KeyboardEvent): void {
      if (!isPttKey(e.key)) return;
      releasePtt();
    }

    function handleMicSafety(): void {
      // Never leave the mic stuck open if key-up is missed (alt-tab, window
      // blur, tab hidden mid-hold, etc).
      releasePtt();
    }

    window.addEventListener("keydown", handlePttKeyDown);
    window.addEventListener("keyup", handlePttKeyUp);
    window.addEventListener("blur", handleMicSafety);
    document.addEventListener("visibilitychange", handleMicSafety);

    /** Error codes already surfaced this session, so each is logged only once. */
    const reported = new Set<string>();

    const recognizer = createRecognizer({
      onInterim: (text) => {
        // While push-to-talk is the active mode and not held, ambient noise
        // is ignored entirely — never even touch the transcript HUD.
        if (isPttMode() && !isPttHeld()) return;
        lastInterimRef.current = text;
        game.get().setTranscript(text);
        bus.emit("voice:transcript", { text, final: false });
      },
      onFinal: (text, confidence) => {
        if (isPttMode() && !isPttHeld()) return;
        lastInterimRef.current = "";
        bus.emit("voice:transcript", { text, final: true });
        game.get().setTranscript("");
        processHeardText(text, { confidence });
      },
      onError: (err) => {
        // A denied microphone stays denied for the session, and the recognizer
        // keeps retrying — without this guard the comms log floods with the
        // same warning and the pilot loses the feed mid-demo.
        if (reported.has(err)) return;
        reported.add(err);
        if (err === "not-allowed" || err === "service-not-allowed") {
          game.get().setVoiceLink("ERROR");
          game
            .get()
            .pushLog("WARN", "Microphone permission denied — voice link offline, keyboard control is active.");
          recognizer.stop();
          return;
        }
        // Anything else (network hiccup, audio-capture, etc.) — log it once but
        // keep trying; the recognizer auto-restarts on its own.
        game.get().pushLog("WARN", `Voice link error: ${err}`);
      },
      onEnd: () => {
        refreshVoiceLinkStatus();
      },
    });
    recognizerRef.current = recognizer;

    if (!recognizer.supported) {
      game.get().setVoiceLink("ERROR");
      game
        .get()
        .pushLog("WARN", "Speech recognition unsupported in this browser — keyboard control is active.");
    } else {
      recognizer.mute(!isMicOpen());
      recognizer.start();
      refreshVoiceLinkStatus();
    }

    const detachKeyboard = attachKeyboardFallback({
      onCommand: (cmd) => runManualCommand(cmd),
      onFocusCommandBox: () => {
        document.getElementById("voice-command-box")?.focus();
      },
      onToggleMute: () => {
        toggleManualMute();
      },
      onSkipTo: (n) => {
        const phase = REHEARSAL_PHASES[n];
        if (!phase) return;
        import("@/game/director")
          .then((mod) => mod.skipTo(phase))
          .catch(() => {
            game.get().pushLog("WARN", `Rehearsal jump to ${phase} unavailable.`);
          });
      },
      onReset: () => {
        game.get().reset();
      },
    });

    return () => {
      offMute();
      offPhase();
      offAiSay();
      detachKeyboard();
      window.removeEventListener("keydown", handlePttKeyDown);
      window.removeEventListener("keyup", handlePttKeyUp);
      window.removeEventListener("blur", handleMicSafety);
      document.removeEventListener("visibilitychange", handleMicSafety);
      recognizer.stop();
      cancelSpeech();
    };
  }, []);

  return null;
}
