/**
 * The full offline brain. Deterministic, keyword-driven, zero network. This
 * is what the whole demo runs on with no API key — it has to be convincing
 * on its own.
 */
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

  if (/\banaly[sz]e\b/.test(text)) {
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
