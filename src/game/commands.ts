/**
 * The single funnel for every player action, local (REFLEX) or LLM (NEURAL).
 * Never throws — a bad or refused command returns { ok: false, speech: "…" }.
 */
import { game } from "@/game/store";
import { bus, say, type AudioCue } from "@/lib/bus";
import { DEFAULT_WEAPON, WEAPONS, weaponSpec, type WeaponId, type WeaponSpec } from "@/lib/config";
import type {
  CommandResult,
  CommandSource,
  Enemy,
  GameCommand,
  Player,
  TargetSelector,
} from "@/game/types";

const HEAT_MAX = 100;
/** MISSILE fires this many rounds per ATTACK; each round hits everything in the cone. */
const MISSILE_SALVO_ROUNDS = 6;
/** BARRAGE widens whatever bearing cone the weapon already has by this many degrees. */
const BARRAGE_EXTRA_CONE_DEG = 25;
/** Weak-point multiplier: the cannon is the armor-breaker, everything else keeps the legacy bonus. */
const WEAK_POINT_MULT_CANNON = 1.8;
const WEAK_POINT_MULT_DEFAULT = 1.6;

const FIRE_CUE: Record<WeaponId, AudioCue> = {
  RIFLE: "FIRE",
  CANNON: "FIRE_CANNON",
  MISSILE: "FIRE_MISSILE",
  BLADE: "FIRE_BLADE",
  INCENDIARY: "FIRE_INCENDIARY",
  NUKE: "FIRE_NUKE",
  FLEET_CANNON: "FLEET_CALL",
};

/** NUKE: arming delay before the detonation, boss damage/stagger, and the hull shockwave. */
const NUKE_ARM_MS = 1200;
const NUKE_BOSS_DAMAGE = 250;
const NUKE_BOSS_STAGGER_MS = 3000;
const NUKE_SHOCKWAVE_RANGE = 650;
const NUKE_SHOCKWAVE_ARMOR = 6;

/* --------------------------------------------------------------- targets */

function livingEnemies(): Enemy[] {
  return game.get().enemies.filter((e) => e.state !== "DESTROYED");
}

function nearestOf(pool: Enemy[]): Enemy | null {
  if (pool.length === 0) return null;
  return pool.reduce((a, b) => (b.distance < a.distance ? b : a));
}

/** Smallest signed difference between two bearings, in degrees (-180..180]. */
function bearingDelta(a: number, b: number): number {
  return ((a - b + 540) % 360) - 180;
}

/** Resolve a TargetSelector against the live enemy roster. */
export function resolveTarget(selector: TargetSelector): Enemy | null {
  const enemies = livingEnemies();
  if (enemies.length === 0) return null;

  switch (selector.type) {
    case "ID":
      return enemies.find((e) => e.id === selector.id) ?? null;
    case "NEAREST":
      return enemies.reduce((a, b) => (b.distance < a.distance ? b : a));
    case "FARTHEST":
      return enemies.reduce((a, b) => (b.distance > a.distance ? b : a));
    case "LEFT": {
      const pool = enemies.filter((e) => e.bearing < -10);
      return nearestOf(pool.length ? pool : enemies);
    }
    case "RIGHT": {
      const pool = enemies.filter((e) => e.bearing > 10);
      return nearestOf(pool.length ? pool : enemies);
    }
    case "FRONT": {
      const pool = enemies.filter((e) => Math.abs(e.bearing) <= 30);
      return nearestOf(pool.length ? pool : enemies);
    }
    case "REAR": {
      const pool = enemies.filter((e) => Math.abs(e.bearing) > 120);
      return nearestOf(pool.length ? pool : enemies);
    }
    case "STRONGEST":
      return enemies.reduce((a, b) => (b.hp > a.hp ? b : a));
    case "WEAKEST":
      return enemies.reduce((a, b) => (b.hp < a.hp ? b : a));
    case "RED_ACE":
      return enemies.find((e) => e.kind === "CRIMSON") ?? null;
    default:
      return null;
  }
}

function currentTarget(): Enemy | null {
  const { targetId, enemies } = game.get();
  if (!targetId) return null;
  const e = enemies.find((x) => x.id === targetId);
  return e && e.state !== "DESTROYED" ? e : null;
}

/* --------------------------------------------------------------- weapons */

/** "HEAVY CANNON" → "Heavy cannon" for spoken lines. */
function spokenName(spec: WeaponSpec): string {
  const lower = spec.name.toLowerCase();
  return lower.charAt(0).toUpperCase() + lower.slice(1);
}

