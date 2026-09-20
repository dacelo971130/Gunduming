import type { CommandResult, GameCommand, LogLevel, Phase, WeaponId } from "@/game/types";

/** One-shot sound effects. The audio module owns the synthesis. */
export type AudioCue =
  | "WAKE" | "BOOT_TICK" | "BOOT_DONE" | "PANEL_ON" | "BEEP" | "DENY"
  | "LOCK" | "FIRE" | "IMPACT" | "PLAYER_HIT" | "EXPLOSION" | "SHIELD"
  | "BOOST" | "ALARM" | "SPECIAL" | "ANALYZE" | "VICTORY"
  | "WEAPON_SWITCH" | "FIRE_CANNON" | "FIRE_MISSILE" | "FIRE_BLADE"
  | "FIRE_INCENDIARY" | "FIRE_NUKE" | "NUKE_ARM" | "FLEET_CALL" | "FLEET_IMPACT" | "BURNING";

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
  /** Weapon fired at a target — the viewport draws the tracer/shell/salvo/slash per weapon. */
  "fx:fire": { targetId: string | null; mode: string; weapon?: WeaponId };
  /** Pilot switched weapons — HUD selector, viewport arm swap, audio cue. */
  "weapon:changed": { weapon: WeaponId; previous: WeaponId };
  /**
   * The mech yawed by `delta` degrees (+ = right). `player.bearing` is the new
   * absolute heading. Every `Enemy.bearing` (relative to the nose) has ALREADY
   * been shifted by -delta when this fires; AI modules must shift any cached
   * relative bearing goals by -delta too.
   */
  "player:turned": { delta: number; bearing: number };
  /** Something took damage — viewport draws the burst. */
  "fx:hit": { targetId: string; amount: number; killed: boolean };
  /** Player took damage. */
  "fx:playerHit": { amount: number; fromBearing: number };
  "fx:special": { targetId: string | null };
  /** Off-map fire support: shells called at `atMs`, land at `impactAtMs` around the target's last position. */
  "fx:fleetCall": { targetId: string | null; impactAtMs: number; rounds: number };
  /** Fleet shells actually landing (one event per use, all rounds). */
  "fx:fleetImpact": { targetId: string | null; killed: string[] };
  /** Nuclear detonation at the target — whiteout, shockwave, mushroom, long shake. */
  "fx:nuke": { targetId: string | null; killed: string[] };
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
