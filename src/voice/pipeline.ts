"use client";

/**
 * VOICE — shared command intake pipeline + mute state, used by both
 * VoiceLink (mic transcripts) and VoiceBar (typed fallback input) so a
 * typed command runs through the exact same wake/reflex/neural logic as a
 * spoken one. Also centralizes the echo-guard + manual-mute state so both
 * components can read/drive the same source of truth.
 */
import { game } from "@/game/store";
import { say } from "@/lib/bus";
import type { CommandSource, GameCommand } from "@/game/types";
import { matchReflex, matchWakeWord } from "./reflex";

const NEURAL_TIMEOUT_MS = 6000;
const ECHO_TAIL_MS = 350;

/* ------------------------------------------------------------- mute state */

type Listener = () => void;
const muteListeners = new Set<Listener>();

let echoMuted = false;
let manualMuted = false;
let echoGuardUntil = 0;
let lastSpokenLine = "";

function notifyMuteChange(): void {
  muteListeners.forEach((cb) => cb());
}

/** Subscribe to any change in echo-guard or manual mute state. */
export function onMuteChange(cb: Listener): () => void {
  muteListeners.add(cb);
  return () => muteListeners.delete(cb);
}

export function isMuted(): boolean {
  return echoMuted || manualMuted;
}

export function isManualMuted(): boolean {
  return manualMuted;
}

export function toggleManualMute(): boolean {
  manualMuted = !manualMuted;
  notifyMuteChange();
  return manualMuted;
}

export function setManualMuted(next: boolean): void {
  if (manualMuted === next) return;
  manualMuted = next;
  notifyMuteChange();
}

/** Call right before a TTS line starts playing. */
export function beginEchoGuard(text: string): void {
  lastSpokenLine = text;
  if (!echoMuted) {
    echoMuted = true;
    notifyMuteChange();
  }
}

/** Call right after a TTS line finishes — unmutes after a short tail. */
export function endEchoGuard(): void {
  setTimeout(() => {
    echoMuted = false;
    echoGuardUntil = Date.now() + ECHO_TAIL_MS;
    notifyMuteChange();
  }, ECHO_TAIL_MS);
}

function similarToSpoken(heard: string, spoken: string): boolean {
  const a = heard.toLowerCase().trim();
  const b = spoken.toLowerCase().trim();
  if (!a || !b) return false;
  if (a === b) return true;
  if (a.length >= 6 && b.includes(a)) return true;
  if (b.length >= 6 && a.includes(b)) return true;
  return false;
}

/* --------------------------------------------------------------- commands */

function runCommand(cmd: GameCommand, source: CommandSource): void {
  import("@/game/commands")
    .then(({ executeCommand }) => {
      const result = executeCommand(cmd, source);
      if (result?.speech) say(result.speech);
    })
    .catch(() => {
      say("Say again, Pilot.");
    });
}

async function runNeural(text: string): Promise<void> {
  const s = game.get();
  s.setAiStatus("THINKING");
  let timer: ReturnType<typeof setTimeout> | null = null;
  try {
    const { askCopilot } = await import("@/ai/client");
    const timeout = new Promise<never>((_, reject) => {
      timer = setTimeout(() => reject(new Error("neural-timeout")), NEURAL_TIMEOUT_MS);
    });
    const reply = await Promise.race([askCopilot(text, game.snapshot()), timeout]);
    if (timer) clearTimeout(timer);
    s.setNeuralOnline(reply.source === "NEURAL");
    for (const cmd of reply.commands) runCommand(cmd, "NEURAL");
    if (reply.speech) say(reply.speech);
  } catch {
    if (timer) clearTimeout(timer);
    s.setNeuralOnline(false);
    say("Say again, Pilot.", "urgent");
  }
}

/* ----------------------------------------------------------------- intake */

/**
 * Process one heard/typed line of pilot speech: log it, run it through the
 * echo guard, wake-word gate, reflex matcher, and (on a miss) the neural
 * fallback. `bypassEchoGuard` is set by the typed-command path since typed
 * text can never be an echo of ECHO-01's own voice.
 */
export function processHeardText(rawText: string, opts: { bypassEchoGuard?: boolean } = {}): void {
  const text = rawText.trim();
  if (!text) return;
  const s = game.get();
  s.pushLog("PILOT", text);

  if (!opts.bypassEchoGuard) {
    if (echoMuted || Date.now() < echoGuardUntil) return;
    if (similarToSpoken(text, lastSpokenLine)) return;
  }

  if (s.phase === "STANDBY") {
    if (matchWakeWord(text)) {
      s.setPhase("WAKE");
      say("WAKE");
    }
    return;
  }

  const reflexCmd = matchReflex(text);
  if (reflexCmd) {
    s.setAiStatus("THINKING");
    setTimeout(() => runCommand(reflexCmd, "REFLEX"), 30);
    return;
  }

  void runNeural(text);
}

/** Typed fallback input runs the exact same pipeline as a final transcript. */
export function processTypedCommand(text: string): void {
  processHeardText(text, { bypassEchoGuard: true });
}

/** Manual command from a keyboard shortcut — bypasses reflex/neural entirely. */
export function runManualCommand(cmd: GameCommand): void {
  runCommand(cmd, "MANUAL");
}