/** Resolve NEXT/PREVIOUS against the WEAPONS order; unknown ids fall back to the current weapon. */
function resolveWeapon(selection: WeaponId | "NEXT" | "PREVIOUS", current: WeaponId): WeaponId {
  const n = WEAPONS.length;
  const idx = Math.max(0, WEAPONS.findIndex((w) => w.id === current));
  if (selection === "NEXT") return WEAPONS[(idx + 1) % n].id;
  if (selection === "PREVIOUS") return WEAPONS[(idx - 1 + n) % n].id;
  return WEAPONS.some((w) => w.id === selection) ? selection : current;
}

/* ---------------------------------------------------------------- turning */

/** Wrap any angle to (-180, 180]. */
export function wrapDeg(deg: number): number {
  return ((deg + 540) % 360) - 180;
}

const LOCK_AUTO_FACE_DEG = 12;
const TURN_DEFAULT_DEG = 30;

/**
 * Rotate the AETHER FRAME by `deltaDeg` (+ = right). `player.bearing` is the
 * absolute heading; every `Enemy.bearing` is relative to the nose, so they all
 * shift by -delta. Emits `player:turned` so the AI modules can shift their
 * cached relative goals the same way. Used directly by the held-key path in
 * keyboard.ts (no log/telemetry spam) and by the TURN / LOCK_TARGET handlers.
 */
export function turnPlayer(deltaDeg: number): { delta: number; bearing: number } {
  const store = game.get();
  if (!Number.isFinite(deltaDeg) || deltaDeg === 0) return { delta: 0, bearing: store.player.bearing };
  const bearing = wrapDeg(store.player.bearing + deltaDeg);
  store.setPlayer({ bearing });
  for (const enemy of store.enemies) {
    store.updateEnemy(enemy.id, { bearing: wrapDeg(enemy.bearing - deltaDeg) });
  }
  bus.emit("player:turned", { delta: deltaDeg, bearing });
  return { delta: deltaDeg, bearing };
}

function doTurn(
  cmd: Extract<GameCommand, { action: "TURN" }>,
  source: CommandSource,
): CommandResult {
  if (cmd.direction === "TARGET") {
    let target = currentTarget();
    let prefix = "";
    if (!target) {
      target = resolveTarget({ type: "NEAREST" });
      if (!target) return { ok: false, action: "TURN", source, speech: "No hostile contacts to face." };
      game.get().setTarget(target.id);
      prefix = `${target.codename} locked. `;
    }
    const { bearing } = turnPlayer(target.bearing);
    bus.emit("hud:alert", { text: "FACING TARGET", level: "INFO" });
    const speech = `${prefix}Facing ${target.codename}.`;
    say(speech);
    return { ok: true, action: "TURN", source, speech, hud: "FACING TARGET", detail: { targetId: target.id, delta: target.bearing, bearing } };
  }

  const explicit = typeof cmd.degrees === "number" && Number.isFinite(cmd.degrees);
  const degrees = Math.max(1, Math.min(180, Math.abs(explicit ? (cmd.degrees as number) : TURN_DEFAULT_DEG)));
  const delta = cmd.direction === "LEFT" ? -degrees : degrees;
  const { bearing } = turnPlayer(delta);
  const word = cmd.direction.toLowerCase();
  const hud = `TURN ${cmd.direction}`;
  bus.emit("hud:alert", { text: hud, level: "INFO" });
  const speech = explicit ? `Turning ${word} ${Math.round(degrees)} degrees.` : `Turning ${word}.`;
  say(speech);
  return { ok: true, action: "TURN", source, speech, hud, detail: { delta, bearing } };
}

/* -------------------------------------------------------------- lock */

function doLockTarget(
  cmd: Extract<GameCommand, { action: "LOCK_TARGET" }>,
  source: CommandSource,
): CommandResult {
  const target = resolveTarget(cmd.target);
  if (!target) {
    return { ok: false, action: "LOCK_TARGET", source, speech: "No hostile contacts matching that description." };
  }
  game.get().setTarget(target.id);
  bus.emit("audio:cue", { cue: "LOCK" });
  bus.emit("hud:alert", { text: "TARGET LOCKED", level: "INFO" });
  // Aiming: a lock more than a few degrees off the nose swings the mech to face it.
  const offNose = Math.abs(target.bearing) > LOCK_AUTO_FACE_DEG;
  if (offNose) turnPlayer(target.bearing);
  const speech = offNose
    ? `Target locked. ${target.codename}, turning to face.`
    : `Target locked. ${target.codename}, bearing ${Math.round(target.bearing)} degrees.`;
  say(speech);
  return { ok: true, action: "LOCK_TARGET", source, speech, hud: "TARGET LOCKED", detail: { targetId: target.id, turned: offNose } };
}

/** "FLEET CANNON SUPPORT" → "Fleet cannon" for terse denials. */
function spokenShort(spec: WeaponSpec): string {
  switch (spec.id) {
    case "FLEET_CANNON":
      return "Fleet cannon";
    case "NUKE":
      return "Nuke";
    default:
      return spokenName(spec);
  }
}

