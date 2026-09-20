/**
 * MANTIS finite state machine: SPAWNING → PATROL → DETECT → ATTACK → (RETREAT below 25% hp) → DESTROYED.
 * Also drives passive player regen/heat-shedding and the CRIMSON weak-point/fire loop shares this tick.
 *
 * Squad tactics layer: each MANTIS is assigned a role (AGGRESSOR / FLANKER / SUPPRESSOR) derived from
 * its own id/index at spawn — no new fields on Enemy or the store. Movement is phase-based
 * (APPROACH → HOLD → WINDUP-to-fire, or BREAK when targeted) instead of continuous drift, so it reads
 * as deliberate pushes and holds rather than jitter. All of this bookkeeping lives in module-level Maps
 * keyed by enemy id, exactly like the pre-existing `spreadBearing`/`weakPointCloseAt` pattern — none of
 * it is part of the frozen Enemy shape.
 */
import { game } from "@/game/store";
import { bus } from "@/lib/bus";
import type { Enemy } from "@/game/types";

const DESTROY_LINGER_MS = 1200;
const SPAWNING_MS = 500;
const DETECT_MS = 800;

/** Squad roles, derived from the trailing index in the spawn id (`mantis-<ts>-<i>`). */
type Role = "AGGRESSOR" | "FLANKER" | "SUPPRESSOR";

/** Deliberate-movement phases. Distinct from `Enemy.state` — this is what drives bearing/distance. */
type EngagePhase = "APPROACH" | "HOLD" | "BREAK";

const AGGRESSOR_START_DISTANCE = 380; // first standoff a pusher settles at
const AGGRESSOR_MIN_DISTANCE = 210; // how close repeated pushes will eventually drive it
const AGGRESSOR_PUSH_STEP = 55; // closes this much further on each renewed push
const FLANKER_DISTANCE = 480;
// The pilot can turn (ArrowLeft/Right, "turn left", lock auto-faces), so a flanker
// genuinely goes wide — off the glass — and the pilot has to swing to find it.
const FLANKER_BEARING_MIN = 45;
const FLANKER_BEARING_MAX = 70;
/** Cap on any freshly committed bearing goal (relative to the nose at commit time). */
const CANOPY_BEARING_MAX = 70;
/** Jinks may leave the cone by a fair margin; the edge arrows show where it went. */
const BREAK_BEARING_MAX = 80;
const FLANKER_SETTLE_DEG = 10; // within this many degrees of its wide bearing, it's "arrived"
const SUPPRESSOR_DISTANCE = 820; // stays outside CLOSE range, fires steadily

const REPOSITION_SPEED = 34; // m/s — a committed push or breakaway
const BREAK_SPEED = 46; // m/s — jinking off after being locked
const BEARING_EASE_APPROACH = 0.9; // per-second
const BEARING_EASE_HOLD = 0.15; // near-stationary, no small-amplitude drift
const BEARING_EASE_BREAK = 1.5;

const FIRE_COOLDOWN_MS: Record<Role, number> = { AGGRESSOR: 2400, FLANKER: 3000, SUPPRESSOR: 2000 };
const WINDUP_MS: Record<Role, number> = { AGGRESSOR: 550, FLANKER: 700, SUPPRESSOR: 450 };
const HOLD_MS: Record<Role, number> = { AGGRESSOR: 2200, FLANKER: 2800, SUPPRESSOR: 1800 };

const WEAKPOINT_DURATION_MS = 2500;
const WEAKPOINT_CHANCE_PER_SEC = 0.04; // roughly one opening every ~25s per attacking unit

const RETREAT_SAFE_DISTANCE = 980;
const RETREAT_REGROUP_MS = 3200; // hold at safe range before returning
const RETREAT_COOLDOWN_MS = 6000; // grace period after returning before it can retreat again

const JINK_MIN_DEG = 22;
const JINK_MAX_DEG = 24 + 22; // 22..46
const BREAK_DISTANCE_PAD = 90; // back off this much while jinking

const CONVERGE_BEARING_GAP = 22; // degrees apart considered "bunched"
const CONVERGE_CALLOUT_COOLDOWN_MS = 15000;
const DANGER_ALERT_COOLDOWN_MS = 6000;
/** Incendiary damage-over-time is applied in chunks this long so fx:hit does not fire every frame. */
const BURN_CHUNK_S = 0.5;

/** Local bookkeeping keyed by enemy id — not part of the frozen Enemy shape. */
const destroyedAt = new Map<string, number>();
const stateEnteredAt = new Map<string, number>();
const weakPointCloseAt = new Map<string, number>();

