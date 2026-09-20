/**
 * Proactive co-pilot lines. Called when something noteworthy happens
 * (SURROUNDED, LOW_ARMOR, a weapon-doctrine moment...). Goes through the same
 * /api/copilot route as normal orders (mode: "advice"), so the API key never
 * has to be read from this file. Never throws — always resolves to a usable
 * string, "" meaning "stay silent right now" (rate-limited or already speaking).
 *
 * `startWeaponAdvisor()` is the watcher that detects the three weapon-doctrine
 * moments from the store and speaks the resulting line; the director starts
 * it for the session.
 */
import type { GameSnapshot, Phase } from "@/game/types";
import { game } from "@/game/store";
import { say } from "@/lib/bus";
import { weaponSpec } from "@/lib/config";

export type AdviceTrigger =
  | "SURROUNDED"
  | "LOW_ARMOR"
  | "BOSS_FLANKING"
  | "WEAK_POINT"
  | "WAVE_CLEARED"
  | "IDLE_CHECK"
  | "BLADE_RANGE"
  | "CANNON_OPENING"
  | "MISSILE_CLUSTER"
  | "TARGET_OFF_NOSE"
  | "NUKE_WINDOW"
  | "FLEET_WINDOW";

/** Hand-written fallback line per trigger, used whenever the LLM is unavailable. */
export const ADVICE_FALLBACK_LINES: Record<AdviceTrigger, string> = {
  SURROUNDED: "Pilot, three hostiles are converging from your left.",
  LOW_ARMOR: "Armor integrity is below thirty percent. I recommend disengaging.",
  BOSS_FLANKING: "Warning. Crimson-01 is attempting a flanking maneuver.",
  WEAK_POINT: "I detected a temporary opening in the enemy's defense.",
  WAVE_CLEARED: "Wave cleared, Pilot. Systems nominal — stand by for the next contact.",
  IDLE_CHECK: "All quiet, Pilot. No immediate threats on scope.",
  BLADE_RANGE: "Target inside blade range, Pilot. Switch to the plasma blade and finish it.",
  CANNON_OPENING: "Weak point exposed. The heavy cannon would break it — switch and fire before it closes.",
  MISSILE_CLUSTER: "Three or more contacts bunched in the cone, Pilot. One missile salvo would hit them all.",
  TARGET_OFF_NOSE: "Target is off your nose, Pilot. Turn to face it.",
  NUKE_WINDOW: "Three contacts, all outside the safety minimum, Pilot. The warhead is available — say nuke. It is the only one.",
  FLEET_WINDOW: "Fleet cannon is ready, Pilot. Call the fire mission — shells land in three seconds.",
};

/** "Target at your 2 o'clock, turn right." — clock position from a relative bearing. */
export function offNoseLine(codename: string, relativeBearing: number): string {
  const hour = ((Math.round(relativeBearing / 30) + 12) % 12) || 12;
  const side = relativeBearing >= 0 ? "right" : "left";
  return `${codename} at your ${hour} o'clock, turn ${side}.`;
}

const RATE_LIMIT_MS = 8000;
const ADVICE_TIMEOUT_MS = 5000;

let lastAdviceAt = 0;

interface AdviceResponseBody {
  speech?: unknown;
}

/**
 * Request one spoken proactive line for `trigger`. Rate-limited to roughly
 * one line every 8s, and suppressed entirely while the AI is already
 * speaking. Returns "" when suppressed — callers should treat that like
 * `say("")`, i.e. a no-op.
 */
