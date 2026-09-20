/**
 * CRIMSON-01 "THE RED ACE" — the boss must read as adapting to the pilot, not just a bigger health bar.
 */
import { game } from "@/game/store";
import { bus, say } from "@/lib/bus";
import type { BossAdaptation, Enemy } from "@/game/types";

const ANALYSIS_INTERVAL_MS = 6000;
const FORCE_ADAPT_MS = 25000; // stage-demo guarantee: something must fire by 25s into BOSS
const FLANK_SWING_MS = 2000;
const STAGGER_MS = 1800;
const STAGGER_DAMAGE_THRESHOLD = 40;
const FIRE_COOLDOWN_MS = 2200;

// Movement-quality only (does not touch adaptation logic or the 25s force-adapt guarantee):
// committed closing passes that break off, and a brief telegraphed stillness before every shot.
const BOSS_WINDUP_MS = 700; // genuine stillness before it strikes
const PASS_CHARGE_MS = 1500; // max time committed to a closing pass before peeling off anyway
const PASS_BREAK_MS = 1400; // time spent breaking off after the pass
const PASS_CHARGE_DISTANCE = 190; // how close a closing pass commits to
const PASS_CHARGE_SPEED = 140; // m/s during the pass — a decisive rush, not a drift
const PASS_BREAK_SPEED = 70; // m/s peeling back out
const PASS_COOLDOWN_MIN_MS = 8000;
const PASS_COOLDOWN_MAX_MS = 13000;

type PassPhase = "NONE" | "CHARGE" | "BREAK";

interface BossState {
  id: string;
  lastAnalysisAt: number;
  phaseEnteredAt: number;
  flankSwingUntil: number;
  flankStartBearing: number;
  flankTargetBearing: number;
  staggerCloseAt: number;
  lastHp: number;
  passPhase: PassPhase;
  passUntil: number;
  nextPassAt: number;
  windupUntil: number;
}

let boss: BossState | null = null;

function findBoss(): Enemy | null {
  return game.get().enemies.find((e) => e.kind === "CRIMSON" && e.state !== "DESTROYED") ?? null;
}

function beginFlank(enemy: Enemy, now: number): void {
  if (!boss) return;
  const store = game.get();
  const magnitude = 70 + Math.random() * 50; // 70..120 degrees
  const sign = enemy.bearing >= 0 ? -1 : 1; // swing to the opposite side for a clean flank
  const targetBearing = Math.max(-179, Math.min(179, sign * magnitude));
  boss.flankStartBearing = enemy.bearing;
  boss.flankTargetBearing = targetBearing;
  boss.flankSwingUntil = now + FLANK_SWING_MS + Math.random() * 500;
  store.updateEnemy(enemy.id, { adaptation: "FLANKING" });
  store.pushLog("CRIT", "FLANKING MANEUVER — CRIMSON-01 REPOSITIONING TO THE FLANK");
  bus.emit("hud:alert", { text: "FLANKING MANEUVER", level: "CRIT" });
}

function applyFrontalGuardThenFlank(enemy: Enemy, now: number, frontalPct: number): void {
  const store = game.get();
  store.updateEnemy(enemy.id, { adaptation: "FRONTAL_GUARD", shield: Math.min(0.6, enemy.shield + 0.15) });
  store.pushLog("CRIT", `TACTICAL PATTERN DETECTED — FRONTAL ATTACK FREQUENCY: ${frontalPct}%`);
  bus.emit("hud:alert", { text: "TACTICAL PATTERN DETECTED", level: "CRIT" });
  say(`Warning. ${enemy.codename} is adapting to your attack pattern.`, "urgent");
  beginFlank(enemy, now);
}

