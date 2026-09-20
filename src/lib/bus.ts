import type { CommandResult, GameCommand, LogLevel, Phase } from "@/game/types";

/** One-shot sound effects. The audio module owns the synthesis. */
export type AudioCue =
  | "WAKE" | "BOOT_TICK" | "BOOT_DONE" | "PANEL_ON" | "BEEP" | "DENY"
  | "LOCK" | "FIRE" | "IMPACT" | "PLAYER_HIT" | "EXPLOSION" | "SHIELD"
  | "BOOST" | "ALARM" | "SPECIAL" | "ANALYZE" | "VICTORY";

export type BgmTrack = "NONE" | "AMBIENT" | "BRIEFING" | "COMBAT" | "BOSS" | "VICTORY";

export interface BusEvents {
  /** Full-width HUD callout. */
  "hud:alert": { text: string; level: LogLevel; ttl?: number };
  /** Screen shake / flash. intensity 0..1 */
  "hud:shake": { intensity: number };
  /** Co-pilot should speak this line (TTS). */
  "ai:say": { text: string; priority?: "normal" | "urgent" };
  /** Co-pilot finished speaking — used to re-arm speech recognition. */
  "ai:spoken": { text: string };
  /** A command was executed by any path. */
  "cmd:executed": { command: GameCommand; result: CommandResult };
  /** Weapon fired at a target — the viewport draws the tracer. */
  "fx:fire": { targetId: string | null; mode: string };
  /** Something took damage — viewport draws the burst. */
  "fx:hit": { targetId: string; amount: number; killed: boolean };
  /** Player took damage. */
  "fx:playerHit": { amount: number; fromBearing: number };
  "fx:special": { targetId: string | null };
  "audio:cue": { cue: AudioCue };
  "audio:bgm": { track: BgmTrack };
  "phase:changed": { phase: Phase; previous: Phase };
  /** Voice layer reports what it heard. */
  "voice:transcript": { text: string; final: boolean };
}

type Handler<K extends keyof BusEvents> = (payload: BusEvents[K]) => void;

const listeners = new Map<string, Set<Handler<never>>>();

export const bus = {
  on<K extends keyof BusEvents>(event: K, handler: Handler<K>): () => void {
    let set = listeners.get(event);
    if (!set) {
      set = new Set();
      listeners.set(event, set);
    }
    set.add(handler as Handler<never>);
    return () => {
      set!.delete(handler as Handler<never>);
    };
  },
  emit<K extends keyof BusEvents>(event: K, payload: BusEvents[K]): void {
    const set = listeners.get(event);
    if (!set) return;
    for (const handler of set) {
      try {
        (handler as Handler<K>)(payload);
      } catch (err) {
        console.error(`[bus] handler for ${event} threw`, err);
      }
    }
  },
  clear(): void {
    listeners.clear();
  },
};

/** Convenience: speak a line and mirror it into the combat log. */
export function say(text: string, priority: "normal" | "urgent" = "normal"): void {
  if (!text) return;
  bus.emit("ai:say", { text, priority });
}
