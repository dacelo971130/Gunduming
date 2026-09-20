"use client";

/**
 * VOICE — text-to-speech. `speechSynthesis` based, but every path degrades:
 * if synthesis is unsupported (or the browser silently never fires `onend`,
 * which happens), the caption/status timing still runs on an estimate so
 * the HUD stays in sync and callers' promises always resolve.
 */
import { game } from "@/game/store";
import { bus } from "@/lib/bus";

interface QueueItem {
  text: string;
  resolve: () => void;
}

let queue: QueueItem[] = [];
let speaking = false;
let activeId = 0;
let lastSpokenText = "";
let cachedVoice: SpeechSynthesisVoice | null = null;

function synthAvailable(): boolean {
  return typeof window !== "undefined" && "speechSynthesis" in window;
}

function pickVoice(): SpeechSynthesisVoice | null {
  if (!synthAvailable()) return null;
  let voices: SpeechSynthesisVoice[] = [];
  try {
    voices = window.speechSynthesis.getVoices();
  } catch {
    return null;
  }
  if (!voices || voices.length === 0) return null;

  const en = voices.filter((v) => (v.lang ?? "").toLowerCase().startsWith("en"));
  const pool = en.length > 0 ? en : voices;

  const maleHints = ["male", "david", "daniel", "fred", "alex", "aaron", "guy", "mark", "tom", "eric"];
  const usMale = pool.find((v) => {
    const lang = (v.lang ?? "").toLowerCase();
    const name = v.name.toLowerCase();
    return lang === "en-us" && maleHints.some((h) => name.includes(h));
  });
  if (usMale) return usMale;

  const anyMale = pool.find((v) => maleHints.some((h) => v.name.toLowerCase().includes(h)));
  if (anyMale) return anyMale;

  const us = pool.find((v) => (v.lang ?? "").toLowerCase() === "en-us");
  return us ?? pool[0] ?? null;
}

if (synthAvailable()) {
  cachedVoice = pickVoice();
  try {
    window.speechSynthesis.onvoiceschanged = () => {
      cachedVoice = pickVoice();
    };
  } catch {
    // ignore — voice picking just stays on the platform default
  }
}

/** Clipped military-computer delivery: ~ fast-ish word rate, floor/ceiling clamped. */
function estimateDurationMs(text: string): number {
  const words = text.trim().split(/\s+/).filter(Boolean).length;
  const perWordMs = 320;
  return Math.max(500, Math.min(12000, words * perWordMs + 300));
}

function stopCurrentPlayback(): void {
  activeId++; // invalidates any in-flight onend/onerror/timeout callback
  if (synthAvailable()) {
    try {
      window.speechSynthesis.cancel();
    } catch {
      // ignore
    }
  }
}

function playNext(): void {
  if (queue.length === 0) {
    speaking = false;
    game.get().setAiStatus("IDLE");
    bus.emit("ai:spoken", { text: lastSpokenText });
    return;
  }

  speaking = true;
  const item = queue.shift()!;
  lastSpokenText = item.text;
  const myId = ++activeId;

  game.get().setAiStatus("SPEAKING");
  game.get().setAiCaption(item.text);

  let settled = false;
  const settle = () => {
    if (myId !== activeId || settled) return;
    settled = true;
    item.resolve();
    playNext();
  };

  if (!synthAvailable()) {
    setTimeout(settle, estimateDurationMs(item.text));
    return;
  }

  try {
    const utter = new SpeechSynthesisUtterance(item.text);
    if (cachedVoice) utter.voice = cachedVoice;
    utter.lang = "en-US";
    utter.pitch = 0.85; // slightly lowered
    utter.rate = 1.1; // slightly raised
    utter.volume = 1;
    utter.onend = settle;
    utter.onerror = settle;
    // Safety net: some browsers (esp. after tab visibility changes) never fire onend.
    setTimeout(settle, estimateDurationMs(item.text) + 1500);
    window.speechSynthesis.speak(utter);
  } catch {
    setTimeout(settle, estimateDurationMs(item.text));
  }
}

/**
 * Queue a line to be spoken. Resolves once it has finished playing (or the
 * fallback timeout fires). `urgent` cancels whatever is queued/playing and
 * jumps this line to the front.
 */
export function speak(text: string, urgent = false): Promise<void> {
  const clean = text.trim();
  if (!clean) return Promise.resolve();

  return new Promise((resolve) => {
    if (urgent) {
      const dropped = queue;
      queue = [];
      for (const it of dropped) it.resolve();
      stopCurrentPlayback();
      speaking = false;
    }
    queue.push({ text: clean, resolve });
    if (!speaking) playNext();
  });
}

/** Hard-stop everything, resolve all pending promises, go IDLE immediately. */
export function cancelSpeech(): void {
  const dropped = queue;
  queue = [];
  for (const it of dropped) it.resolve();
  stopCurrentPlayback();
  if (speaking) {
    speaking = false;
    game.get().setAiStatus("IDLE");
    bus.emit("ai:spoken", { text: lastSpokenText });
  }
}