function applyCountAdaptation(
  enemy: Enemy,
  adaptation: Extract<BossAdaptation, "BOOST_INTERCEPT" | "SHIELD_BREAK">,
  measured: string,
  speech: string,
): void {
  const store = game.get();
  store.updateEnemy(enemy.id, { adaptation });
  store.pushLog("CRIT", `TACTICAL PATTERN DETECTED — ${measured}`);
  bus.emit("hud:alert", { text: "TACTICAL PATTERN DETECTED", level: "CRIT" });
  say(speech, "urgent");
}

function considerAdaptation(enemy: Enemy, now: number): void {
  const telemetry = game.get().telemetry;
  const totalAttacks = telemetry.frontalAttacks + telemetry.flankAttacks;
  const frontalRatio = totalAttacks > 0 ? telemetry.frontalAttacks / totalAttacks : 0;
  const boostCount = telemetry.counts.BOOST ?? 0;
  const defendCount = telemetry.counts.DEFEND ?? 0;
  const current = enemy.adaptation ?? "NONE";

  if (totalAttacks >= 3 && frontalRatio > 0.6 && current !== "FRONTAL_GUARD" && current !== "FLANKING") {
    applyFrontalGuardThenFlank(enemy, now, Math.round(frontalRatio * 100));
    return;
  }
  if (boostCount >= 3 && current !== "BOOST_INTERCEPT") {
    applyCountAdaptation(
      enemy,
      "BOOST_INTERCEPT",
      `BOOST USAGE: ${boostCount}`,
      `Warning. ${enemy.codename} is compensating for your boost pattern.`,
    );
    return;
  }
  if (defendCount >= 3 && current !== "SHIELD_BREAK") {
    applyCountAdaptation(
      enemy,
      "SHIELD_BREAK",
      `DEFENSIVE ACTIONS: ${defendCount}`,
      `Warning. ${enemy.codename} is switching to armor-piercing rounds.`,
    );
  }
}