const roleCache = new Map<string, Role>();
const engagePhase = new Map<string, EngagePhase>();
const phaseUntil = new Map<string, number>();
const roleBearing = new Map<string, number>(); // persistent committed bearing target for the unit's role
const distanceTarget = new Map<string, number>(); // persistent (aggressor: shrinks on each push cycle)
const breakBearing = new Map<string, number>(); // transient jink target while BREAK-ing
const windupUntil = new Map<string, number>(); // telegraph hold before a shot lands
const wasTargeted = new Map<string, boolean>();
const retreatEnteredAt = new Map<string, number>();
const retreatCooldownUntil = new Map<string, number>();
const burnAccum = new Map<string, number>(); // incendiary DoT accumulated since the last applied chunk
const shotCount = new Map<string, number>(); // for the burning-accuracy penalty (every third shot misses)

let lastConvergeCalloutAt = 0;
let lastDangerAlertAt = 0;

const ALL_BOOKKEEPING = [
  destroyedAt,
  stateEnteredAt,
  weakPointCloseAt,
  roleCache,
  engagePhase,
  phaseUntil,
  roleBearing,
  distanceTarget,
  breakBearing,
  windupUntil,
  wasTargeted,
  retreatEnteredAt,
  retreatCooldownUntil,
  burnAccum,
  shotCount,
];

/** Wrap any angle to (-180, 180]. */
function wrapDeg(deg: number): number {
  return ((deg + 540) % 360) - 180;
}

/** Shortest signed difference a - b, in degrees. */
function angleDiff(a: number, b: number): number {
  return wrapDeg(a - b);
}

/**
 * Every `Enemy.bearing` is RELATIVE to the nose and has already been shifted by
 * -delta when the pilot turns; the cached relative goals must follow, or the
 * squad would silently "turn with" the pilot and drift back in front of them.
 */
bus.on("player:turned", ({ delta }) => {
  for (const map of [roleBearing, breakBearing]) {
    for (const [id, goal] of map) map.set(id, wrapDeg(goal - delta));
  }
});

function clampToCanopy(deg: number, limit: number): number {
  return Math.max(-limit, Math.min(limit, deg));
}

function enterState(enemy: Enemy, state: Enemy["state"]): void {
  if (enemy.state !== state) stateEnteredAt.set(enemy.id, Date.now());
  game.get().updateEnemy(enemy.id, { state });
}

function roleFor(enemy: Enemy): Role {
  const cached = roleCache.get(enemy.id);
  if (cached) return cached;
  const parts = enemy.id.split("-");
  const parsed = Number.parseInt(parts[parts.length - 1] ?? "", 10);
  const i = Number.isFinite(parsed) ? parsed : 0;
  const r = i % 3;
  const role: Role = r === 1 ? "FLANKER" : r === 2 ? "SUPPRESSOR" : "AGGRESSOR";
  roleCache.set(enemy.id, role);
  return role;
}

/** The role's persistent, one-time-committed bearing target. Recomputed only after a fresh retreat/return. */
function committedBearingFor(enemy: Enemy, role: Role): number {
  const cached = roleBearing.get(enemy.id);
  if (cached !== undefined) return cached;
  let target: number;
  if (role === "FLANKER") {
    const side = enemy.bearing >= 0 ? 1 : -1;
    target = side * (FLANKER_BEARING_MIN + Math.random() * (FLANKER_BEARING_MAX - FLANKER_BEARING_MIN));
  } else if (role === "SUPPRESSOR") {
    target = enemy.bearing; // holds roughly where it arrived, off to one side
  } else {
    target = enemy.bearing * 0.45; // aggressor angles in toward the center for frontal pressure
  }
  target = clampToCanopy(target, CANOPY_BEARING_MAX);
  roleBearing.set(enemy.id, target);
  return target;
}

/** Anti-bunching: if another live MANTIS is close in bearing, one of the pair gives way outward. */
function withCoordination(enemy: Enemy, target: number): number {
  const others = game.get().enemies.filter(
    (e) => e.kind === "MANTIS" && e.id !== enemy.id && e.state !== "DESTROYED" && e.state !== "RETREAT" && e.state !== "SPAWNING",
  );
  let adjusted = target;
  for (const other of others) {
    if (Math.abs(angleDiff(adjusted, other.bearing)) < CONVERGE_BEARING_GAP && enemy.id > other.id) {
      const away = angleDiff(adjusted, other.bearing) >= 0 ? 1 : -1;
      adjusted = wrapDeg(adjusted + away * CONVERGE_BEARING_GAP);
    }
  }
  return adjusted;
}