/* --------------------------------------------------- ammo · cooldown · timers */

/** Rounds left for a limited-ammo weapon; `null` = unlimited. Missing entry = full magazine. */
function ammoLeft(player: Player, spec: WeaponSpec): number | null {
  if (spec.ammo === null) return null;
  return player.ammo?.[spec.id] ?? spec.ammo;
}

function spendAmmo(spec: WeaponSpec): number | null {
  const p = game.get().player;
  const left = ammoLeft(p, spec);
  if (left === null) return null;
  const next = Math.max(0, left - 1);
  game.get().setPlayer({ ammo: { ...(p.ammo ?? {}), [spec.id]: next } });
  return next;
}

function setReadyAt(spec: WeaponSpec, at: number): void {
  const p = game.get().player;
  game.get().setPlayer({ weaponReadyAt: { ...(p.weaponReadyAt ?? {}), [spec.id]: at } });
}

/** Why this weapon cannot fire right now (ammo / reload), or null when it can. */
function readinessDenial(player: Player, spec: WeaponSpec, now: number): string | null {
  const left = ammoLeft(player, spec);
  if (left !== null && left <= 0) return `${spokenName(spec)} expended.`;
  const readyAt = player.weaponReadyAt?.[spec.id] ?? 0;
  if (readyAt > now) return `${spokenShort(spec)} reloading, ${Math.ceil((readyAt - now) / 1000)} seconds.`;
  return null;
}

/**
 * Delayed effects (nuke arming, fleet shells in flight) must never land in a
 * different session: a store reset issues a fresh `telemetry.startedAt`, and a
 * phase outside COMBAT/BOSS means the fight is over.
 */
function scheduleEffect(ms: number, fn: () => void): void {
  const session = game.get().telemetry.startedAt;
  setTimeout(() => {
    const s = game.get();
    if (s.telemetry.startedAt !== session) return;
    if (s.phase !== "COMBAT" && s.phase !== "BOSS") return;
    try {
      fn();
    } catch (err) {
      console.error("[commands] delayed weapon effect threw", err);
    }
  }, ms);
}

/** The last HELD weapon the pilot selected — ORDNANCE/SUPPORT hand back to it. */
let lastHeldWeapon: WeaponId = DEFAULT_WEAPON;

function returnToHeldWeapon(from: WeaponId): string {
  const back = weaponSpec(lastHeldWeapon).kind === "HELD" ? lastHeldWeapon : DEFAULT_WEAPON;
  if (game.get().player.weapon !== from || back === from) return "";
  game.get().setPlayer({ weapon: back });
  bus.emit("weapon:changed", { weapon: back, previous: from });
  return ` Back on the ${weaponSpec(back).name.toLowerCase()}.`;
}

/** Everyone alive within `coneDeg` of `anchorBearing` (and inside `maxRange`, if any). */
function enemiesInCone(anchorBearing: number, coneDeg: number, maxRange: number | null): Enemy[] {
  return livingEnemies().filter(
    (e) => Math.abs(bearingDelta(e.bearing, anchorBearing)) <= coneDeg && (maxRange === null || e.distance <= maxRange),
  );
}

/* -------------------------------------------------------------- handlers */

function doSwitchWeapon(
  cmd: Extract<GameCommand, { action: "SWITCH_WEAPON" }>,
  source: CommandSource,
): CommandResult {
  const previous = game.get().player.weapon;
  const weapon = resolveWeapon(cmd.weapon, previous);
  const spec = weaponSpec(weapon);
  const explicit = cmd.weapon !== "NEXT" && cmd.weapon !== "PREVIOUS";

  if (weapon === previous) {
    // Naming a SUPPORT weapon that is already up is the call itself.
    if (explicit && spec.kind === "SUPPORT" && livingEnemies().length > 0) return doAttack({ action: "ATTACK" }, source).result;
    const speech = `${spokenName(spec)} already selected.`;
    return { ok: true, action: "SWITCH_WEAPON", source, speech, detail: { weapon, previous, changed: false } };
  }

  game.get().setPlayer({ weapon });
  if (spec.kind === "HELD") lastHeldWeapon = weapon;
  bus.emit("weapon:changed", { weapon, previous });
  bus.emit("audio:cue", { cue: "WEAPON_SWITCH" });
  bus.emit("hud:alert", { text: spec.name, level: "INFO" });

  // Selecting off-map support BY NAME is the fire mission ("call the fleet");
  // cycling onto it with Q/W only shows the slot — the pilot fires it with `f`.
  if (explicit && spec.kind === "SUPPORT" && livingEnemies().length > 0) {
    const out = doAttack({ action: "ATTACK" }, source).result;
    if (!out.ok) {
      const back = returnToHeldWeapon(weapon);
      const speech = `${out.speech}${back}`;
      say(speech);
      return { ...out, action: "SWITCH_WEAPON", speech, detail: { ...(out.detail ?? {}), weapon, previous } };
    }
    return { ...out, action: "SWITCH_WEAPON", detail: { ...(out.detail ?? {}), weapon, previous, changed: true } };
  }

  let speech = `${spokenName(spec)} ready.`;
  const left = ammoLeft(game.get().player, spec);
  if (left !== null) speech = `${spokenName(spec)} ready, ${left} ${left === 1 ? "round" : "rounds"}.`;
  const target = currentTarget();
  if (target && spec.maxRange !== null && target.distance > spec.maxRange) {
    speech += ` Target at ${Math.round(target.distance)} meters is outside its ${spec.maxRange} meter reach.`;
  } else if (target && spec.minRange !== undefined && target.distance < spec.minRange) {
    speech += ` Target at ${Math.round(target.distance)} meters is inside its ${spec.minRange} meter safety minimum.`;
  }
  say(speech);
  return {
    ok: true,
    action: "SWITCH_WEAPON",
    source,
    speech,
    hud: spec.name,
    detail: { weapon, previous, changed: true },
  };
}