export function tickBoss(dt: number): void {
  try {
    const store = game.get();
    const enemy = findBoss();
    if (!enemy) {
      boss = null;
      return;
    }
    const now = Date.now();
    if (!boss || boss.id !== enemy.id) {
      boss = {
        id: enemy.id,
        lastAnalysisAt: now,
        phaseEnteredAt: now,
        flankSwingUntil: 0,
        flankStartBearing: enemy.bearing,
        flankTargetBearing: enemy.bearing,
        staggerCloseAt: 0,
        lastHp: enemy.hp,
        passPhase: "NONE",
        passUntil: 0,
        nextPassAt: now + 4000 + Math.random() * 3000,
        windupUntil: 0,
      };
    }

    // Heavy hit taken since the last tick → brief stagger with an exposed weak point.
    const damageSinceLast = boss.lastHp - enemy.hp;
    if (damageSinceLast >= STAGGER_DAMAGE_THRESHOLD && !enemy.weakPointOpen) {
      boss.staggerCloseAt = now + STAGGER_MS;
      store.updateEnemy(enemy.id, { weakPointOpen: true, state: "STAGGERED" });
      store.pushLog("CRIT", `${enemy.codename} STAGGERED — STABILIZERS EXPOSED`);
      say(`Direct hit! ${enemy.codename}'s stabilizers are exposed — fire now!`, "urgent");
    } else if (damageSinceLast > 0 && Math.random() < 0.3) {
      // A lighter hit sometimes provokes a quick evasive jink.
      store.updateEnemy(enemy.id, { bearing: Math.max(-179, Math.min(179, enemy.bearing + (Math.random() < 0.5 ? -1 : 1) * (15 + Math.random() * 15))) });
    }
    boss.lastHp = enemy.hp;

    // Stagger window closes and the ace resumes its adapted state.
    if (enemy.weakPointOpen && boss.staggerCloseAt && now >= boss.staggerCloseAt) {
      store.updateEnemy(enemy.id, { weakPointOpen: false, state: "ATTACK" });
      boss.staggerCloseAt = 0;
    }

    // Periodic telemetry analysis picks (or escalates) an adaptation.
    if (now - boss.lastAnalysisAt >= ANALYSIS_INTERVAL_MS) {
      boss.lastAnalysisAt = now;
      considerAdaptation(enemy, now);
    }

    // Stage-demo guarantee: force the flanking beat if nothing has fired by 25s in.
    if (now - boss.phaseEnteredAt >= FORCE_ADAPT_MS && (enemy.adaptation ?? "NONE") === "NONE") {
      store.pushLog("CRIT", "TACTICAL PATTERN DETECTED — FORCED ADAPTATION WINDOW");
      bus.emit("hud:alert", { text: "TACTICAL PATTERN DETECTED", level: "CRIT" });
      say(`Warning. ${enemy.codename} is adapting to your attack pattern.`, "urgent");
      beginFlank(enemy, now);
    }

    // Animate an in-progress flanking swing.
    const liveEnemy = game.get().enemies.find((e) => e.id === enemy.id);
    if (liveEnemy && boss.flankSwingUntil > now) {
      const remaining = boss.flankSwingUntil - now;
      const t = Math.min(1, Math.max(0, 1 - remaining / FLANK_SWING_MS));
      const bearing = boss.flankStartBearing + (boss.flankTargetBearing - boss.flankStartBearing) * t;
      store.updateEnemy(enemy.id, { bearing });
    }

    // Close toward an engagement range — faster and tighter when intercepting a boost. Punctuated by
    // committed high-speed closing passes that break off again, so it never reads as a static hover.
    const after = game.get().enemies.find((e) => e.id === enemy.id);
    if (after && after.state !== "STAGGERED") {
      const baseDistance = after.adaptation === "BOOST_INTERCEPT" ? 250 : 500;
      const baseSpeed = after.adaptation === "BOOST_INTERCEPT" ? 90 : 18;

      if (boss.passPhase === "NONE" && now >= boss.nextPassAt) {
        boss.passPhase = "CHARGE";
        boss.passUntil = now + PASS_CHARGE_MS;
      }

      let targetDistance = baseDistance;
      let speed = baseSpeed;
      if (boss.passPhase === "CHARGE") {
        targetDistance = PASS_CHARGE_DISTANCE;
        speed = PASS_CHARGE_SPEED;
        if (now >= boss.passUntil || after.distance <= PASS_CHARGE_DISTANCE + 8) {
          boss.passPhase = "BREAK";
          boss.passUntil = now + PASS_BREAK_MS;
        }
      } else if (boss.passPhase === "BREAK") {
        targetDistance = baseDistance + 140;
        speed = PASS_BREAK_SPEED;
        if (now >= boss.passUntil) {
          boss.passPhase = "NONE";
          boss.nextPassAt = now + PASS_COOLDOWN_MIN_MS + Math.random() * (PASS_COOLDOWN_MAX_MS - PASS_COOLDOWN_MIN_MS);
        }
      }

      // Genuine stillness before it strikes: frozen mid-telegraph, then the shot lands.
      const winding = boss.windupUntil > now;
      if (!winding && Math.abs(after.distance - targetDistance) > 4) {
        const distance = after.distance + (targetDistance > after.distance ? 1 : -1) * speed * dt;
        store.updateEnemy(enemy.id, { distance });
      }

      // Fires harder than the grunts; armor-piercing while countering turtling.
      if (winding) {
        if (now >= boss.windupUntil) {
          boss.windupUntil = 0;
          let damage = 10 + Math.random() * 8; // 10..18
          if (after.adaptation === "SHIELD_BREAK") damage *= 1.35;
          store.damagePlayer(damage, after.bearing);
          store.updateEnemy(enemy.id, { lastFireAt: now });
        }
      } else if (now - after.lastFireAt >= FIRE_COOLDOWN_MS) {
        boss.windupUntil = now + BOSS_WINDUP_MS;
      }
    }
  } catch (err) {
    console.error("[boss] tickBoss threw", err);
  }
}