export async function requestAdvice(trigger: AdviceTrigger, snapshot: GameSnapshot): Promise<string> {
  const now = Date.now();
  const aiStatus = game.get().aiStatus;
  if (aiStatus === "SPEAKING") return "";
  if (now - lastAdviceAt < RATE_LIMIT_MS) return "";

  const controller = typeof AbortController !== "undefined" ? new AbortController() : null;
  const timer = controller ? setTimeout(() => controller.abort(), ADVICE_TIMEOUT_MS) : null;

  try {
    const res = await fetch("/api/copilot", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ transcript: "", snapshot, mode: "advice", trigger }),
      signal: controller ? controller.signal : undefined,
    });
    if (!res.ok) throw new Error(`advice request failed with status ${res.status}`);
    const data = (await res.json()) as AdviceResponseBody;
    const speech = typeof data.speech === "string" && data.speech.trim().length > 0 ? data.speech.trim() : ADVICE_FALLBACK_LINES[trigger];
    lastAdviceAt = now;
    return speech;
  } catch (err) {
    console.error(`[ai/advisor] advice request failed for ${trigger}, using fallback line:`, err);
    lastAdviceAt = now;
    return ADVICE_FALLBACK_LINES[trigger];
  } finally {
    if (timer) clearTimeout(timer);
  }
}

/* ------------------------------------------------------- weapon doctrine */

const WEAPON_ADVICE_POLL_MS = 400;
/** Per-trigger quiet period on top of requestAdvice's global 8s limit. */
const WEAPON_ADVICE_COOLDOWN_MS = 20000;
const WEAPON_ADVICE_PHASES = new Set<Phase>(["COMBAT", "BOSS"]);
/** Locked target more than this far off the nose, for at least this long, earns a clock-position callout. */
const OFF_NOSE_DEG = 40;
const OFF_NOSE_HOLD_MS = 2000;

function bearingDelta(a: number, b: number): number {
  return ((a - b + 540) % 360) - 180;
}

/**
 * Watches the store for the three weapon-doctrine moments and speaks a
 * throttled callout for each — edge-triggered, so a target sitting inside
 * blade range nags once, not every tick:
 *
 *   BLADE_RANGE     locked target enters blade range while another weapon is selected
 *   CANNON_OPENING  a weak point opens while the cannon is NOT selected
 *   MISSILE_CLUSTER 3+ living enemies inside the missile cone while missiles are NOT selected
 *
 * Runs only during COMBAT/BOSS. Returns a stop function. Safe on the server (no-op).
 */