/* ----------------------------------------------------------- fire modes */

interface FireOutcome {
  speech: string;
  hud?: string;
  detail: Record<string, unknown>;
}

/** Direct fire — the four HELD weapons and INCENDIARY: cone damage now, optional burn. */
function fireDirect(target: Enemy, spec: WeaponSpec, mode: "BURST" | "PRECISION" | "BARRAGE", now: number): FireOutcome {
  const weapon = spec.id;
  const dmgScale = mode === "PRECISION" ? 1.5 : mode === "BARRAGE" ? 0.72 : 1;
  const baseDamage = spec.damage * dmgScale;
  const coneDeg = spec.splashDeg + (mode === "BARRAGE" ? BARRAGE_EXTRA_CONE_DEG : 0);

  bus.emit("fx:fire", { targetId: target.id, mode, weapon });
  bus.emit("audio:cue", { cue: FIRE_CUE[weapon] });

  const splash = coneDeg > 0 ? enemiesInCone(target.bearing, coneDeg, spec.maxRange).filter((e) => e.id !== target.id) : [];
  const victims = [target, ...splash];
  const weakMult = weapon === "CANNON" ? WEAK_POINT_MULT_CANNON : WEAK_POINT_MULT_DEFAULT;
  const rounds = weapon === "MISSILE" ? (spec.rounds ?? MISSILE_SALVO_ROUNDS) : 1;

  let totalDamage = 0;
  const killed: string[] = [];
  const dead = new Set<string>();
  const hit = new Set<string>();
  for (let round = 0; round < rounds; round++) {
    for (const enemy of victims) {
      if (dead.has(enemy.id)) continue;
      const dmg = enemy.weakPointOpen ? baseDamage * weakMult : baseDamage;
      const out = game.get().damageEnemy(enemy.id, dmg);
      totalDamage += dmg;
      hit.add(enemy.id);
      if (out.killed) {
        killed.push(enemy.codename);
        dead.add(enemy.id);
      }
    }
  }

  // Incendiary: everything still standing in the cone keeps burning (enemyAI applies the DoT).
  let burning = 0;
  if (spec.burn) {
    for (const enemy of victims) {
      if (dead.has(enemy.id)) continue;
      game.get().updateEnemy(enemy.id, { burningUntil: now + spec.burn.ms, burnDps: spec.burn.dps });
      burning++;
    }
    if (burning > 0) bus.emit("audio:cue", { cue: "BURNING" });
  }

  const p = game.get().player;
  game.get().setPlayer({ special: Math.min(100, p.special + totalDamage * 0.4) });

  bus.emit("hud:alert", {
    text: killed.length > 1 ? `${killed.length} HOSTILES DESTROYED` : killed.length ? `${killed[0]} DESTROYED` : burning ? "TARGETS BURNING" : "TARGET HIT",
    level: killed.length ? "CRIT" : "INFO",
  });

  const others = hit.size - 1;
  let verb: string;
  switch (weapon) {
    case "CANNON":
      verb = mode === "PRECISION" ? "Heavy cannon, precision round" : "Heavy cannon fired";
      break;
    case "MISSILE":
      verb = others > 0 ? `Missile salvo away, ${others} more in the cone` : "Missile salvo away";
      break;
    case "BLADE":
      verb = "Blade strike";
      break;
    case "INCENDIARY":
      verb = burning > 0 ? `Incendiary shells on target, ${burning} burning` : "Incendiary shells";
      break;
    default:
      verb = mode === "PRECISION" ? "Precision shot" : mode === "BARRAGE" ? "Barrage fired" : "Firing";
  }

  return {
    speech: `${verb} on ${target.codename}.`,
    hud: killed.length ? "TARGET DESTROYED" : undefined,
    detail: { weapon, mode, rounds, damage: Math.round(totalDamage), hits: hit.size, burning, killed },
  };
}

