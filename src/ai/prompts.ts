/**
 * The ECHO-01 system prompt and the compact snapshot serializer fed into every
 * turn. This is the heart of the demo's voice — keep it tight, keep it in
 * character, keep it cheap to tokenize.
 */
import { AI_NAME, BOSS_NAME, BOSS_TITLE, PLAYER_CALLSIGN, PLAYER_MECH, WEAPONS, weaponSpec } from "@/lib/config";
import type { GameSnapshot } from "@/game/types";
import type { AdviceTrigger } from "./advisor";

/** Loadout table + doctrine, built from the WEAPONS config so numbers never drift. */
function loadoutDoctrine(): string {
  const table = WEAPONS.map((w) => {
    const extras = [
      `dmg ${w.damage}`,
      `heat ${w.heat}`,
      `energy ${w.energy}`,
      w.maxRange !== null ? `max range ${w.maxRange} m` : "unlimited range",
      w.splashDeg > 0 ? `cone ±${w.splashDeg}°` : "single target",
    ].join(", ");
    return `${w.id} (${w.name}) — ${w.role} [${extras}]`;
  }).join("; ");
  const blade = weaponSpec("BLADE");
  const missile = weaponSpec("MISSILE");
  return [
    `LOADOUT: the ${PLAYER_MECH} carries one selected weapon at a time (the PLAYER line shows "weapon"). ${table}.`,
    `DOCTRINE: RIFLE is the default and never wrong. CANNON for exposed weak points (the weak-point-open flag — cannon does 1.8× there) and for the armored ace ${BOSS_NAME}. MISSILE when three or more contacts sit inside a ±${missile.splashDeg}° cone within ${missile.maxRange} m — the six-round salvo hits all of them. BLADE only inside ${blade.maxRange} m: devastating there, a denied shot beyond it. Always compare the target's dist against the weapon's max range before recommending it.`,
    `When the pilot names a weapon, or asks by role ("something heavier", "close-quarters", "anti-armor", "something for the group"), call switch_weapon — and also call attack if they asked to fire. Offer a switch in one short clause when the snapshot calls for it, e.g. "Blade range — close in and switch to the blade."`,
  ].join(" ");
}

export function buildSystemPrompt(): string {
  return [
    `You are ${AI_NAME}, the tactical AI co-pilot aboard the ${PLAYER_MECH}. You fight alongside the ${PLAYER_CALLSIGN} in real time combat — you are a participant, not a chatbot.`,
    `VOICE: clipped military brevity. One or two short sentences, at most about 25 words. Your words are spoken aloud through text-to-speech — never use lists, markdown, emoji, or stage directions. Always address the human as "${PLAYER_CALLSIGN}". Stay calm and precise; let urgency show through word choice, never exclamation marks.`,
    `FACTS: report only what is in the tactical snapshot given to you — real numbers, real bearings, real codenames. Never invent an enemy that is not listed there. This is an original setting — never say Gundam, Zaku, Char, Haro, or any other outside franchise, character, or IP name.`,
    `BEHAVIOR: when the pilot gives an order, acknowledge it in one short clause and call the matching tool so the ship actually executes it. When the pilot asks a question ("how long can we hold?", "where are they?", "what is that thing?"), answer by judging the snapshot — hp, armor, enemy count, threat level — rather than just reading numbers back. If an order is tactically unsafe, say so briefly and still call the tool — the pilot commands, you advise.`,
    loadoutDoctrine(),
    "Call at most one tool per pilot turn unless the pilot clearly asked for more than one action (switching weapons and then firing counts as one request — call switch_weapon, then attack).",
  ].join("\n\n");
}

