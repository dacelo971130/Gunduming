/**
 * The full offline brain. Deterministic, keyword-driven, zero network. This
 * is what the whole demo runs on with no API key — it has to be convincing
 * on its own.
 */
import { BOSS_NAME, weaponSpec, type WeaponId } from "@/lib/config";
import type { GameCommand, GameSnapshot, TargetSelector } from "@/game/types";
import type { CopilotReply } from "./client";

function pickTargetSelector(text: string): TargetSelector {
  if (/\bred ace\b|\bcrimson\b|\bboss\b|\bace\b/.test(text)) return { type: "RED_ACE" };
  if (/\bstrongest\b|\btoughest\b/.test(text)) return { type: "STRONGEST" };
  if (/\bweakest\b/.test(text)) return { type: "WEAKEST" };
  if (/\bfarthest\b|\bfurthest\b/.test(text)) return { type: "FARTHEST" };
  if (/\bleft\b/.test(text)) return { type: "LEFT" };
  if (/\bright\b/.test(text)) return { type: "RIGHT" };
  if (/\brear\b|\bbehind\b/.test(text)) return { type: "REAR" };
  if (/\bfront\b|\bahead\b/.test(text)) return { type: "FRONT" };
  return { type: "NEAREST" };
}

function pickAttackMode(text: string): "BURST" | "PRECISION" | "BARRAGE" | undefined {
  if (/\bprecision\b|\bsnipe\b|\bheadshot\b/.test(text)) return "PRECISION";
  if (/\bbarrage\b|\bspread\b|\ball(-|\s)?out\b/.test(text)) return "BARRAGE";
  if (/\bburst\b/.test(text)) return "BURST";
  return undefined;
}

function pickBoostDirection(text: string): "FORWARD" | "LEFT" | "RIGHT" | "BACK" | undefined {
  if (/\bleft\b/.test(text)) return "LEFT";
  if (/\bright\b/.test(text)) return "RIGHT";
  if (/\bback\b|\breverse\b/.test(text)) return "BACK";
  if (/\bforward\b|\bahead\b/.test(text)) return "FORWARD";
  return undefined;
}

/* --------------------------------------------------------------- weapons */

type WeaponSelection = WeaponId | "NEXT" | "PREVIOUS";

/**
 * Fuzzy weapon intent. The REFLEX matcher already catches the plain nouns
 * ("cannon", "missiles"); this is for the roundabout phrasing that reaches the
 * brain: "give me something heavier", "close-quarters weapon", "anti-armor",
 * "something for the group", "go back to the standard gun".
 */
function pickWeapon(text: string): WeaponSelection | null {
  if (/\bnukes?\b|\bnuclear\b|\bwarhead\b|\bwipe them (all )?out\b|\bbiggest (thing|gun) (we|you) (have|got)\b/.test(text)) return "NUKE";
  if (/\bincendiar(y|ies)\b|\bfire ?bombs?\b|\bnapalm\b|\bthermite\b|\bburn (them|it|him|everything)\b|\bset (them|it) on fire\b|\blight them up\b/.test(text)) return "INCENDIARY";
  if (/\bfleet\b|\bbattleship\b|\bfire support\b|\bfire mission\b|\borbital\b|\bartillery\b|\bnaval\b|\bcall (in )?(the )?(ship|support|big guns)\b|\bbring (in|down) the (ship|fleet|rain)\b/.test(text)) return "FLEET_CANNON";
  if (
    /\bcannons?\b|\bcanon\b|\bheav(y|ier|iest)\b|\bbig(ger|gest)? gun\b|\bmore punch\b|\banti[- ]?armou?r\b|\barmou?r[- ]?(break|pierc|bust)\w*\b|\bbreak (the |its |his )?(armou?r|shield)\b|\bhard(er|est)?[- ]hitting\b|\bsomething (big|strong)\w*\b/.test(text)
  ) {
    return "CANNON";
  }
  if (
    /\bmissiles?\b|\bmissles?\b|\brockets?\b|\bsalvo\b|\bcrowd\b|\bgroup\b|\bcluster\b|\bswarm\b|\ball of them\b|\bmultiple targets\b|\bhit them all\b|\barea (attack|weapon|damage)\b|\bsplash\b/.test(text)
  ) {
    return "MISSILE";
  }
  if (
    /\bblades?\b|\bswords?\b|\bmelee\b|\bclose[- ]?(quarters?|range|combat|in)\b|\bup close\b|\bknife\b|\bslash\b|\bcut (it|him|them) (down|up|open)\b|\bsab(er|re)\b|\bpoint[- ]blank\b/.test(text)
  ) {
    return "BLADE";
  }
  if (
    /\brifles?\b|\briffle\b|\blinear\b|\b(standard|default|basic|normal|regular|main|usual) (gun|weapon|loadout)\b|\bback to (the )?(standard|default|basic|rifle)\b/.test(text)
  ) {
    return "RIFLE";
  }
  if (/\b(previous|prev|last) (weapon|gun)s?\b|\bgo back a weapon\b|\bweapon back\b/.test(text)) return "PREVIOUS";
  if (
    /\b(next|swap|change|switch|cycle|other|another|different) (weapon|gun|loadout)s?\b|\bswitch weapons?\b|\bsomething else\b|\bcycle (it|through)\b/.test(text)
  ) {
    return "NEXT";
  }
  return null;
}