/** TACTICAL NUKE — arm, then wipe the 90° cone. One per mission. */
function fireNuke(target: Enemy, spec: WeaponSpec): FireOutcome {
  const targetId = target.id;
  const absBearing = game.get().player.bearing + target.bearing;

  bus.emit("audio:cue", { cue: "NUKE_ARM" });
  bus.emit("hud:alert", { text: "NUCLEAR RELEASE — ARMING", level: "WARN" });
  game.get().pushLog("CRIT", `NUCLEAR RELEASE AUTHORIZED — DETONATION IN ${(NUKE_ARM_MS / 1000).toFixed(1)}s`);

  scheduleEffect(NUKE_ARM_MS, () => {
    const live = game.get().enemies.find((e) => e.id === targetId && e.state !== "DESTROYED");
    const anchor = live ? live.bearing : wrapDeg(absBearing - game.get().player.bearing);
    const victims = enemiesInCone(anchor, spec.splashDeg, spec.maxRange);
    const killed: string[] = [];
    let shockwave = false;
    let totalDamage = 0;
    for (const enemy of victims) {
      const dmg = enemy.kind === "CRIMSON" ? NUKE_BOSS_DAMAGE : spec.damage;
      const out = game.get().damageEnemy(enemy.id, dmg);
      totalDamage += dmg;
      if (enemy.distance < NUKE_SHOCKWAVE_RANGE) shockwave = true;
      if (out.killed) {
        killed.push(enemy.codename);
      } else if (enemy.kind === "CRIMSON") {
        // Staggered with the weak point open — boss.ts leaves an already-open point alone, so we close it ourselves.
        game.get().updateEnemy(enemy.id, { weakPointOpen: true, state: "STAGGERED" });
        scheduleEffect(NUKE_BOSS_STAGGER_MS, () => {
          const b = game.get().enemies.find((e) => e.id === enemy.id);
          if (b && b.state !== "DESTROYED" && b.weakPointOpen) game.get().updateEnemy(b.id, { weakPointOpen: false, state: "ATTACK" });
        });
      }
    }
    const p = game.get().player;
    game.get().setPlayer({
      special: Math.min(100, p.special + totalDamage * 0.4),
      armor: shockwave ? Math.max(0, p.armor - NUKE_SHOCKWAVE_ARMOR) : p.armor,
    });
    bus.emit("fx:nuke", { targetId, killed });
    bus.emit("audio:cue", { cue: "FIRE_NUKE" });
    bus.emit("hud:alert", { text: "NUCLEAR DETONATION", level: "CRIT" });
    bus.emit("hud:shake", { intensity: 1 });
    game.get().pushLog("CRIT", `NUCLEAR DETONATION — ${killed.length} DESTROYED${shockwave ? ` — SHOCKWAVE, ARMOR -${NUKE_SHOCKWAVE_ARMOR}` : ""}`);
    say(
      `Detonation. ${killed.length ? `${killed.length} hostile${killed.length === 1 ? "" : "s"} destroyed.` : "No kills confirmed."}${shockwave ? " Shockwave on the hull." : ""}`,
      "urgent",
    );
  });

  return {
    speech: "Nuclear release authorized. Brace.",
    hud: "NUCLEAR RELEASE",
    detail: { weapon: spec.id, targetId, armingMs: NUKE_ARM_MS, cone: spec.splashDeg },
  };
}