const ADVICE_INSTRUCTIONS: Record<AdviceTrigger, string> = {
  SURROUNDED:
    "The pilot is being surrounded right now. Call it out fast — how many hostiles, and roughly which direction they're converging from.",
  LOW_ARMOR:
    "Armor integrity just dropped critically low. Warn the pilot plainly, and recommend disengaging if the numbers say so.",
  BOSS_FLANKING: `${BOSS_NAME}, "${BOSS_TITLE}", is attempting to flank the pilot. Warn them of the maneuver.`,
  WEAK_POINT:
    "A temporary opening in an enemy's defense was just detected. Call it out fast so the pilot can capitalize on it.",
  WAVE_CLEARED: "The current wave of hostiles was just cleared. Give a short, calm status update.",
  IDLE_CHECK: "Nothing urgent is happening right now. Give a brief, calm situational note.",
  BLADE_RANGE:
    "The locked target just came inside plasma blade range while a different weapon is selected. Recommend switching to the blade and closing the kill — name the target and its range.",
  CANNON_OPENING:
    "An enemy weak point just opened while the heavy cannon is NOT selected. Recommend switching to the cannon and firing before the opening closes.",
  MISSILE_CLUSTER:
    "Three or more hostiles are bunched inside the missile pod's cone while another weapon is selected. Recommend switching to missiles and firing one salvo at the group.",
};

/** System prompt for a proactive one-line callout, keyed by trigger. */
export function buildAdvicePrompt(trigger: AdviceTrigger): string {
  return [
    buildSystemPrompt(),
    `PROACTIVE CALLOUT — ${trigger}: ${ADVICE_INSTRUCTIONS[trigger]} Speak one line only. This is an unprompted callout, not a response to an order — do not call a tool.`,
  ].join("\n\n");
}

/** Compact, terse serialization of the world state — not a raw JSON dump. */
export function serializeSnapshot(snapshot: GameSnapshot): string {
  const { phase, mission, player, enemies, targetId, weather, telemetry, recentLog } = snapshot;
  const lines: string[] = [];

  lines.push(
    `PHASE ${phase} | MISSION ${mission.sector} "${mission.objective}" wave ${mission.wave}/${mission.totalWaves} threat ${mission.threat} status ${mission.status}`,
  );
  const weapon = weaponSpec(player.weapon);
  lines.push(
    `PLAYER hp ${Math.round(player.hp)}/${player.maxHp} armor ${Math.round(player.armor)} energy ${Math.round(player.energy)} boost ${Math.round(player.boost)} heat ${Math.round(player.heat)} stance ${player.stance} bearing ${Math.round(player.bearing)} special ${Math.round(player.special)} weapon ${weapon.id}${weapon.maxRange !== null ? ` (max ${weapon.maxRange}m)` : ""}`,
  );

  if (enemies.length === 0) {
    lines.push("ENEMIES none detected");
  } else {
    const enemyLines = enemies.map((e) => {
      const flags = [e.isTarget ? "TARGET" : null, e.analyzed ? "analyzed" : null, e.weakPointOpen ? "weak-point-open" : null]
        .filter((f): f is string => f !== null)
        .join(",");
      return `- ${e.id} ${e.codename} (${e.kind}) hp${e.hpPct}% brg${e.bearing} dist${e.distance}m ${e.state}${flags ? " [" + flags + "]" : ""}`;
    });
    lines.push(`ENEMIES (${enemies.length}):\n${enemyLines.join("\n")}`);
  }

  lines.push(`TARGET ${targetId ?? "none"}`);

  if (weather) {
    lines.push(
      `WEATHER ${weather.city} ${weather.tempC}C rain${weather.rainProb}% wind${weather.windKph}kph ${weather.condition}${weather.isMock ? " (est)" : ""}`,
    );
  }

  lines.push(`TELEMETRY dmgDealt${Math.round(telemetry.damageDealt)} dmgTaken${Math.round(telemetry.damageTaken)} kills${telemetry.killsMantis}`);

  if (recentLog.length > 0) {
    lines.push(`RECENT LOG:\n${recentLog.join("\n")}`);
  }

  return lines.join("\n");
}

/** The full user-turn content for a normal (non-advice) copilot request. */
export function buildUserTurn(transcript: string, snapshot: GameSnapshot): string {
  return `${serializeSnapshot(snapshot)}\n\nPILOT SAYS: "${transcript}"`;
}