const FIRE_VERB = /\battack\b|\bfire\b|\bshoot\b|\bengage\b|\blaunch\b|\bstrike\b|\bslash\b|\bhit\b|\bopen up\b/;

const WEAPON_ROLE_LINE: Record<WeaponId, string> = {
  RIFLE: "Balanced and always ready.",
  CANNON: "Slow, but it breaks armor.",
  MISSILE: "Six rounds, everything in the cone.",
  BLADE: "Devastating inside two-sixty meters.",
  INCENDIARY: "Everything in the cone burns for six seconds.",
  NUKE: "One warhead. Nothing inside four-fifty meters.",
  FLEET_CANNON: "Battleship shells, three seconds out.",
};

/** Doctrine pick from the snapshot — what ECHO-01 would reach for right now, and why. */
function recommendWeapon(snapshot: GameSnapshot): { weapon: WeaponId; reason: string } {
  const enemies = snapshot.enemies;
  const target = enemies.find((e) => e.isTarget) ?? enemies[0];
  const blade = weaponSpec("BLADE");
  const missile = weaponSpec("MISSILE");

  const nuke = weaponSpec("NUKE");
  const nukeLeft = snapshot.player.ammo?.NUKE ?? nuke.ammo ?? 0;
  const farGroup = enemies.length >= 3 && enemies.every((e) => e.distance >= (nuke.minRange ?? 450));
  if (nukeLeft > 0 && farGroup) {
    return { weapon: "NUKE", reason: ` contacts all beyond  meters — one warhead takes the lot` };
  }
  const fleetReady = (snapshot.player.weaponReadyAt?.FLEET_CANNON ?? 0) <= Date.now();
  const staggeredAce = enemies.find((e) => e.kind === "CRIMSON" && (e.weakPointOpen || e.state === "STAGGERED"));
  const overwhelmed = enemies.length >= 3 && snapshot.player.hp / snapshot.player.maxHp < 0.5;
  if (fleetReady && (staggeredAce || overwhelmed)) {
    return { weapon: "FLEET_CANNON", reason: staggeredAce ? ` is staggered — fleet shells would land on an open target` : "we are outnumbered and hurt; the fleet can thin them out" };
  }
  if (target && blade.maxRange !== null && target.distance <= blade.maxRange) {
    return { weapon: "BLADE", reason: `${target.codename} is at ${target.distance} meters, inside blade range` };
  }
  const opening = enemies.find((e) => e.weakPointOpen);
  if (opening) {
    return { weapon: "CANNON", reason: `${opening.codename} has a weak point exposed` };
  }
  const inRange = enemies.filter((e) => missile.maxRange === null || e.distance <= missile.maxRange);
  const clustered = inRange.some(
    (anchor) => inRange.filter((e) => Math.abs(e.bearing - anchor.bearing) <= missile.splashDeg).length >= 3,
  );
  if (clustered) {
    return { weapon: "MISSILE", reason: "three or more contacts are bunched in the cone" };
  }
  if (enemies.some((e) => e.kind === "CRIMSON")) {
    return { weapon: "CANNON", reason: `${BOSS_NAME} is heavily armored` };
  }
  return { weapon: "RIFLE", reason: "nothing on scope calls for anything heavier" };
}