/** FLEET CANNON — call the battleship; shells land `delayMs` later around where the target is THEN. */
function fireFleet(target: Enemy, spec: WeaponSpec, now: number): FireOutcome {
  const targetId = target.id;
  const rounds = spec.rounds ?? 3;
  const delay = spec.delayMs ?? 3000;
  const absBearing = game.get().player.bearing + target.bearing;

  bus.emit("fx:fleetCall", { targetId, impactAtMs: now + delay, rounds });
  bus.emit("audio:cue", { cue: "FLEET_CALL" });
  bus.emit("hud:alert", { text: "FIRE MISSION — SHELLS INBOUND", level: "WARN" });
  game.get().pushLog("WARN", `FLEET FIRE MISSION — ${rounds} SHELLS, IMPACT IN ${(delay / 1000).toFixed(0)}s`);

  scheduleEffect(delay, () => {
    const live = game.get().enemies.find((e) => e.id === targetId && e.state !== "DESTROYED");
    const anchor = live ? live.bearing : wrapDeg(absBearing - game.get().player.bearing);
    const victims = enemiesInCone(anchor, spec.splashDeg, spec.maxRange);
    const killed: string[] = [];
    const dead = new Set<string>();
    let totalDamage = 0;
    for (let round = 0; round < rounds; round++) {
      for (const enemy of victims) {
        if (dead.has(enemy.id)) continue;
        const out = game.get().damageEnemy(enemy.id, spec.damage);
        totalDamage += spec.damage;
        if (out.killed) {
          killed.push(enemy.codename);
          dead.add(enemy.id);
        }
      }
    }
    const p = game.get().player;
    game.get().setPlayer({ special: Math.min(100, p.special + totalDamage * 0.4) });
    bus.emit("fx:fleetImpact", { targetId, killed });
    bus.emit("audio:cue", { cue: "FLEET_IMPACT" });
    bus.emit("hud:shake", { intensity: 0.8 });
    bus.emit("hud:alert", {
      text: killed.length > 1 ? `${killed.length} HOSTILES DESTROYED` : killed.length ? `${killed[0]} DESTROYED` : "SHELLS ON TARGET",
      level: killed.length ? "CRIT" : "WARN",
    });
    game.get().pushLog("CRIT", `FLEET SHELLS ON TARGET — ${victims.length} HIT, ${killed.length} DESTROYED`);
    say(`Shells on target. ${victims.length} hit${killed.length ? `, ${killed.length} destroyed` : ""}.`);
  });

  return {
    speech: "Fleet, fire mission, danger close.",
    hud: "FIRE MISSION",
    detail: { weapon: spec.id, targetId, rounds, impactInMs: delay },
  };
}

function doAttack(
  cmd: Extract<GameCommand, { action: "ATTACK" }>,
  source: CommandSource,
): { result: CommandResult; frontal?: boolean } {
  const deny = (speech: string, detail?: Record<string, unknown>) => {
    bus.emit("audio:cue", { cue: "DENY" });
    return { result: { ok: false, action: "ATTACK" as const, source, speech, detail } };
  };

  let target = currentTarget();
  let autoLockPrefix = "";
  if (!target) {
    target = resolveTarget({ type: "NEAREST" });
    if (!target) return { result: { ok: false, action: "ATTACK", source, speech: "No hostile contacts in range." } };
    game.get().setTarget(target.id);
    autoLockPrefix = `${target.codename} locked. `;
  }

  const now = Date.now();
  const player = game.get().player;
  const spec = weaponSpec(player.weapon);
  const weapon = spec.id;
  const mode = cmd.mode ?? "BURST";

  // Ammo / reload.
  const notReady = readinessDenial(player, spec, now);
  if (notReady) return deny(`${autoLockPrefix}${notReady}`, { weapon });

  // Reach — MISSILE, BLADE, INCENDIARY have a hard reach; NUKE a safety minimum.
  if (spec.maxRange !== null && target.distance > spec.maxRange) {
    const speech =
      `${autoLockPrefix}Target at ${Math.round(target.distance)} meters — ${weapon.toLowerCase().replace("_", " ")} range is ${spec.maxRange}. ` +
      "Close in or switch weapons.";
    return deny(speech, { targetId: target.id, weapon, distance: Math.round(target.distance), maxRange: spec.maxRange });
  }
  if (spec.minRange !== undefined && target.distance < spec.minRange) {
    const speech =
      weapon === "NUKE"
        ? `${autoLockPrefix}Too close for a nuclear release — ${spec.minRange} meter minimum. Back off or pick another target.`
        : `${autoLockPrefix}Target at ${Math.round(target.distance)} meters is inside the ${spec.minRange} meter safety minimum.`;
    return deny(speech, { targetId: target.id, weapon, distance: Math.round(target.distance), minRange: spec.minRange });
  }

  // Modes scale the weapon's base numbers (legacy rifle values: 22/12/8 → 34/20/14 → 16/25/20).
  const heatScale = mode === "PRECISION" ? 1.65 : mode === "BARRAGE" ? 2 : 1;
  const energyScale = mode === "PRECISION" ? 1.75 : mode === "BARRAGE" ? 2.5 : 1;
  const cost = Math.round(spec.energy * energyScale);
  const heatGain = Math.round(spec.heat * heatScale);

  if (player.heat >= HEAT_MAX) return deny("Weapon systems overheated.");
  if (player.energy < cost) return deny(`Insufficient energy for the ${weapon.toLowerCase().replace("_", " ")}.`);

  const frontal = Math.abs(target.bearing) <= 30;
  game.get().setPlayer({
    energy: Math.max(0, player.energy - cost),
    heat: Math.min(HEAT_MAX, player.heat + heatGain),
  });
  const ammoAfter = spendAmmo(spec);
  if (spec.cooldownMs > 0) setReadyAt(spec, now + spec.cooldownMs);

  let outcome: FireOutcome;
  if (weapon === "FLEET_CANNON") outcome = fireFleet(target, spec, now);
  else if (weapon === "NUKE") outcome = fireNuke(target, spec);
  else outcome = fireDirect(target, spec, mode, now);

  // Off-map support hands the trigger straight back; spent ordnance does too.
  let tail = "";
  if (spec.kind === "SUPPORT" || (spec.kind === "ORDNANCE" && ammoAfter === 0)) tail = returnToHeldWeapon(weapon);

  const speech = `${autoLockPrefix}${outcome.speech}${tail}`;
  if (weapon === "NUKE") say(speech, "urgent");

  return {
    result: {
      ok: true,
      action: "ATTACK",
      source,
      speech,
      hud: outcome.hud,
      detail: { targetId: target.id, ...outcome.detail, ammoLeft: ammoAfter },
    },
    frontal,
  };
}