function distanceTargetFor(enemy: Enemy, role: Role): number {
  const cached = distanceTarget.get(enemy.id);
  if (cached !== undefined) return cached;
  const initial = role === "AGGRESSOR" ? AGGRESSOR_START_DISTANCE : role === "FLANKER" ? FLANKER_DISTANCE : SUPPRESSOR_DISTANCE;
  distanceTarget.set(enemy.id, initial);
  return initial;
}

function tickRetreat(enemy: Enemy, dt: number, now: number): void {
  const enteredAt = retreatEnteredAt.get(enemy.id) ?? now;
  const reachedSafe = enemy.distance >= RETREAT_SAFE_DISTANCE;
  if (!reachedSafe) {
    game.get().updateEnemy(enemy.id, {
      distance: Math.min(RETREAT_SAFE_DISTANCE, enemy.distance + 70 * dt),
      weakPointOpen: false,
    });
    return;
  }
  if (now - enteredAt >= RETREAT_REGROUP_MS) {
    // Re-engage: forget its old committed angle/range so it commits fresh, and gate re-retreat for a bit.
    roleBearing.delete(enemy.id);
    distanceTarget.delete(enemy.id);
    engagePhase.set(enemy.id, "APPROACH");
    phaseUntil.set(enemy.id, 0);
    retreatCooldownUntil.set(enemy.id, now + RETREAT_COOLDOWN_MS);
    enterState(enemy, "ATTACK");
    game.get().pushLog("WARN", `${enemy.codename} RE-ENGAGING`);
  }
}

