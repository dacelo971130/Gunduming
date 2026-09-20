/**
 * The single funnel for every player action, local (REFLEX) or LLM (NEURAL).
 * Never throws — a bad or refused command returns { ok: false, speech: "…" }.
 */
import { game } from "@/game/store";
import { bus, say, type AudioCue } from "@/lib/bus";
import { WEAPONS, weaponSpec, type WeaponId, type WeaponSpec } from "@/lib/config";
import type {
  CommandResult,
  CommandSource,
  Enemy,
  GameCommand,
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
};

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

/* -------------------------------------------------------------- handlers */

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
  const speech = `Target locked. ${target.codename}, bearing ${Math.round(target.bearing)} degrees.`;
  say(speech);
  return { ok: true, action: "LOCK_TARGET", source, speech, hud: "TARGET LOCKED", detail: { targetId: target.id } };
}

function doSwitchWeapon(
  cmd: Extract<GameCommand, { action: "SWITCH_WEAPON" }>,
  source: CommandSource,
): CommandResult {
  const previous = game.get().player.weapon;
  const weapon = resolveWeapon(cmd.weapon, previous);
  const spec = weaponSpec(weapon);

  if (weapon === previous) {
    const speech = `${spokenName(spec)} already selected.`;
    return { ok: true, action: "SWITCH_WEAPON", source, speech, detail: { weapon, previous, changed: false } };
  }

  game.get().setPlayer({ weapon });
  bus.emit("weapon:changed", { weapon, previous });
  bus.emit("audio:cue", { cue: "WEAPON_SWITCH" });
  bus.emit("hud:alert", { text: spec.name, level: "INFO" });

  let speech = `${spokenName(spec)} ready.`;
  const target = currentTarget();
  if (target && spec.maxRange !== null && target.distance > spec.maxRange) {
    speech += ` Target at ${Math.round(target.distance)} meters is outside its ${spec.maxRange} meter reach.`;
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

function doAttack(
  cmd: Extract<GameCommand, { action: "ATTACK" }>,
  source: CommandSource,
): { result: CommandResult; frontal?: boolean } {
  const deny = (speech: string, detail?: Record<string, unknown>) => ({
    result: { ok: false, action: "ATTACK" as const, source, speech, detail },
  });

  let target = currentTarget();
  let autoLockPrefix = "";
  if (!target) {
    target = resolveTarget({ type: "NEAREST" });
    if (!target) return deny("No hostile contacts in range.");
    game.get().setTarget(target.id);
    autoLockPrefix = `${target.codename} locked. `;
  }

  const player = game.get().player;
  const spec = weaponSpec(player.weapon);
  const weapon = spec.id;
  const mode = cmd.mode ?? "BURST";

  // Range gate — MISSILE and BLADE have a hard reach; say what to do about it.
  if (spec.maxRange !== null && target.distance > spec.maxRange) {
    bus.emit("audio:cue", { cue: "DENY" });
    const speech =
      `${autoLockPrefix}Target at ${Math.round(target.distance)} meters — ${weapon.toLowerCase()} range is ${spec.maxRange}. ` +
      "Close in or switch weapons.";
    return deny(speech, { targetId: target.id, weapon, distance: Math.round(target.distance), maxRange: spec.maxRange });
  }

  // Modes scale the weapon's base numbers (legacy rifle values: 22/12/8 → 34/20/14 → 16/25/20).
  const dmgScale = mode === "PRECISION" ? 1.5 : mode === "BARRAGE" ? 0.72 : 1;
  const heatScale = mode === "PRECISION" ? 1.65 : mode === "BARRAGE" ? 2 : 1;
  const energyScale = mode === "PRECISION" ? 1.75 : mode === "BARRAGE" ? 2.5 : 1;
  const cost = Math.round(spec.energy * energyScale);
  const heatGain = Math.round(spec.heat * heatScale);
  const baseDamage = spec.damage * dmgScale;

  if (player.heat >= HEAT_MAX) return deny("Weapon systems overheated.");
  if (player.energy < cost) return deny(`Insufficient energy for the ${weapon.toLowerCase()}.`);

  const frontal = Math.abs(target.bearing) <= 30;
  game.get().setPlayer({
    energy: Math.max(0, player.energy - cost),
    heat: Math.min(HEAT_MAX, player.heat + heatGain),
  });

  bus.emit("fx:fire", { targetId: target.id, mode, weapon });
  bus.emit("audio:cue", { cue: FIRE_CUE[weapon] });

  // Everyone in the bearing cone around the target (and inside the weapon's reach) takes the hit.
  const coneDeg = spec.splashDeg + (mode === "BARRAGE" ? BARRAGE_EXTRA_CONE_DEG : 0);
  const anchor = target;
  const splash =
    coneDeg > 0
      ? livingEnemies().filter(
          (e) =>
            e.id !== anchor.id &&
            Math.abs(bearingDelta(e.bearing, anchor.bearing)) <= coneDeg &&
            (spec.maxRange === null || e.distance <= spec.maxRange),
        )
      : [];
  const victims = [target, ...splash];

  const weakMult = weapon === "CANNON" ? WEAK_POINT_MULT_CANNON : WEAK_POINT_MULT_DEFAULT;
  const rounds = weapon === "MISSILE" ? MISSILE_SALVO_ROUNDS : 1;

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

  // Special weapon charges from damage dealt.
  const p = game.get().player;
  game.get().setPlayer({ special: Math.min(100, p.special + totalDamage * 0.4) });

  bus.emit("hud:alert", {
    text: killed.length > 1 ? `${killed.length} HOSTILES DESTROYED` : killed.length ? `${killed[0]} DESTROYED` : "TARGET HIT",
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
    default:
      verb = mode === "PRECISION" ? "Precision shot" : mode === "BARRAGE" ? "Barrage fired" : "Firing";
  }
  const speech = `${autoLockPrefix}${verb} on ${target.codename}.`;

  return {
    result: {
      ok: true,
      action: "ATTACK",
      source,
      speech,
      hud: killed.length ? "TARGET DESTROYED" : undefined,
      detail: {
        targetId: target.id,
        weapon,
        mode,
        rounds,
        damage: Math.round(totalDamage),
        hits: hit.size,
        killed,
      },
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