function doDefend(source: CommandSource): CommandResult {
  game.get().setStance("GUARD");
  const player = game.get().player;
  game.get().setPlayer({
    armor: Math.min(100, player.armor + 4),
    heat: Math.max(0, player.heat - 15),
  });
  const speech = "Defensive stance engaged.";
  say(speech);
  return { ok: true, action: "DEFEND", source, speech, hud: "GUARD" };
}

function doEvade(source: CommandSource): CommandResult {
  const player = game.get().player;
  const cost = 18;
  if (player.boost < cost) {
    return { ok: false, action: "EVADE", source, speech: "Insufficient thruster charge to evade." };
  }
  game.get().setStance("EVADE");
  game.get().setPlayer({ boost: Math.max(0, player.boost - cost) });
  const speech = "Evasive maneuvers.";
  say(speech);
  return { ok: true, action: "EVADE", source, speech, hud: "EVADE" };
}

function doBoost(
  cmd: Extract<GameCommand, { action: "BOOST" }>,
  source: CommandSource,
): CommandResult {
  const player = game.get().player;
  const cost = 22;
  if (player.boost < cost) {
    return { ok: false, action: "BOOST", source, speech: "Insufficient thruster charge." };
  }
  game.get().setPlayer({ boost: Math.max(0, player.boost - cost) });
  game.get().setStance("NEUTRAL");

  // Reposition relative to the enemy formation — this is how the pilot breaks a frontal engagement.
  // Big enough to visibly slide the whole formation across the canopy (and push
  // the far side briefly out of the ±35° cone, where edge arrows take over);
  // small enough that the squad AI eases everyone back on screen within seconds.
  const swing = 30 + Math.random() * 15; // 30..45 degrees
  const dir = cmd.direction === "LEFT" ? -1 : cmd.direction === "RIGHT" ? 1 : Math.random() < 0.5 ? -1 : 1;
  for (const enemy of livingEnemies()) {
    let bearing = enemy.bearing - dir * swing;
    bearing = Math.max(-60, Math.min(60, bearing));
    const distance = cmd.direction === "BACK" ? enemy.distance + 60 : Math.max(150, enemy.distance - 40);
    game.get().updateEnemy(enemy.id, { bearing, distance });
  }

  bus.emit("audio:cue", { cue: "BOOST" });
  const speech = "Boosting.";
  say(speech);
  return { ok: true, action: "BOOST", source, speech, hud: "BOOST" };
}

function doRetreat(source: CommandSource): CommandResult {
  game.get().setStance("EVADE");
  for (const enemy of livingEnemies()) {
    game.get().updateEnemy(enemy.id, { distance: enemy.distance + 120 });
  }
  const speech = "Falling back.";
  say(speech);
  return { ok: true, action: "RETREAT", source, speech, hud: "RETREAT" };
}

function doAnalyze(
  cmd: Extract<GameCommand, { action: "ANALYZE" }>,
  source: CommandSource,
): CommandResult {
  const target = cmd.target ? resolveTarget(cmd.target) : currentTarget() ?? resolveTarget({ type: "NEAREST" });
  if (!target) {
    return { ok: false, action: "ANALYZE", source, speech: "No hostile contacts to analyze." };
  }
  game.get().updateEnemy(target.id, { analyzed: true });
  bus.emit("audio:cue", { cue: "ANALYZE" });
  const hpPct = Math.round((target.hp / target.maxHp) * 100);
  const weakHint = target.weakPointOpen
    ? "A weak point is exposed now — fire immediately."
    : "No weak point currently exposed.";
  const speech = `${target.codename}: ${hpPct} percent structural integrity, shield rating ${Math.round(target.shield * 100)} percent, status ${target.state}. ${weakHint}`;
  say(speech);
  return {
    ok: true,
    action: "ANALYZE",
    source,
    speech,
    hud: "ANALYSIS COMPLETE",
    detail: { targetId: target.id, hpPct, shield: target.shield, state: target.state, weakPointOpen: target.weakPointOpen },
  };
}

