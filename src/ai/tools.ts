/**
 * Tool definitions mirroring GameCommand, plus the mapping from a tool_use
 * block back into a typed GameCommand. Model output is untrusted — every
 * field is validated before it becomes a command.
 */
import type Anthropic from "@anthropic-ai/sdk";
import { WEAPONS } from "@/lib/config";
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

const TURN_DIRECTIONS = ["LEFT", "RIGHT", "TARGET"] as const;
type TurnDirection = (typeof TURN_DIRECTIONS)[number];
function isTurnDirection(v: unknown): v is TurnDirection {
  return typeof v === "string" && (TURN_DIRECTIONS as readonly string[]).includes(v);
}

const WEAPON_CHOICES = [...WEAPONS.map((w) => w.id), "NEXT", "PREVIOUS"] as const;
type WeaponChoice = (typeof WEAPON_CHOICES)[number];
function isWeaponChoice(v: unknown): v is WeaponChoice {
  return typeof v === "string" && (WEAPON_CHOICES as readonly string[]).includes(v);
}

const SELECTOR_SCHEMA = {
  type: "string" as const,
  enum: [...SELECTOR_VALUES],
  description:
    "How to pick the enemy: NEAREST, FARTHEST, LEFT, RIGHT, FRONT, REAR, STRONGEST, WEAKEST, RED_ACE (the boss), or ID (use the id field).",
};

const WEAPON_SCHEMA = {
  type: "string" as const,
  enum: [...WEAPON_CHOICES],
  description:
    WEAPONS.map((w) => `${w.id} = ${w.name}: ${w.role}`).join(" | ") +
    " | NEXT / PREVIOUS cycle the loadout in that order.",
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
    description:
      "Fire the currently selected weapon on the locked target (auto-locks the nearest if none). Call switch_weapon first when the pilot names a different weapon.",
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
    name: "switch_weapon",
    description:
      "Select a weapon from the AETHER FRAME loadout, or cycle NEXT/PREVIOUS. Use when the pilot names a weapon or asks for one by role (heavier, close-quarters, anti-armor, something for a group).",
    input_schema: {
      type: "object",
      properties: { weapon: WEAPON_SCHEMA },
      required: ["weapon"],
    },
  },
  {
    name: "turn",
    description:
      "Rotate the mech to aim. LEFT/RIGHT by `degrees` (default 30), or TARGET to face the locked target (nearest if none) so its relative bearing becomes 0. lock_target already auto-faces a target more than 12 degrees off the nose.",
    input_schema: {
      type: "object",
      properties: {
        direction: { type: "string", enum: [...TURN_DIRECTIONS], description: "LEFT, RIGHT, or TARGET (face the locked target)." },
        degrees: { type: "number", description: "How far to turn for LEFT/RIGHT, 1-180. Ignored for TARGET." },
      },
      required: ["direction"],
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
    case "switch_weapon":
      return isWeaponChoice(input.weapon) ? { action: "SWITCH_WEAPON", weapon: input.weapon } : null;
    case "turn": {
      if (!isTurnDirection(input.direction)) return null;
      const degrees = typeof input.degrees === "number" && Number.isFinite(input.degrees) ? Math.abs(input.degrees) : undefined;
      return degrees !== undefined ? { action: "TURN", direction: input.direction, degrees } : { action: "TURN", direction: input.direction };
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