export function startWeaponAdvisor(): () => void {
  if (typeof window === "undefined") return () => {};

  const lastFiredAt: Partial<Record<AdviceTrigger, number>> = {};
  let bladeArmed = true;
  let clusterArmed = true;
  let offNoseArmed = true;
  let nukeArmed = true;
  let fleetArmed = true;
  let offNoseSince = 0;
  const calledOpenings = new Set<string>();
  let inFlight = false;

  /**
   * Speak one doctrine line. `rearm` re-opens the edge when the line was
   * suppressed (global 8 s limiter, ECHO-01 already speaking, request in
   * flight) so the moment is retried on a later tick instead of being lost;
   * the per-trigger cooldown only starts once a line was actually spoken.
   */
  const callout = (trigger: AdviceTrigger, rearm: () => void, mockLine?: string): void => {
    if (Date.now() - (lastFiredAt[trigger] ?? 0) < WEAPON_ADVICE_COOLDOWN_MS) return;
    if (inFlight) {
      rearm();
      return;
    }
    inFlight = true;
    requestAdvice(trigger, game.snapshot())
      .then((speech) => {
        if (speech) {
          // The hand-written fallback is generic; when that is what came back, prefer the live-computed line.
          say(mockLine && speech === ADVICE_FALLBACK_LINES[trigger] ? mockLine : speech);
          lastFiredAt[trigger] = Date.now();
        } else {
          rearm();
        }
      })
      .catch(() => {
        rearm(); // requestAdvice is total; this is belt and braces
      })
      .finally(() => {
        inFlight = false;
      });
  };

  const tick = (): void => {
    try {
      const s = game.get();
      if (!WEAPON_ADVICE_PHASES.has(s.phase)) return;
      const living = s.enemies.filter((e) => e.state !== "DESTROYED");
      const weapon = s.player.weapon;
      const target = s.targetId ? living.find((e) => e.id === s.targetId) ?? null : null;

      // 1. Locked target enters blade range.
      const bladeRange = weaponSpec("BLADE").maxRange ?? 260;
      if (target && target.distance <= bladeRange) {
        if (bladeArmed && weapon !== "BLADE") {
          bladeArmed = false;
          callout("BLADE_RANGE", () => {
            bladeArmed = true;
          });
        }
      } else {
        bladeArmed = true;
      }

      // 2. A weak point opens while the cannon is not up (once per opening).
      for (const e of living) {
        if (e.weakPointOpen) {
          if (!calledOpenings.has(e.id)) {
            calledOpenings.add(e.id);
            if (weapon !== "CANNON") callout("CANNON_OPENING", () => calledOpenings.delete(e.id));
          }
        } else {
          calledOpenings.delete(e.id);
        }
      }

      // 3. Three or more contacts inside the missile cone (and reach).
      const missile = weaponSpec("MISSILE");
      const reach = missile.maxRange ?? Number.POSITIVE_INFINITY;
      const inReach = living.filter((e) => e.distance <= reach);
      const clustered = inReach.some(
        (anchor) => inReach.filter((e) => Math.abs(bearingDelta(e.bearing, anchor.bearing)) <= missile.splashDeg).length >= 3,
      );
      if (clustered) {
        if (clusterArmed && weapon !== "MISSILE") {
          clusterArmed = false;
          callout("MISSILE_CLUSTER", () => {
            clusterArmed = true;
          });
        }
      } else {
        clusterArmed = true;
      }
      // 5. Nuke window: 3+ contacts all beyond the safety minimum, warhead in hand, nuke not selected.
      const nuke = weaponSpec("NUKE");
      const nukeLeft = s.player.ammo?.NUKE ?? nuke.ammo ?? 0;
      const nukeWindow = nukeLeft > 0 && living.length >= 3 && living.every((e) => e.distance >= (nuke.minRange ?? 450));
      if (nukeWindow) {
        if (nukeArmed && weapon !== "NUKE") {
          nukeArmed = false;
          callout("NUKE_WINDOW", () => {
            nukeArmed = true;
          });
        }
      } else {
        nukeArmed = true;
      }

      // 6. Fleet window: reloaded, and either overwhelmed or the ace is staggered.
      const fleetReady = (s.player.weaponReadyAt?.FLEET_CANNON ?? 0) <= Date.now();
      const staggeredAce = living.some((e) => e.kind === "CRIMSON" && (e.weakPointOpen || e.state === "STAGGERED"));
      const overwhelmed = living.length >= 3 && s.player.hp / s.player.maxHp < 0.5;
      if (fleetReady && (staggeredAce || overwhelmed)) {
        if (fleetArmed && weapon !== "FLEET_CANNON") {
          fleetArmed = false;
          callout("FLEET_WINDOW", () => {
            fleetArmed = true;
          });
        }
      } else {
        fleetArmed = true;
      }

      // 4. Locked target well off the nose for a couple of seconds — say where and which way.
      if (target && Math.abs(target.bearing) > OFF_NOSE_DEG) {
        if (offNoseSince === 0) offNoseSince = Date.now();
        if (offNoseArmed && Date.now() - offNoseSince >= OFF_NOSE_HOLD_MS) {
          offNoseArmed = false;
          const line = offNoseLine(target.codename, target.bearing);
          callout("TARGET_OFF_NOSE", () => {
            offNoseArmed = true;
          }, line);
        }
      } else {
        offNoseSince = 0;
        offNoseArmed = true;
      }
    } catch (err) {
      console.error("[ai/advisor] weapon advisor tick threw", err);
    }

  };

  const timer = window.setInterval(tick, WEAPON_ADVICE_POLL_MS);
  return () => window.clearInterval(timer);
}