function doScan(source: CommandSource): CommandResult {
  const enemies = livingEnemies();
  if (enemies.length === 0) {
    const speech = "No hostile contacts.";
    say(speech);
    return { ok: true, action: "SCAN", source, speech };
  }
  const parts = enemies
    .slice()
    .sort((a, b) => a.distance - b.distance)
    .map((e) => `${e.codename} bearing ${Math.round(e.bearing)}, ${Math.round(e.distance)} meters`);
  const speech = `Scanning. ${enemies.length} hostile${enemies.length > 1 ? "s" : ""} detected. ${parts.join(". ")}.`;
  say(speech);
  return { ok: true, action: "SCAN", source, speech, hud: "SCANNING", detail: { count: enemies.length } };
}

function doStatusReport(source: CommandSource): CommandResult {
  const p = game.get().player;
  let judgement = "Structural integrity nominal.";
  if (p.hp < 30) judgement = "Armor critical, recommend disengaging.";
  else if (p.hp < 60) judgement = "Structural integrity compromised.";
  const speech = `Hull ${Math.round(p.hp)} percent, armor ${Math.round(p.armor)} percent, energy ${Math.round(p.energy)} percent, boost ${Math.round(p.boost)} percent. ${judgement}`;
  say(speech);
  return { ok: true, action: "STATUS_REPORT", source, speech, detail: { hp: p.hp, armor: p.armor, energy: p.energy, boost: p.boost } };
}

function doFireSpecial(source: CommandSource): { result: CommandResult; frontal?: boolean } {
  const player = game.get().player;
  if (player.special < 100) {
    return { result: { ok: false, action: "FIRE_SPECIAL", source, speech: "Special weapon not yet charged." } };
  }
  let target = currentTarget();
  if (!target) {
    target = resolveTarget({ type: "NEAREST" });
    if (!target) {
      return { result: { ok: false, action: "FIRE_SPECIAL", source, speech: "No hostile contacts in range." } };
    }
    game.get().setTarget(target.id);
  }
  const damage = target.weakPointOpen ? 200 : 140;
  const { killed } = game.get().damageEnemy(target.id, damage);
  game.get().setPlayer({ special: 0 });
  bus.emit("fx:special", { targetId: target.id });
  bus.emit("audio:cue", { cue: "SPECIAL" });
  bus.emit("hud:alert", { text: killed ? `${target.codename} DESTROYED` : "SPECIAL WEAPON FIRED", level: "CRIT" });
  const speech = `Full power discharge on ${target.codename}.`;
  say(speech, "urgent");
  const frontal = Math.abs(target.bearing) <= 30;
  return {
    result: { ok: true, action: "FIRE_SPECIAL", source, speech, hud: "SPECIAL WEAPON FIRED", detail: { targetId: target.id, damage } },
    frontal,
  };
}

function doNone(source: CommandSource): CommandResult {
  return { ok: false, action: "NONE", source, speech: "" };
}

/* ------------------------------------------------------------------ main */

export function executeCommand(cmd: GameCommand, source: CommandSource): CommandResult {
  let result: CommandResult;
  let frontal: boolean | undefined;

  try {
    switch (cmd.action) {
      case "LOCK_TARGET":
        result = doLockTarget(cmd, source);
        break;
      case "ATTACK": {
        const out = doAttack(cmd, source);
        result = out.result;
        frontal = out.frontal;
        break;
      }
      case "SWITCH_WEAPON":
        result = doSwitchWeapon(cmd, source);
        break;
      case "TURN":
        result = doTurn(cmd, source);
        break;
      case "DEFEND":
        result = doDefend(source);
        break;
      case "EVADE":
        result = doEvade(source);
        break;
      case "BOOST":
        result = doBoost(cmd, source);
        break;
      case "RETREAT":
        result = doRetreat(source);
        break;
      case "ANALYZE":
        result = doAnalyze(cmd, source);
        break;
      case "SCAN":
        result = doScan(source);
        break;
      case "STATUS_REPORT":
        result = doStatusReport(source);
        break;
      case "FIRE_SPECIAL": {
        const out = doFireSpecial(source);
        result = out.result;
        frontal = out.frontal;
        break;
      }
      case "NONE":
      default:
        result = doNone(source);
        break;
    }
  } catch (err) {
    console.error("[commands] executeCommand threw", err);
    result = { ok: false, action: cmd.action, source, speech: "Command failed." };
  }

  game.get().recordCommand(cmd.action, cmd.action === "ATTACK" ? frontal : undefined);
  game.get().pushLog("PILOT", `${cmd.action}${result.ok ? "" : " (denied)"}: ${result.speech || "—"}`);
  bus.emit("cmd:executed", { command: cmd, result });
  return result;
}