function switchSpeech(selection: WeaponSelection, snapshot: GameSnapshot): string {
  if (selection === "NEXT" || selection === "PREVIOUS") return "Cycling weapons, Pilot.";
  const spec = weaponSpec(selection);
  const name = spec.name.toLowerCase();
  const target = snapshot.enemies.find((e) => e.isTarget) ?? snapshot.enemies[0];
  if (target && spec.maxRange !== null && target.distance > spec.maxRange) {
    return `Switching to the ${name}, Pilot. ${target.codename} is at ${target.distance} meters — its reach is ${spec.maxRange}. Close in first.`;
  }
  return `Switching to the ${name}, Pilot. ${WEAPON_ROLE_LINE[selection]}`;
}

function threatAssessment(snapshot: GameSnapshot): string {
  const activeEnemies = snapshot.enemies.length;
  const hpPct = Math.round((snapshot.player.hp / snapshot.player.maxHp) * 100);
  if (activeEnemies === 0) return "No hostiles on scope, Pilot. We're clear for now.";
  if (hpPct < 30) return `Integrity critical at ${hpPct} percent with ${activeEnemies} contacts. I recommend disengaging.`;
  if (activeEnemies >= 3) return `${activeEnemies} contacts on scope, integrity holding at ${hpPct} percent. Stay sharp.`;
  return `${activeEnemies} contact${activeEnemies === 1 ? "" : "s"} tracked, integrity at ${hpPct} percent.`;
}

