/**
 * VOICE — the fast local path. Pure regex matching, synchronous, no I/O.
 * Returning `null` means "not a combat-critical verb" — that is the signal to
 * escalate to the LLM (NEURAL path). The only state it reads is the selected
 * weapon (so "fire the cannon" can mean ATTACK when the cannon is already up),
 * and that read is guarded so the matcher can never throw.
 */
import { WAKE_WORDS } from "@/lib/config";
import { game } from "@/game/store";
import type { GameCommand, TargetSelector, WeaponId } from "@/game/types";

/* --------------------------------------------------------------- normalise */

function normalise(text: string): string {
  return text
    .toLowerCase()
    .replace(/['’]/g, "") // "what's" -> "whats" (no stray space)
    .replace(/[^a-z0-9\s]/g, " ")
    .replace(/\s+/g, " ")
    .trim();
}

function levenshtein(a: string, b: string): number {
  const m = a.length;
  const n = b.length;
  if (m === 0) return n;
  if (n === 0) return m;
  const dp: number[] = new Array(n + 1);
  for (let j = 0; j <= n; j++) dp[j] = j;
  for (let i = 1; i <= m; i++) {
    let prev = dp[0];
    dp[0] = i;
    for (let j = 1; j <= n; j++) {
      const tmp = dp[j];
      dp[j] = a[i - 1] === b[j - 1] ? prev : 1 + Math.min(prev, dp[j], dp[j - 1]);
      prev = tmp;
    }
  }
  return dp[n];
}

/* -------------------------------------------------------------- wake word */

/**
 * `src/lib/config.ts` is frozen, so a much wider net of mishearings lives
 * here instead — a loud venue means the recognizer rarely returns a clean
 * "echo". Both lists are matched together; nothing in config.ts needs to
 * change for this file to accept more variants.
 */
const EXTENDED_WAKE_WORDS = [
  "gundam", "gun dam", "gundum", "gandam", "gondam", "gun them", "gun dumb", "gun damn",
  "gundams", "gum dam", "kundam", "gun done", "gun down", "hey gundam", "ok gundam", "okay gundam",
  "echo", "eco", "ekko", "eko", "echoe", "echoes", "hello", "ago",
  "echo one", "echo 01", "acho", "eccho", "ok echo", "okay echo", "hey echo",
];

const ALL_WAKE_WORDS = Array.from(new Set([...WAKE_WORDS, ...EXTENDED_WAKE_WORDS]));

export function matchWakeWord(text: string): boolean {
  const norm = normalise(text);
  if (!norm) return false;
  if (ALL_WAKE_WORDS.some((w) => norm.includes(w))) return true;
  const leadingToken = norm.split(" ")[0] ?? "";
  if (!leadingToken) return false;
  // Noisy venues mangle short words badly — tolerate a wider edit distance
  // on just the leading token rather than the whole phrase.
  return ALL_WAKE_WORDS.some((w) => levenshtein(leadingToken, w.split(" ")[0]) <= 2);
}

function stripWakePrefix(norm: string): string {
  const tokens = norm.split(" ");
  if (tokens.length > 1 && ALL_WAKE_WORDS.includes(tokens[0])) {
    return tokens.slice(1).join(" ");
  }
  return norm;
}

/* ------------------------------------------------------------- selectors */

function parseSelector(text: string): TargetSelector {
  if (/\b(red|crimson|ace|boss)\b/.test(text)) return { type: "RED_ACE" };
  if (/\b(strongest|biggest)\b/.test(text)) return { type: "STRONGEST" };
  if (/\b(weakest|damaged)\b/.test(text)) return { type: "WEAKEST" };
  if (/\b(nearest|closest)\b/.test(text)) return { type: "NEAREST" };
  if (/\b(farthest|furthest)\b/.test(text)) return { type: "FARTHEST" };
  if (/\bleft\b/.test(text)) return { type: "LEFT" };
  if (/\bright\b/.test(text)) return { type: "RIGHT" };
  if (/\b(front|ahead)\b/.test(text) || text.includes("in front")) return { type: "FRONT" };
  if (/\b(behind|rear)\b/.test(text)) return { type: "REAR" };
  return { type: "NEAREST" };
}

function parseBoostDirection(text: string): "FORWARD" | "LEFT" | "RIGHT" | "BACK" | undefined {
  if (/\bleft\b/.test(text)) return "LEFT";
  if (/\bright\b/.test(text)) return "RIGHT";
  if (/\bback(ward)?\b/.test(text)) return "BACK";
  if (/\b(forward|ahead)\b/.test(text)) return "FORWARD";
  return undefined;
}

function parseAttackMode(text: string): "PRECISION" | "BARRAGE" | undefined {
  if (/\b(precision|aimed|careful)\b/.test(text)) return "PRECISION";
  if (/\b(barrage|spread|everything)\b/.test(text) || text.includes("all of them")) return "BARRAGE";
  return undefined;
}

/* --------------------------------------------------------------- weapons */

type WeaponSelection = WeaponId | "NEXT" | "PREVIOUS";

/**
 * Weapon nouns (with the usual speech-to-text mangling) and cycle phrases.
 * Named weapons win over "next/previous" so "switch weapon to cannon" is CANNON.
 *
 *   CANNON   cannon(s) · canon · heavy cannon · heavy gun · big gun
 *   NUKE     nuke(s) · nuclear · warhead · "fire the nuke"
 *   INCENDIARY incendiary · fire bomb(s) · firebomb · napalm · thermite · "burn them/it"
 *   FLEET_CANNON fire support · call (in) the fleet · fleet · battleship · fire mission · orbital · artillery
 *   MISSILE  missile(s) · missle(s) · missile pod · rocket(s)
 *   BLADE    blade(s) · sword(s) · melee · saber/sabre
 *   RIFLE    rifle(s) · riffle · linear (rifle)
 *   PREVIOUS previous/prev/last weapon(s)/gun(s)
 *   NEXT     next/swap/change/switch/cycle/other/another weapon(s)/gun(s)/loadout · switch weapons
 */
function parseWeapon(text: string): WeaponSelection | null {
  if (/\b(nukes?|nuclear|warhead)\b/.test(text)) return "NUKE";
  if (/\b(incendiar(y|ies)|fire ?bombs?|napalm|thermite)\b/.test(text) || /\bburn (them|it|him|everything|the (group|lot))\b/.test(text)) return "INCENDIARY";
  if (/\b(fleet|battleship|fire support|fire mission|orbital|artillery|naval gun)\b/.test(text)) return "FLEET_CANNON";
  if (/\b(cannons?|canon|heavy gun|big gun)\b/.test(text)) return "CANNON";
  if (/\b(missiles?|missles?|rockets?)\b/.test(text)) return "MISSILE";
  if (/\b(blades?|swords?|melee|saber|sabre)\b/.test(text)) return "BLADE";
  if (/\b(rifles?|riffle|linear)\b/.test(text)) return "RIFLE";
  if (/\b(previous|prev|last) (weapons?|guns?)\b/.test(text)) return "PREVIOUS";
  if (
    /\b(next|swap|change|switch|cycle|other|another|different) (weapons?|guns?|loadout)\b/.test(text) ||
    /\b(weapons?|guns?) (next|swap|change|switch|cycle)\b/.test(text)
  ) {
    return "NEXT";
  }
  return null;
}

/** Fire verbs that make sense with a weapon noun ("launch missiles", "blade strike"). */
const WEAPON_FIRE_VERB = /\b(fire|attack|shoot|engage|launch|strike|slash|cut|swing|hit|drop|release|call|burn)\b/;

function currentWeapon(): WeaponId | null {
  try {
    return game.get().player.weapon;
  } catch {
    return null;
  }
}

/* ------------------------------------------------------------------ turning */

const FACE_VERB = /\b(face|look at|point at|turn to|turn towards?|turn toward|aim at)\b/;
const TURN_VERB = /\b(turn|rotate)\b|\bswing (around|left|right)\b/;
const SELECTOR_WORD = /\b(red|crimson|ace|boss|strongest|biggest|weakest|damaged|nearest|closest|farthest|furthest|left|right|front|ahead|behind|rear)\b/;

function parseTurn(text: string): GameCommand | null {
  if (FACE_VERB.test(text)) {
    if (SELECTOR_WORD.test(text) && !/\bturn (left|right)\b/.test(text)) {
      return { action: "LOCK_TARGET", target: parseSelector(text) };
    }
    return { action: "TURN", direction: "TARGET" };
  }
  if (!TURN_VERB.test(text)) return null;
  if (/\baround\b|\babout\b/.test(text)) return { action: "TURN", direction: "RIGHT", degrees: 180 };
  const num = text.match(/\b(\d{1,3})\b/);
  const degrees = num ? Math.max(1, Math.min(180, Number(num[1]))) : undefined;
  if (/\bleft\b/.test(text)) return degrees ? { action: "TURN", direction: "LEFT", degrees } : { action: "TURN", direction: "LEFT" };
  if (/\bright\b/.test(text)) return degrees ? { action: "TURN", direction: "RIGHT", degrees } : { action: "TURN", direction: "RIGHT" };
  return { action: "TURN", direction: "TARGET" };
}

/* ------------------------------------------------------------------ match */

export function matchReflex(text: string): GameCommand | null {
  const raw = normalise(text);
  if (!raw) return null;
  const norm = stripWakePrefix(raw);
  if (!norm) return null;

  // FIRE_SPECIAL — check before ATTACK/STATUS so "finish it"/"full power" win.
  if (
    /\b(special|overdrive)\b/.test(norm) ||
    norm.includes("finish it") ||
    norm.includes("finish him") ||
    norm.includes("full power")
  ) {
    return { action: "FIRE_SPECIAL" };
  }

  // STATUS_REPORT
  if (
    /\b(status|report)\b/.test(norm) ||
    norm.includes("how are we") ||
    norm.includes("whats our status") ||
    norm.includes("how long can we hold")
  ) {
    return { action: "STATUS_REPORT" };
  }

  // ANALYZE — checked before SCAN so "scan that" resolves to ANALYZE.
  if (
    /\b(analyze|analyse|identify)\b/.test(norm) ||
    norm.includes("scan that") ||
    norm.includes("what is that")
  ) {
    return { action: "ANALYZE" };
  }

  // SCAN
  if (/\b(scan|radar)\b/.test(norm) || norm.includes("where are they")) {
    return { action: "SCAN" };
  }

  // RETREAT
  if (
    /\b(retreat|disengage)\b/.test(norm) ||
    norm.includes("fall back") ||
    norm.includes("pull back")
  ) {
    return { action: "RETREAT" };
  }

  // TURN — aiming. "face the target" / "look at it" faces the lock (nearest if
  // none); with a selector word ("look at the red one", "face the one on the
  // left") it becomes a LOCK, because a lock auto-faces its target. "turn left
  // 45" turns by degrees; "turn around" is 180; bare "turn" faces the target.
  const turnCmd = parseTurn(norm);
  if (turnCmd) return turnCmd;

  // SWITCH_WEAPON — a weapon noun anywhere in the phrase selects that weapon.
  // "fire the cannon" while the cannon is already up is an ATTACK; while another
  // weapon is up it switches (ECHO-01 answers "Heavy cannon ready." — say "fire" next).
  const weapon = parseWeapon(norm);
  if (weapon) {
    if (weapon !== "NEXT" && weapon !== "PREVIOUS" && WEAPON_FIRE_VERB.test(norm) && currentWeapon() === weapon) {
      const mode = parseAttackMode(norm);
      return mode ? { action: "ATTACK", mode } : { action: "ATTACK" };
    }
    return { action: "SWITCH_WEAPON", weapon };
  }

  // LOCK_TARGET — bare "lock"/"lock it" falls through parseSelector's NEAREST default.
  if (/\b(lock|target|acquire)\b/.test(norm)) {
    return { action: "LOCK_TARGET", target: parseSelector(norm) };
  }

  // ATTACK
  if (
    /\b(fire|attack|shoot|engage)\b/.test(norm) ||
    norm.includes("take it down") ||
    norm.includes("open fire")
  ) {
    const mode = parseAttackMode(norm);
    return mode ? { action: "ATTACK", mode } : { action: "ATTACK" };
  }

  // DEFEND
  if (/\b(defend|guard|block|brace)\b/.test(norm) || norm.includes("shields up")) {
    return { action: "DEFEND" };
  }

  // EVADE
  if (/\b(evade|dodge|juke)\b/.test(norm)) {
    return { action: "EVADE" };
  }

  // BOOST
  if (/\b(boost|thrusters?|burn|move)\b/.test(norm)) {
    const direction = parseBoostDirection(norm);
    return direction ? { action: "BOOST", direction } : { action: "BOOST" };
  }

  return null;
}
