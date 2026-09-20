/** Wave and boss spawning. */
import { game } from "@/game/store";
import { bus } from "@/lib/bus";
import { BOSS_NAME, BOSS_TITLE, GRUNT_NAME } from "@/lib/config";
import type { Enemy } from "@/game/types";

/** All enemies not yet destroyed. */
export function livingEnemies(): Enemy[] {
  return game.get().enemies.filter((e) => e.state !== "DESTROYED");
}

/** wave 1: 2 MANTIS, wave 2: 3, wave 3: 4 with tighter spacing. */
export function spawnWave(n: number): void {
  const store = game.get();
  const count = n <= 1 ? 2 : n === 2 ? 3 : 4;
  const hp = n >= 3 ? 130 : 100;
  const letter = String.fromCharCode(64 + Math.max(1, Math.min(n, 6))); // 1->A, 2->B, 3->C…
  const spread = n >= 3 ? 50 : 80; // wave 3 groups tighter
  const now = Date.now();

  for (let i = 0; i < count; i++) {
    const t = i / (count - 1); // count is always >= 2, so this never divides by zero
    const bearing = -spread + t * spread * 2 + (Math.random() * 10 - 5);
    const distance = 700 + Math.random() * 400;
    store.addEnemy({
      id: `mantis-${now}-${i}`,
      codename: `${GRUNT_NAME} / ${letter}${i + 1}`,
      kind: "MANTIS",
      hp,
      maxHp: hp,
      shield: 0.1,
      bearing,
      distance,
      altitude: Math.random() * 0.6 - 0.3,
      state: "SPAWNING",
      threat: 0.3,
      analyzed: false,
      weakPointOpen: false,
      lastFireAt: now + i * 400,
      spawnAt: now,
    });
  }

  store.setMission({ wave: n, status: "ACTIVE" });
  store.pushLog("SYS", `WAVE ${n} — ${count} MANTIS UNITS INBOUND`);
  bus.emit("hud:alert", { text: `WAVE ${n}`, level: "WARN" });
}

/** The Red Ace — one CRIMSON-01. */
export function spawnBoss(): void {
  const store = game.get();
  const now = Date.now();
  store.addEnemy({
    id: `crimson-${now}`,
    codename: BOSS_NAME,
    kind: "CRIMSON",
    hp: 520,
    maxHp: 520,
    shield: 0.28,
    bearing: 0,
    distance: 900,
    altitude: 0,
    state: "SPAWNING",
    threat: 1,
    analyzed: false,
    weakPointOpen: false,
    lastFireAt: now,
    spawnAt: now,
    adaptation: "NONE",
  });
  store.setMission({ status: "ACTIVE" });
  store.pushLog("CRIT", `${BOSS_NAME} — ${BOSS_TITLE} DETECTED`);
}
