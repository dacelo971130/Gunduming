/**
 * Proactive co-pilot lines. Called by the engine when something noteworthy
 * happens (SURROUNDED, LOW_ARMOR, ...). Goes through the same /api/copilot
 * route as normal orders (mode: "advice"), so the API key never has to be
 * read from this file. Never throws — always resolves to a usable string,
 * "" meaning "stay silent right now" (rate-limited or already speaking).
 */
import type { GameSnapshot } from "@/game/types";
import { game } from "@/game/store";

export type AdviceTrigger =
  | "SURROUNDED"
  | "LOW_ARMOR"
  | "BOSS_FLANKING"
  | "WEAK_POINT"
  | "WAVE_CLEARED"
  | "IDLE_CHECK";

/** Hand-written fallback line per trigger, used whenever the LLM is unavailable. */
export const ADVICE_FALLBACK_LINES: Record<AdviceTrigger, string> = {
  SURROUNDED: "Pilot, three hostiles are converging from your left.",
  LOW_ARMOR: "Armor integrity is below thirty percent. I recommend disengaging.",
  BOSS_FLANKING: "Warning. Crimson-01 is attempting a flanking maneuver.",
  WEAK_POINT: "I detected a temporary opening in the enemy's defense.",
  WAVE_CLEARED: "Wave cleared, Pilot. Systems nominal — stand by for the next contact.",
  IDLE_CHECK: "All quiet, Pilot. No immediate threats on scope.",
};

const RATE_LIMIT_MS = 8000;
const ADVICE_TIMEOUT_MS = 5000;

let lastAdviceAt = 0;

interface AdviceResponseBody {
  speech?: unknown;
}

/**
 * Request one spoken proactive line for `trigger`. Rate-limited to roughly
 * one line every 8s, and suppressed entirely while the AI is already
 * speaking. Returns "" when suppressed — callers should treat that like
 * `say("")`, i.e. a no-op.
 */
export async function requestAdvice(trigger: AdviceTrigger, snapshot: GameSnapshot): Promise<string> {
  const now = Date.now();
  const aiStatus = game.get().aiStatus;
  if (aiStatus === "SPEAKING") return "";
  if (now - lastAdviceAt < RATE_LIMIT_MS) return "";

  const controller = typeof AbortController !== "undefined" ? new AbortController() : null;
  const timer = controller ? setTimeout(() => controller.abort(), ADVICE_TIMEOUT_MS) : null;

  try {
    const res = await fetch("/api/copilot", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ transcript: "", snapshot, mode: "advice", trigger }),
      signal: controller ? controller.signal : undefined,
    });
    if (!res.ok) throw new Error(`advice request failed with status ${res.status}`);
    const data = (await res.json()) as AdviceResponseBody;
    const speech = typeof data.speech === "string" && data.speech.trim().length > 0 ? data.speech.trim() : ADVICE_FALLBACK_LINES[trigger];
    lastAdviceAt = now;
    return speech;
  } catch (err) {
    console.error(`[ai/advisor] advice request failed for ${trigger}, using fallback line:`, err);
    lastAdviceAt = now;
    return ADVICE_FALLBACK_LINES[trigger];
  } finally {
    if (timer) clearTimeout(timer);
  }
}
