/**
 * The only place that talks to the Anthropic API and the only place that
 * reads ANTHROPIC_API_KEY. Server-only — never import this from a "use
 * client" component. Every exported function is total: missing key, a
 * thrown SDK error, or a slow response (~5s) all fall back to the
 * deterministic mock brain instead of breaking the demo.
 */
import Anthropic from "@anthropic-ai/sdk";
import type { GameCommand, GameSnapshot } from "@/game/types";
import { buildAdvicePrompt, buildSystemPrompt, buildUserTurn, serializeSnapshot } from "./prompts";
import { COPILOT_TOOLS, commandFromToolUse } from "./tools";
import { mockReply } from "./mock";
import { ADVICE_FALLBACK_LINES, type AdviceTrigger } from "./advisor";

export interface CopilotReply {
  speech: string;
  commands: GameCommand[];
  source: "NEURAL" | "MOCK";
}

const MODEL_ID = "claude-sonnet-5";
const REQUEST_TIMEOUT_MS = 5000;
const MAX_TOKENS = 1024;
const ADVICE_MAX_TOKENS = 256;

function getClient(): Anthropic | null {
  const apiKey = process.env.ANTHROPIC_API_KEY;
  if (!apiKey) return null;
  return new Anthropic({ apiKey, timeout: REQUEST_TIMEOUT_MS, maxRetries: 0 });
}


/** Browser path: the route holds the key and returns the same CopilotReply shape. */
async function askCopilotOverHttp(
  transcript: string,
  snapshot: GameSnapshot,
): Promise<CopilotReply> {
  const abort = new AbortController();
  const timer = setTimeout(() => abort.abort(), REQUEST_TIMEOUT_MS + 1500);
  try {
    const res = await fetch("/api/copilot", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ transcript, snapshot }),
      signal: abort.signal,
    });
    if (!res.ok) return mockReply(transcript, snapshot);
    const data = (await res.json()) as Partial<CopilotReply>;
    return {
      speech: typeof data.speech === "string" ? data.speech : "",
      commands: Array.isArray(data.commands) ? data.commands : [],
      source: data.source === "NEURAL" ? "NEURAL" : "MOCK",
    };
  } catch {
    return mockReply(transcript, snapshot);
  } finally {
    clearTimeout(timer);
  }
}

/**
 * Ask ECHO-01 what to say and do this turn. Runs one round of tool calling —
 * every tool_use block Claude returns is mapped back into a GameCommand, and
 * any text blocks become the spoken line. Falls back to the deterministic
 * mock brain (HTTP 200, source: "MOCK") on a missing key, a thrown error, or
 * a timeout — the demo must never break because of the network.
 */
export async function askCopilot(transcript: string, snapshot: GameSnapshot): Promise<CopilotReply> {
  // The voice layer calls this from the browser, where the API key does not
  // and must not exist. There, go through the route; the SDK path below only
  // ever runs on the server.
  if (typeof window !== "undefined") return askCopilotOverHttp(transcript, snapshot);

  const client = getClient();
  if (!client) {
    console.error("[ai/client] ANTHROPIC_API_KEY is not set — falling back to MOCK");
    return mockReply(transcript, snapshot);
  }

  try {
    const response = await client.messages.create(
      {
        model: MODEL_ID,
        max_tokens: MAX_TOKENS,
        system: buildSystemPrompt(),
        tools: COPILOT_TOOLS,
        tool_choice: { type: "auto" },
        messages: [{ role: "user", content: buildUserTurn(transcript, snapshot) }],
      },
      { timeout: REQUEST_TIMEOUT_MS },
    );

    const commands: GameCommand[] = [];
    const speechParts: string[] = [];

    for (const block of response.content) {
      if (block.type === "text") {
        const trimmed = block.text.trim();
        if (trimmed) speechParts.push(trimmed);
      } else if (block.type === "tool_use") {
        const command = commandFromToolUse(block.name, block.input);
        if (command) commands.push(command);
      }
    }

    let speech = speechParts.join(" ").trim();
    if (!speech && commands.length === 0) {
      console.error("[ai/client] NEURAL reply had no speech and no commands — falling back to MOCK");
      return mockReply(transcript, snapshot);
    }
    if (!speech) speech = "Acknowledged, Pilot.";

    return { speech, commands, source: "NEURAL" };
  } catch (err) {
    console.error("[ai/client] NEURAL call failed — falling back to MOCK:", err);
    return mockReply(transcript, snapshot);
  }
}

export interface AdviceReply {
  speech: string;
  source: "NEURAL" | "MOCK";
}

/**
 * Server-side counterpart to advisor.ts's requestAdvice, used only by the
 * /api/copilot route when mode is "advice". Same total-function guarantee:
 * missing key / thrown error / timeout all fall back to the hand-written
 * line for that trigger.
 */
export async function askAdvice(trigger: AdviceTrigger, snapshot: GameSnapshot): Promise<AdviceReply> {
  const client = getClient();
  if (!client) {
    console.error("[ai/client] ANTHROPIC_API_KEY is not set — advice falling back to MOCK");
    return { speech: ADVICE_FALLBACK_LINES[trigger], source: "MOCK" };
  }

  try {
    const response = await client.messages.create(
      {
        model: MODEL_ID,
        max_tokens: ADVICE_MAX_TOKENS,
        system: buildAdvicePrompt(trigger),
        messages: [{ role: "user", content: serializeSnapshot(snapshot) }],
      },
      { timeout: REQUEST_TIMEOUT_MS },
    );

    const speech = response.content
      .filter((b): b is Anthropic.TextBlock => b.type === "text")
      .map((b) => b.text.trim())
      .join(" ")
      .trim();

    if (!speech) {
      console.error("[ai/client] advice reply was empty — falling back to MOCK");
      return { speech: ADVICE_FALLBACK_LINES[trigger], source: "MOCK" };
    }
    return { speech, source: "NEURAL" };
  } catch (err) {
    console.error(`[ai/client] advice call failed for ${trigger} — falling back to MOCK:`, err);
    return { speech: ADVICE_FALLBACK_LINES[trigger], source: "MOCK" };
  }
}
