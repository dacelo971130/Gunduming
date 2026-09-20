/**
 * VOICE — the fast local path. Pure, synchronous, no I/O. Returning `null`
 * means "not a combat-critical verb" — that is the signal to escalate to the
 * LLM (NEURAL path). Keep this file dependency-free besides shared types.
 */
import { WAKE_WORDS } from "@/lib/config";
import type { GameCommand, TargetSelector } from "@/game/types";

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
    if (/\b(precision|aimed|careful)\b/.test(norm)) {
      return { action: "ATTACK", mode: "PRECISION" };
    }
    if (/\b(barrage|spread|everything)\b/.test(norm) || norm.includes("all of them")) {
      return { action: "ATTACK", mode: "BARRAGE" };
    }
    return { action: "ATTACK" };
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
