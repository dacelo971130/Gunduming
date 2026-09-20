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

/** Subscribe to any change in echo-guard, manual mute, or push-to-talk state. */
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

/* ------------------------------------------------------ push-to-talk state */

/**
 * The venue is loud, so push-to-talk (hold `M`, or `Shift`, to open the mic)
 * is the default mode — ambient/crowd noise can never fire a command while
 * the key isn't held. Always-on listening is still available via a toggle.
 */
let pttMode = true;
let pttHeld = false;

export function isPttMode(): boolean {
  return pttMode;
}

export function setPttMode(next: boolean): void {
  if (pttMode === next) return;
  pttMode = next;
  if (!pttMode) pttHeld = false; // leaving PTT mode can't leave the mic "stuck held"
  notifyMuteChange();
}

export function togglePttMode(): boolean {
  setPttMode(!pttMode);
  return pttMode;
}

export function isPttHeld(): boolean {
  return pttHeld;
}

/** Driven by VoiceLink's key handlers (press/release, blur, visibilitychange). */
export function setPttHeld(next: boolean): void {
  if (pttHeld === next) return;
  pttHeld = next;
  notifyMuteChange();
}

/** True when the mic should actually be capturing audio right now. */
export function isMicOpen(): boolean {
  if (manualMuted || echoMuted) return false;
  return !pttMode || pttHeld;
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

/* ------------------------------------------------------ noise rejection */

/** Below this (only when the browser actually reports a confidence), the
 *  whole transcript is dropped before it ever reaches reflex/neural matching. */
const CONFIDENCE_THRESHOLD = 0.35;
/** Same reflex command can't fire twice from one utterance's worth of noise. */
const REFLEX_DEBOUNCE_MS = 1200;
/** "Reasonably short" — in STANDBY, saying almost anything this short wakes ECHO. */
const STANDBY_WAKE_MAX_WORDS = 8;

const FILLER_WORDS = new Set(["uh", "um", "ah", "erm", "hmm", "huh", "eh", "uhh", "umm"]);

let lastReflexKey = "";
let lastReflexAt = 0;

/** Many Web Speech implementations report 0 when confidence isn't actually
 *  known — only treat it as "low confidence" when a real (nonzero) value
 *  was reported below the threshold, so unsupported browsers aren't punished. */
function isLowConfidence(confidence?: number): boolean {
  return typeof confidence === "number" && confidence > 0 && confidence < CONFIDENCE_THRESHOLD;
}

/** Garbage: no vowel-bearing content, too short to be a word, or pure filler
 *  ("uh", "um", …). Used only as a last resort before escalating to the LLM —
 *  a real reflex phrase always wins first, however short. */
function looksLikeGarbage(text: string): boolean {
  const norm = text
    .toLowerCase()
    .replace(/[^a-z\s]/g, " ")
    .replace(/\s+/g, " ")
    .trim();
  if (!norm) return true;
  if (norm.length < 3) return true;
  if (!/[aeiou]/.test(norm)) return true;
  const tokens = norm.split(" ").filter(Boolean);
  if (tokens.length > 0 && tokens.every((t) => FILLER_WORDS.has(t))) return true;
  return false;
}

/* ----------------------------------------------------------------- intake */

/**
 * Process one heard/typed line of pilot speech: log it, run it through the
 * echo guard, wake-word gate, reflex matcher, and (on a miss) the neural
 * fallback. `bypassEchoGuard` is set by the typed-command path since typed
 * text can never be an echo of ECHO-01's own voice. `confidence` (when the
 * recognizer reports one) gates out low-confidence noise before it can ever
 * fire a reflex or reach the LLM.
 */
export function processHeardText(
  rawText: string,
  opts: { bypassEchoGuard?: boolean; confidence?: number } = {},
): void {
  const text = rawText.trim();
  if (!text) return;
  const s = game.get();
  s.pushLog("PILOT", text);

  if (!opts.bypassEchoGuard) {
    if (echoMuted || Date.now() < echoGuardUntil) return;
    if (similarToSpoken(text, lastSpokenLine)) return;
  }

  if (s.phase === "STANDBY") {
    // Standing at a black screen, almost anything short means "start" — a
    // missed wake word costs the whole demo, a false wake costs nothing.
    const wordCount = text.split(/\s+/).filter(Boolean).length;
    if (matchWakeWord(text) || (wordCount > 0 && wordCount <= STANDBY_WAKE_MAX_WORDS)) {
      s.setPhase("WAKE");
      say("WAKE");
    }
    return;
  }

  // Once the cockpit is up, crowd noise must never fire (or misfire) a
  // command — reject anything the recognizer itself flags as unsure.
  if (isLowConfidence(opts.confidence)) return;

  const reflexCmd = matchReflex(text);
  if (reflexCmd) {
    const key = JSON.stringify(reflexCmd);
    const now = Date.now();
    if (key === lastReflexKey && now - lastReflexAt < REFLEX_DEBOUNCE_MS) return;
    lastReflexKey = key;
    lastReflexAt = now;
    s.setAiStatus("THINKING");
    setTimeout(() => runCommand(reflexCmd, "REFLEX"), 30);
    return;
  }

  // No reflex match — never escalate obvious noise ("uh", stray consonants,
  // sub-3-character scraps) to the LLM. Drop it silently; a repeated
  // "Say again, Pilot." for every cough in the crowd is worse than nothing.
  if (looksLikeGarbage(text)) return;

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