function tickOne(enemy: Enemy, dt: number, now: number): void {
  if (enemy.state === "DESTROYED") {
    if (!destroyedAt.has(enemy.id)) destroyedAt.set(enemy.id, now);
    if (now - (destroyedAt.get(enemy.id) ?? now) >= DESTROY_LINGER_MS) {
      game.get().removeEnemy(enemy.id);
    }
    return;
  }

  // Incendiary burn: damage over time in 0.5 s chunks (one fx:hit per chunk, not per frame),
  // then the fields clear. Applies to the ace too, before boss.ts takes over its behaviour.
  if (enemy.burningUntil !== undefined && enemy.burnDps !== undefined) {
    const acc = (burnAccum.get(enemy.id) ?? 0) + enemy.burnDps * dt;
    const expired = now >= enemy.burningUntil;
    if (acc >= enemy.burnDps * BURN_CHUNK_S || expired) {
      burnAccum.delete(enemy.id);
      if (acc > 0) game.get().damageEnemy(enemy.id, acc);
      if (expired) game.get().updateEnemy(enemy.id, { burningUntil: undefined, burnDps: undefined });
      const after = game.get().enemies.find((e) => e.id === enemy.id);
      if (!after || after.state === "DESTROYED") return;
    } else {
      burnAccum.set(enemy.id, acc);
    }
  }

  // boss.ts owns all live-CRIMSON behavior; this FSM only clears its wreck once destroyed (handled above).
  if (enemy.kind === "CRIMSON") return;

  if (enemy.state === "SPAWNING") {
    const enteredAt = stateEnteredAt.get(enemy.id) ?? enemy.spawnAt;
    if (!stateEnteredAt.has(enemy.id)) stateEnteredAt.set(enemy.id, enemy.spawnAt);
    if (now - enteredAt >= SPAWNING_MS) enterState(enemy, "PATROL");
    return;
  }

  const hpPct = enemy.maxHp > 0 ? enemy.hp / enemy.maxHp : 0;
  const cooldownUntil = retreatCooldownUntil.get(enemy.id) ?? 0;
  if (hpPct < 0.25 && enemy.state !== "RETREAT" && now >= cooldownUntil) {
    enterState(enemy, "RETREAT");
    retreatEnteredAt.set(enemy.id, now);
  }

  if (enemy.state === "RETREAT") {
    tickRetreat(enemy, dt, now);
    return;
  }

  const role = roleFor(enemy);

  // Reaction to being targeted: one decisive break-off, not continuous jitter.
  const targeted = game.get().targetId === enemy.id;
  const previouslyTargeted = wasTargeted.get(enemy.id) ?? false;
  wasTargeted.set(enemy.id, targeted);

  let phase = engagePhase.get(enemy.id) ?? "APPROACH";
  let phaseEnd = phaseUntil.get(enemy.id) ?? 0;

  if (targeted && !previouslyTargeted) {
    phase = "BREAK";
    phaseEnd = now + 900 + Math.random() * 400;
    engagePhase.set(enemy.id, phase);
    phaseUntil.set(enemy.id, phaseEnd);
    const jinkMag = JINK_MIN_DEG + Math.random() * (JINK_MAX_DEG - JINK_MIN_DEG);
    const jink = Math.random() < 0.5 ? -jinkMag : jinkMag;
    // Jink relative to where it is now, but never further off the nose than the break cap allows.
    const jinkGoal = enemy.bearing + jink;
    breakBearing.set(enemy.id, Math.abs(jinkGoal) > BREAK_BEARING_MAX && Math.abs(jinkGoal) > Math.abs(enemy.bearing) ? enemy.bearing - jink : wrapDeg(jinkGoal));
    windupUntil.delete(enemy.id); // being shot at cancels a telegraphed shot in favor of breaking off
  }

  const persistentBearing = committedBearingFor(enemy, role);
  const bearingGoalRole = withCoordination(enemy, persistentBearing);
  let distGoal = distanceTargetFor(enemy, role);
  let bearingGoal = bearingGoalRole;
  let speed = 0;
  let ease = BEARING_EASE_HOLD;

  switch (phase) {
    case "APPROACH": {
      speed = REPOSITION_SPEED;
      ease = BEARING_EASE_APPROACH;
      const arrived = Math.abs(enemy.distance - distGoal) <= 6 && Math.abs(angleDiff(enemy.bearing, bearingGoalRole)) <= 6;
      if (arrived || now >= phaseEnd) {
        phase = "HOLD";
        phaseEnd = now + HOLD_MS[role];
        engagePhase.set(enemy.id, phase);
        phaseUntil.set(enemy.id, phaseEnd);
      }
      break;
    }
    case "HOLD": {
      speed = 0;
      ease = BEARING_EASE_HOLD;
      if (now >= phaseEnd) {
        if (role === "AGGRESSOR") {
          distGoal = Math.max(AGGRESSOR_MIN_DISTANCE, distGoal - AGGRESSOR_PUSH_STEP);
          distanceTarget.set(enemy.id, distGoal);
        }
        phase = "APPROACH";
        phaseEnd = now + 2600 + Math.random() * 900;
        engagePhase.set(enemy.id, phase);
        phaseUntil.set(enemy.id, phaseEnd);
      }
      break;
    }
    case "BREAK": {
      speed = BREAK_SPEED;
      ease = BEARING_EASE_BREAK;
      bearingGoal = breakBearing.get(enemy.id) ?? bearingGoalRole;
      distGoal = Math.min(RETREAT_SAFE_DISTANCE, distGoal + BREAK_DISTANCE_PAD);
      if (now >= phaseEnd) {
        phase = "APPROACH";
        phaseEnd = now + 1400;
        engagePhase.set(enemy.id, phase);
        phaseUntil.set(enemy.id, phaseEnd);
        breakBearing.delete(enemy.id);
      }
      break;
    }
  }

  // Mid-telegraph: frozen, holding a fixed bearing so an attentive pilot can read the wind-up.
  const winding = windupUntil.has(enemy.id);
  if (winding) {
    speed = 0;
    ease = 0;
  }

  // Ease along the short way round so a goal behind the pilot never drags the unit across the nose.
  const bearing = wrapDeg(enemy.bearing + angleDiff(bearingGoal, enemy.bearing) * Math.min(1, dt * ease));
  let distance = enemy.distance;
  if (speed > 0 && Math.abs(distance - distGoal) > 0.5) {
    const dir = distGoal > distance ? 1 : -1;
    distance = distance + dir * speed * dt;
    if ((dir === 1 && distance > distGoal) || (dir === -1 && distance < distGoal)) distance = distGoal;
  }

  let state = enemy.state;
  if (state === "PATROL" && distance <= 900) {
    enterState(enemy, "DETECT");
    state = "DETECT";
  }
  if (state === "DETECT") {
    const enteredAt = stateEnteredAt.get(enemy.id) ?? now;
    if (now - enteredAt >= DETECT_MS) {
      enterState(enemy, "ATTACK");
      state = "ATTACK";
    }
  }

  // Flanker reads as FLANK on the radar while it's still sweeping to its committed wide bearing,
  // and only becomes a firing ATTACK threat once it has actually arrived and held there.
  if (role === "FLANKER" && (state === "ATTACK" || state === "FLANK")) {
    const stillSweeping = phase === "APPROACH" && Math.abs(angleDiff(enemy.bearing, persistentBearing)) > FLANKER_SETTLE_DEG;
    state = stillSweeping ? "FLANK" : "ATTACK";
  }

  game.get().updateEnemy(enemy.id, { bearing, distance, state });

  if (state !== "ATTACK") return;

  // Weak-point window the co-pilot can call out.
  if (enemy.weakPointOpen) {
    const closeAt = weakPointCloseAt.get(enemy.id) ?? now;
    if (now >= closeAt) game.get().updateEnemy(enemy.id, { weakPointOpen: false });
  } else if (Math.random() < WEAKPOINT_CHANCE_PER_SEC * dt) {
    weakPointCloseAt.set(enemy.id, now + WEAKPOINT_DURATION_MS);
    game.get().updateEnemy(enemy.id, { weakPointOpen: true });
  }

  // Telegraphed fire: hold briefly at a fixed bearing, then land the shot.
  if (winding) {
    const closeAt = windupUntil.get(enemy.id) ?? now;
    if (now >= closeAt) {
      windupUntil.delete(enemy.id);
      const shots = (shotCount.get(enemy.id) ?? 0) + 1;
      shotCount.set(enemy.id, shots);
      game.get().updateEnemy(enemy.id, { lastFireAt: now });
      // Burning units lose ~30% accuracy: every third shot goes wide.
      if (enemy.burningUntil !== undefined && shots % 3 === 0) return;
      const damage =
        role === "AGGRESSOR" ? 5 + Math.random() * 6 : role === "SUPPRESSOR" ? 3 + Math.random() * 4 : 4 + Math.random() * 5;
      game.get().damagePlayer(damage, enemy.bearing);
    }
    return;

  }

  if (phase !== "BREAK" && now - enemy.lastFireAt >= FIRE_COOLDOWN_MS[role]) {
    windupUntil.set(enemy.id, now + WINDUP_MS[role]);
    // Genuinely dangerous only: an aggressor committing to a shot at its closest push range.
    if (role === "AGGRESSOR" && distGoal <= AGGRESSOR_MIN_DISTANCE + 20 && now - lastDangerAlertAt >= DANGER_ALERT_COOLDOWN_MS) {
      lastDangerAlertAt = now;
      bus.emit("hud:alert", { text: `${enemy.codename} CLOSING TO POINT-BLANK`, level: "WARN" });
    }
  }
}