/** Deterministic keyword responder used whenever the NEURAL path is unavailable. */
export function mockReply(transcript: string, snapshot: GameSnapshot): CopilotReply {
  const text = transcript.toLowerCase();
  const commands: GameCommand[] = [];
  let speech: string;

  const weaponSel = pickWeapon(text);
  const wantsFire = FIRE_VERB.test(text);

  if (/\bwhich weapon\b|\bwhat weapon\b|\bbest weapon\b|\brecommend\b|\bwhat should i (use|fire|switch)\b|\bwhat do you suggest\b/.test(text)) {
    const pick = recommendWeapon(snapshot);
    const current = snapshot.player.weapon;
    speech =
      pick.weapon === current
        ? `Stay on the ${weaponSpec(current).name.toLowerCase()}, Pilot — ${pick.reason}.`
        : `Recommend the ${weaponSpec(pick.weapon).name.toLowerCase()}, Pilot — ${pick.reason}. Say the word and I'll switch.`;
  } else if (weaponSel && wantsFire) {
    // "fire the cannon" / "hit them with missiles": switch if needed, then fire.
    const resolved = weaponSel === "NEXT" || weaponSel === "PREVIOUS" ? null : weaponSel;
    if (!resolved || resolved !== snapshot.player.weapon) commands.push({ action: "SWITCH_WEAPON", weapon: weaponSel });
    commands.push({ action: "ATTACK", mode: pickAttackMode(text) });
    speech = resolved && resolved !== snapshot.player.weapon
      ? `Switching to the ${weaponSpec(resolved).name.toLowerCase()} and firing, Pilot.`
      : "Firing now, Pilot.";
  } else if (weaponSel) {
    commands.push({ action: "SWITCH_WEAPON", weapon: weaponSel });
    speech = switchSpeech(weaponSel, snapshot);
  } else if (/\b(face|look at|aim at|point at|turn to|turn towards?)\b/.test(text) && !/\bturn (left|right)\b/.test(text)) {
    if (/\b(red|crimson|ace|boss|strongest|weakest|nearest|closest|farthest|furthest|left|right|rear|behind|front|ahead)\b/.test(text)) {
      commands.push({ action: "LOCK_TARGET", target: pickTargetSelector(text) });
      speech = "Locking and turning to face, Pilot.";
    } else {
      commands.push({ action: "TURN", direction: "TARGET" });
      speech = "Turning to face the target, Pilot.";
    }
  } else if (/\bturn\b|\brotate\b|\bswing\b|\bcome (left|right|about)\b|\bbring (us|it|the nose) (around|left|right)\b/.test(text)) {
    const num = text.match(/\b(\d{1,3})\b/);
    const degrees = num ? Math.max(1, Math.min(180, Number(num[1]))) : undefined;
    if (/\baround\b|\babout\b|\bbehind\b/.test(text)) {
      commands.push({ action: "TURN", direction: "RIGHT", degrees: 180 });
      speech = "Coming about, Pilot.";
    } else if (/\bleft\b|\bport\b/.test(text)) {
      commands.push(degrees ? { action: "TURN", direction: "LEFT", degrees } : { action: "TURN", direction: "LEFT" });
      speech = "Turning left, Pilot.";
    } else if (/\bright\b|\bstarboard\b/.test(text)) {
      commands.push(degrees ? { action: "TURN", direction: "RIGHT", degrees } : { action: "TURN", direction: "RIGHT" });
      speech = "Turning right, Pilot.";
    } else {
      commands.push({ action: "TURN", direction: "TARGET" });
      speech = "Turning onto the target, Pilot.";
    }
  } else if (/\banaly[sz]e\b/.test(text)) {
    commands.push({ action: "ANALYZE", target: pickTargetSelector(text) });
    speech = "Analyzing target now, Pilot.";
  } else if (/\bscan\b|\bsweep\b/.test(text)) {
    commands.push({ action: "SCAN" });
    speech = "Sweeping the area, Pilot.";
  } else if (/\block\b|\btarget\b/.test(text)) {
    commands.push({ action: "LOCK_TARGET", target: pickTargetSelector(text) });
    speech = "Target locked, Pilot.";
  } else if (/\battack\b|\bfire\b|\bshoot\b|\bengage\b/.test(text)) {
    commands.push({ action: "ATTACK", mode: pickAttackMode(text) });
    speech = "Firing now, Pilot.";
  } else if (/\bdefend\b|\bguard\b|\bblock\b/.test(text)) {
    commands.push({ action: "DEFEND" });
    speech = "Raising guard, Pilot.";
  } else if (/\bevade\b|\bdodge\b/.test(text)) {
    commands.push({ action: "EVADE" });
    speech = "Evading, Pilot.";
  } else if (/\bboost\b|\bthrust(er)?\b/.test(text)) {
    commands.push({ action: "BOOST", direction: pickBoostDirection(text) });
    speech = "Boosting, Pilot.";
  } else if (/\bretreat\b|\bfall back\b|\bdisengage\b/.test(text)) {
    commands.push({ action: "RETREAT" });
    speech = "Falling back, Pilot.";
  } else if (/\bspecial\b|\bfinisher\b|\bnuke\b|\bult\b/.test(text)) {
    commands.push({ action: "FIRE_SPECIAL" });
    speech = "Special weapon charged. Firing.";
  } else if (/\bstatus\b|\breport\b|\bhold\b/.test(text)) {
    commands.push({ action: "STATUS_REPORT" });
    speech = threatAssessment(snapshot);
  } else if (/\bwhere\b/.test(text)) {
    const nearest = snapshot.enemies[0];
    speech = nearest
      ? `Nearest contact ${nearest.codename}, bearing ${nearest.bearing}, range ${nearest.distance} meters.`
      : "No contacts on scope right now, Pilot.";
  } else if (/\bwhat('s| is)\b|\bidentify\b/.test(text)) {
    const target = snapshot.enemies.find((e) => e.isTarget) ?? snapshot.enemies[0];
    speech = target
      ? `That's ${target.codename}, ${target.kind === "CRIMSON" ? "a high-threat ace unit" : "a standard hostile"} at ${target.hpPct} percent integrity.`
      : "Nothing identified yet, Pilot. Scanning.";
  } else {
    commands.push({ action: "NONE" });
    speech = threatAssessment(snapshot);
  }

  return { speech, commands, source: "MOCK" };
}
