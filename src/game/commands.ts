/**
 * The single funnel for every player action, local (REFLEX) or LLM (NEURAL).
 * Never throws — a bad or refused command returns { ok: false, speech: "…" }.
 */
import { game } from "@/game/store";
import { bus, say } from "@/lib/bus";
import type {
  CommandResult,
  CommandSource,
  Enemy,
  GameCommand,
  TargetSelector,
} from "@/game/types";

const HEAT_MAX = 100;

/* --------------------------------------------------------------- targets */

function livingEnemies(): Enemy[] {
  return game.get().enemies.filter((e) => e.state !== "DESTROYED");
}

function nearestOf(pool: Enemy[]): Enemy | null {
  if (pool.length === 0) return null;
  return pool.reduce((a, b) => (b.distance < a.distance ? b : a));
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

function doAttack(
  cmd: Extract<GameCommand, { action: "ATTACK" }>,
  source: CommandSource,
): { result: CommandResult; frontal?: boolean } {
  let target = currentTarget();
  let autoLockPrefix = "";
  if (!target) {
    target = resolveTarget({ type: "NEAREST" });
    if (!target) {
      return { result: { ok: false, action: "ATTACK", source, speech: "No hostile contacts in range." } };
    }
    game.get().setTarget(target.id);
    autoLockPrefix = `${target.codename} locked. `;
  }

  const mode = cmd.mode ?? "BURST";
  const cost = mode === "PRECISION" ? 14 : mode === "BARRAGE" ? 20 : 8;
  const heatGain = mode === "PRECISION" ? 20 : mode === "BARRAGE" ? 25 : 12;
  const baseDamage = mode === "PRECISION" ? 34 : mode === "BARRAGE" ? 16 : 22;

  const player = game.get().player;
  if (player.heat >= HEAT_MAX) {
    return { result: { ok: false, action: "ATTACK", source, speech: "Weapon systems overheated." } };
  }
  if (player.energy < cost) {
    return { result: { ok: false, action: "ATTACK", source, speech: "Insufficient energy." } };
  }

  const frontal = Math.abs(target.bearing) <= 30;
  game.get().setPlayer({
    energy: Math.max(0, player.energy - cost),
    heat: Math.min(HEAT_MAX, player.heat + heatGain),
  });

  bus.emit("fx:fire", { targetId: target.id, mode });

  let totalDamage = 0;
  const killed: string[] = [];
  const applyTo = (enemy: Enemy) => {
    const dmg = enemy.weakPointOpen ? baseDamage * 1.6 : baseDamage;
    const out = game.get().damageEnemy(enemy.id, dmg);
    totalDamage += dmg;
    if (out.killed) killed.push(enemy.codename);
  };

  applyTo(target);

  if (mode === "BARRAGE") {
    const splash = livingEnemies().filter(
      (e) => e.id !== target!.id && Math.abs(e.bearing - target!.bearing) <= 25,
    );
    for (const e of splash) applyTo(e);
  }

  // Special weapon charges from damage dealt.
  const p = game.get().player;
  game.get().setPlayer({ special: Math.min(100, p.special + totalDamage * 0.4) });

  bus.emit("hud:alert", {
    text: killed.length ? `${killed[0]} DESTROYED` : "TARGET HIT",
    level: killed.length ? "CRIT" : "INFO",
  });

  const verb = mode === "PRECISION" ? "Precision shot" : mode === "BARRAGE" ? "Barrage fired" : "Firing";
  const speech = `${autoLockPrefix}${verb} on ${target.codename}.`;

  return {
    result: {
      ok: true,
      action: "ATTACK",
      source,
      speech,
      hud: killed.length ? "TARGET DESTROYED" : undefined,
      detail: { targetId: target.id, damage: totalDamage, mode, killed },
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
