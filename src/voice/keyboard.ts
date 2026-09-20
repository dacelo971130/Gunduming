"use client";

/**
 * VOICE — keyboard fallback. The demo must survive a dead microphone: every
 * voice command has a key, plus rehearsal keys to jump phases and reset.
 * Ignored entirely while an input/textarea/contenteditable has focus so the
 * VoiceBar text box (and any other input) can be typed into normally.
 *
 * Weapons: `q` cycles to the next weapon, `w` to the previous one (WEAPONS
 * order in config.ts). Digits stay rehearsal keys.
 */
import type { GameCommand } from "@/game/types";
import { game } from "@/game/store";
import type { Phase } from "@/game/types";

export interface KeyboardHandlerOptions {
  onCommand(cmd: GameCommand): void;
  onFocusCommandBox(): void;
  onToggleMute(): void;
  onSkipTo(n: number): void;
  onReset(): void;
}

export function isTypingTarget(target: EventTarget | null): boolean {
  if (!(target instanceof HTMLElement)) return false;
  const tag = target.tagName;
  return tag === "INPUT" || tag === "TEXTAREA" || target.isContentEditable;
}


const COCKPIT_PHASES = new Set<Phase>([
  "COCKPIT_BOOT", "BRIEFING", "COMBAT", "BOSS_INTRO", "BOSS", "VICTORY", "DEFEAT",
]);
const ALWAYS_LIVE = new Set(["n", "/", "0", "1", "2", "3", "4", "5", "6", "7"]);

/** Mounts a single global keydown listener. Returns a cleanup function. */
export function attachKeyboardFallback(opts: KeyboardHandlerOptions): () => void {
  function handler(e: KeyboardEvent): void {
    if (isTypingTarget(e.target)) return;
    if (e.metaKey || e.ctrlKey || e.altKey) return;

    const key = e.key.length === 1 ? e.key.toLowerCase() : e.key;

    // Before the cockpit is up, Space is the wake-word override owned by the
    // standby screen — firing a weapon that does not exist yet would only
    // clutter the comms log. Rehearsal and mute keys stay live throughout.
    if (!COCKPIT_PHASES.has(game.get().phase) && !ALWAYS_LIVE.has(key)) return;

    switch (key) {
      case "l":
        opts.onCommand({ action: "LOCK_TARGET", target: { type: "NEAREST" } });
        break;
      case "r":
        opts.onCommand({ action: "LOCK_TARGET", target: { type: "RED_ACE" } });
        break;
      case "f":
      case " ":
        e.preventDefault();
        opts.onCommand({ action: "ATTACK" });
        break;
      case "q":
        opts.onCommand({ action: "SWITCH_WEAPON", weapon: "NEXT" });
        break;
      case "w":
        opts.onCommand({ action: "SWITCH_WEAPON", weapon: "PREVIOUS" });
        break;
      case "d":
        opts.onCommand({ action: "DEFEND" });
        break;
      case "e":
        opts.onCommand({ action: "EVADE" });
        break;
      case "b":
        opts.onCommand({ action: "BOOST" });
        break;
      case "a":
        opts.onCommand({ action: "ANALYZE" });
        break;
      case "s":
        opts.onCommand({ action: "SCAN" });
        break;
      case "t":
        opts.onCommand({ action: "STATUS_REPORT" });
        break;
      case "x":
        opts.onCommand({ action: "FIRE_SPECIAL" });
        break;
      case "n":
        opts.onToggleMute();
        break;
      case "/":
        e.preventDefault();
        opts.onFocusCommandBox();
        break;
      case "0":
        opts.onReset();
        break;
      case "1":
      case "2":
      case "3":
      case "4":
      case "5":
      case "6":
      case "7":
        opts.onSkipTo(Number(key));
        break;
      default:
        break;
    }
  }

  window.addEventListener("keydown", handler);
  return () => window.removeEventListener("keydown", handler);
}