/** Co-pilot callout: several MANTIS bunched on the same side of the pilot. Throttled so it stays rare. */
function checkConvergence(now: number): void {
  if (now - lastConvergeCalloutAt < CONVERGE_CALLOUT_COOLDOWN_MS) return;
  const living = game.get().enemies.filter(
    (e) => e.kind === "MANTIS" && e.state !== "DESTROYED" && e.state !== "SPAWNING" && e.state !== "RETREAT",
  );
  const left = living.filter((e) => e.bearing < -15 && e.distance < 900).length;
  const right = living.filter((e) => e.bearing > 15 && e.distance < 900).length;
  const side = left >= 3 ? "LEFT" : right >= 3 ? "RIGHT" : null;
  if (!side) return;
  const count = side === "LEFT" ? left : right;
  lastConvergeCalloutAt = now;
  game.get().pushLog("WARN", `${count} HOSTILES CONVERGING FROM YOUR ${side}`);
  bus.emit("hud:alert", { text: `HOSTILES CONVERGING — ${side}`, level: "WARN" });
}

export function tickEnemies(dt: number): void {
  try {
    const store = game.get();
    const now = Date.now();
    const player = store.player;

    // Passive player regen / heat shedding, scaled by stance.
    const heatShed = player.stance === "GUARD" ? 18 : 8;
    const energyRegen = player.stance === "EVADE" ? 4 : 7;
    const boostRegen = player.stance === "GUARD" ? 5 : player.stance === "EVADE" ? 3 : 8;
    store.setPlayer({
      heat: Math.max(0, player.heat - heatShed * dt),
      energy: Math.min(100, player.energy + energyRegen * dt),
      boost: Math.min(100, player.boost + boostRegen * dt),
    });

    for (const enemy of store.enemies) {
      try {
        tickOne(enemy, dt, now);
      } catch (err) {
        console.error(`[enemyAI] tick for ${enemy.id} threw`, err);
      }
    }

    checkConvergence(now);

    const liveIds = new Set(game.get().enemies.map((e) => e.id));
    for (const map of ALL_BOOKKEEPING) {
      for (const id of map.keys()) if (!liveIds.has(id)) map.delete(id);
    }
  } catch (err) {
    console.error("[enemyAI] tickEnemies threw", err);
  }
}
