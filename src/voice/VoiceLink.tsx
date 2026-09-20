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
import { attachKeyboardFallback } from "./keyboard";
import { speak, cancelSpeech } from "./tts";
import {
  beginEchoGuard,
  endEchoGuard,
  isMuted,
  onMuteChange,
  processHeardText,
  runManualCommand,
  toggleManualMute,
} from "./pipeline";
import type { Phase } from "@/game/types";

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

  useEffect(() => {
    function refreshVoiceLinkStatus(): void {
      const s = game.get();
      const rec = recognizerRef.current;
      if (!rec || !rec.supported) {
        s.setVoiceLink("ERROR");
        return;
      }
      if (isMuted()) {
        s.setVoiceLink("MUTED");
        return;
      }
      s.setVoiceLink(s.phase === "STANDBY" ? "STANDBY" : "LISTENING");
    }

    const offMute = onMuteChange(() => {
      recognizerRef.current?.mute(isMuted());
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
            recognizerRef.current?.mute(isMuted());
            refreshVoiceLinkStatus();
          }, POST_SPEECH_RECHECK_MS);
        }
      })();
    });

    /** Error codes already surfaced this session, so each is logged only once. */
    const reported = new Set<string>();

    const recognizer = createRecognizer({
      onInterim: (text) => {
        game.get().setTranscript(text);
        bus.emit("voice:transcript", { text, final: false });
      },
      onFinal: (text) => {
        bus.emit("voice:transcript", { text, final: true });
        game.get().setTranscript("");
        processHeardText(text);
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
      recognizer.mute(isMuted());
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
      recognizer.stop();
      cancelSpeech();
    };
  }, []);

  return null;
}
