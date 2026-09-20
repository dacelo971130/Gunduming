/**
 * The main simulation loop. Drives enemy/boss ticks and the win/lose state machine.
 * Phase *script* (bgm, speech, HUD copy) lives in director.ts, which reacts to phase changes.
 */
import { game } from "@/game/store";
import { tickEnemies } from "@/game/enemyAI";
import { tickBoss } from "@/game/boss";
import { livingEnemies, spawnWave } from "@/game/waves";

const MAX_DT = 0.1; // clamp so a tabbed-out browser doesn't cause a huge simulation jump

let paused = false;

function tick(dt: number): void {
  // Passive regen, grunt FSM, and destroyed-wreck cleanup run every tick regardless of phase.
  tickEnemies(dt);

  const store = game.get();
  const phase = store.phase;

  if (phase === "COMBAT") {
    const { wave, totalWaves } = store.mission;
    if (wave >= 1 && livingEnemies().length === 0) {
      if (wave < totalWaves) {
        spawnWave(wave + 1);
      } else {
        store.setPhase("BOSS_INTRO");
      }
    }
    return;
  }

  if (phase === "BOSS") {
    tickBoss(dt);
    const bossPresent = store.enemies.some((e) => e.kind === "CRIMSON");
    const bossAlive = store.enemies.some((e) => e.kind === "CRIMSON" && e.state !== "DESTROYED");
    if (bossPresent && !bossAlive) {
      store.setPhase("VICTORY");
    }
  }
}

export function startEngine(): () => void {
  if (typeof window === "undefined") return () => {};

  let rafId: number | null = null;
  let last = window.performance.now();

  const loop = (now: number) => {
    rafId = window.requestAnimationFrame(loop);
    if (paused) {
      last = now;
      return;
    }
    const dt = Math.min(MAX_DT, Math.max(0, (now - last) / 1000));
    last = now;
    try {
      tick(dt);
    } catch (err) {
      console.error("[engine] tick threw", err);
    }
  };

  rafId = window.requestAnimationFrame(loop);

  return () => {
    if (rafId !== null) window.cancelAnimationFrame(rafId);
  };
}

export function pauseEngine(value: boolean): void {
  paused = value;
}
