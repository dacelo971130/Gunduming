/**
 * Tool definitions mirroring GameCommand, plus the mapping from a tool_use
 * block back into a typed GameCommand. Model output is untrusted — every
 * field is validated before it becomes a command.
 */
import type Anthropic from "@anthropic-ai/sdk";
import type { GameCommand, TargetSelector } from "@/game/types";

type ToolInput = Record<string, unknown>;

function asRecord(value: unknown): ToolInput {
  return value && typeof value === "object" ? (value as ToolInput) : {};
}

const SELECTOR_VALUES = [
  "NEAREST",
  "FARTHEST",
  "LEFT",
  "RIGHT",
  "FRONT",
  "REAR",
  "STRONGEST",
  "WEAKEST",
  "RED_ACE",
  "ID",
] as const;
type SelectorValue = (typeof SELECTOR_VALUES)[number];

function isSelectorValue(v: unknown): v is SelectorValue {
  return typeof v === "string" && (SELECTOR_VALUES as readonly string[]).includes(v);
}

function toTargetSelector(input: ToolInput): TargetSelector | null {
  const selector = input.selector;
  if (!isSelectorValue(selector)) return null;
  if (selector === "ID") {
    const id = input.id;
    if (typeof id !== "string" || id.length === 0) return null;
    return { type: "ID", id };
  }
  return { type: selector };
}

const ATTACK_MODES = ["BURST", "PRECISION", "BARRAGE"] as const;
type AttackMode = (typeof ATTACK_MODES)[number];
function isAttackMode(v: unknown): v is AttackMode {
  return typeof v === "string" && (ATTACK_MODES as readonly string[]).includes(v);
}

const BOOST_DIRECTIONS = ["FORWARD", "LEFT", "RIGHT", "BACK"] as const;
type BoostDirection = (typeof BOOST_DIRECTIONS)[number];
function isBoostDirection(v: unknown): v is BoostDirection {
  return typeof v === "string" && (BOOST_DIRECTIONS as readonly string[]).includes(v);
}

const SELECTOR_SCHEMA = {
  type: "string" as const,
  enum: [...SELECTOR_VALUES],
  description:
    "How to pick the enemy: NEAREST, FARTHEST, LEFT, RIGHT, FRONT, REAR, STRONGEST, WEAKEST, RED_ACE (the boss), or ID (use the id field).",
};

/** Tool set mirroring every non-NONE GameCommand action. */
export const COPILOT_TOOLS: Anthropic.Tool[] = [
  {
    name: "lock_target",
    description: "Lock the weapons onto an enemy, chosen by selection rule or explicit id.",
    input_schema: {
      type: "object",
      properties: {
        selector: SELECTOR_SCHEMA,
        id: { type: "string", description: "Enemy id — required only when selector is ID." },
      },
      required: ["selector"],
    },
  },
  {
    name: "attack",
    description: "Fire on the currently locked target.",
    input_schema: {
      type: "object",
      properties: {
        mode: {
          type: "string",
          enum: [...ATTACK_MODES],
          description: "BURST (default, balanced), PRECISION (single high-accuracy shot), BARRAGE (wide spread).",
        },
      },
    },
  },
  {
    name: "defend",
    description: "Raise defensive guard stance, reducing incoming damage.",
    input_schema: { type: "object", properties: {} },
  },
  {
    name: "evade",
    description: "Execute an evasive maneuver to dodge incoming fire.",
    input_schema: { type: "object", properties: {} },
  },
  {
    name: "boost",
    description: "Thruster boost, optionally in a direction, to reposition quickly.",
    input_schema: {
      type: "object",
      properties: {
        direction: {
          type: "string",
          enum: [...BOOST_DIRECTIONS],
          description: "Direction to boost. Defaults to FORWARD if omitted.",
        },
      },
    },
  },
  {
    name: "retreat",
    description: "Disengage and fall back from the fight.",
    input_schema: { type: "object", properties: {} },
  },
  {
    name: "analyze",
    description: "Analyze an enemy to reveal its detailed stats and any weak point.",
    input_schema: {
      type: "object",
      properties: {
        selector: SELECTOR_SCHEMA,
        id: { type: "string", description: "Enemy id — required only when selector is ID." },
      },
    },
  },
  {
    name: "scan",
    description: "Sweep the surrounding area for new contacts.",
    input_schema: { type: "object", properties: {} },
  },
  {
    name: "status_report",
    description: "Report current ship status — hp, armor, energy, boost, heat.",
    input_schema: { type: "object", properties: {} },
  },
  {
    name: "fire_special",
    description: "Fire the finishing special weapon, once charge allows it.",
    input_schema: { type: "object", properties: {} },
  },
];

/** Map one validated tool_use block into a typed GameCommand. Returns null for anything malformed. */
export function commandFromToolUse(name: string, rawInput: unknown): GameCommand | null {
  const input = asRecord(rawInput);
  switch (name) {
    case "lock_target": {
      const target = toTargetSelector(input);
      return target ? { action: "LOCK_TARGET", target } : null;
    }
    case "attack": {
      const mode = isAttackMode(input.mode) ? input.mode : undefined;
      return { action: "ATTACK", mode };
    }
    case "defend":
      return { action: "DEFEND" };
    case "evade":
      return { action: "EVADE" };
    case "boost": {
      const direction = isBoostDirection(input.direction) ? input.direction : undefined;
      return { action: "BOOST", direction };
    }
    case "retreat":
      return { action: "RETREAT" };
    case "analyze": {
      const target = toTargetSelector(input);
      return { action: "ANALYZE", target: target ?? undefined };
    }
    case "scan":
      return { action: "SCAN" };
    case "status_report":
      return { action: "STATUS_REPORT" };
    case "fire_special":
      return { action: "FIRE_SPECIAL" };
    default:
      return null;
  }
}
