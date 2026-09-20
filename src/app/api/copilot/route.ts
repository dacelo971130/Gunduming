/**
 * POST /api/copilot — the only place ANTHROPIC_API_KEY is read (indirectly,
 * via src/ai/client.ts). Body: { transcript, snapshot, mode?, trigger? }.
 * mode "chat" (default) runs the full tool-calling copilot turn; mode
 * "advice" runs a short proactive callout for `trigger`. Both paths are
 * total — a bad body, a missing key, a thrown SDK error, or a slow response
 * all resolve to HTTP 200 with a usable reply, never a 500.
 */
import { NextResponse, type NextRequest } from "next/server";
import { z } from "zod";
import { askAdvice, askCopilot } from "@/ai/client";
import { ADVICE_FALLBACK_LINES, type AdviceTrigger } from "@/ai/advisor";

const PhaseSchema = z.enum([
  "STANDBY",
  "WAKE",
  "BOOT",
  "COCKPIT_BOOT",
  "BRIEFING",
  "COMBAT",
  "BOSS_INTRO",
  "BOSS",
  "VICTORY",
  "DEFEAT",
]);

const MissionSchema = z.object({
  id: z.string(),
  sector: z.string(),
  objective: z.string(),
  threat: z.enum(["LOW", "MODERATE", "HIGH", "CRITICAL"]),
  status: z.enum(["PENDING", "ACTIVE", "COMPLETE", "FAILED"]),
  wave: z.number(),
  totalWaves: z.number(),
});

const StanceSchema = z.enum(["NEUTRAL", "ASSAULT", "GUARD", "EVADE"]);

const PlayerSchema = z.object({
  hp: z.number(),
  maxHp: z.number(),
  armor: z.number(),
  energy: z.number(),
  boost: z.number(),
  heat: z.number(),
  stance: StanceSchema,
  bearing: z.number(),
  special: z.number(),
  weapon: z.enum(["RIFLE", "CANNON", "MISSILE", "BLADE", "INCENDIARY", "NUKE", "FLEET_CANNON"]).default("RIFLE"),
  ammo: z.record(z.string(), z.number()).default({}),
  weaponReadyAt: z.record(z.string(), z.number()).default({}),
});

const EnemyKindSchema = z.enum(["MANTIS", "CRIMSON"]);
const EnemyStateSchema = z.enum(["SPAWNING", "IDLE", "PATROL", "DETECT", "ATTACK", "FLANK", "STAGGERED", "RETREAT", "DESTROYED"]);

const SnapshotEnemySchema = z.object({
  id: z.string(),
  codename: z.string(),
  kind: EnemyKindSchema,
  hpPct: z.number(),
  bearing: z.number(),
  distance: z.number(),
  state: EnemyStateSchema,
  analyzed: z.boolean(),
  weakPointOpen: z.boolean(),
  isTarget: z.boolean(),
});

const WeatherSchema = z
  .object({
    city: z.string(),
    tempC: z.number(),
    rainProb: z.number(),
    windKph: z.number(),
    condition: z.string(),
    isMock: z.boolean(),
  })
  .nullable();

const CommandActionSchema = z.enum([
  "LOCK_TARGET",
  "ATTACK",
  "DEFEND",
  "EVADE",
  "BOOST",
  "RETREAT",
  "ANALYZE",
  "SCAN",
  "STATUS_REPORT",
  "FIRE_SPECIAL",
  "SWITCH_WEAPON",
  "TURN",
  "NONE",
]);

const TelemetrySchema = z.object({
  counts: z.record(CommandActionSchema, z.number()),
  frontalAttacks: z.number(),
  flankAttacks: z.number(),
  damageDealt: z.number(),
  damageTaken: z.number(),
  killsMantis: z.number(),
  startedAt: z.number(),
});

const GameSnapshotSchema = z.object({
  phase: PhaseSchema,
  mission: MissionSchema,
  player: PlayerSchema,
  enemies: z.array(SnapshotEnemySchema),
  targetId: z.string().nullable(),
  weather: WeatherSchema,
  telemetry: TelemetrySchema,
  recentLog: z.array(z.string()),
});

const AdviceTriggerSchema = z.enum([
  "TARGET_OFF_NOSE",
  "NUKE_WINDOW",
  "FLEET_WINDOW",
  "SURROUNDED",
  "LOW_ARMOR",
  "BOSS_FLANKING",
  "WEAK_POINT",
  "WAVE_CLEARED",
  "IDLE_CHECK",
  "BLADE_RANGE",
  "CANNON_OPENING",
  "MISSILE_CLUSTER",
]);

const RequestSchema = z.object({
  transcript: z.string(),
  snapshot: GameSnapshotSchema,
  mode: z.enum(["chat", "advice"]).optional(),
  trigger: AdviceTriggerSchema.optional(),
});

const GENERIC_FALLBACK = {
  speech: "Comms garbled, Pilot. Say again.",
  commands: [],
  source: "MOCK" as const,
};

export async function POST(req: NextRequest) {
  let json: unknown;
  try {
    json = await req.json();
  } catch (err) {
    console.error("[api/copilot] request body was not valid JSON:", err);
    return NextResponse.json(GENERIC_FALLBACK, { status: 200 });
  }

  const parsed = RequestSchema.safeParse(json);
  if (!parsed.success) {
    console.error("[api/copilot] request body failed validation:", parsed.error.flatten());
    return NextResponse.json(GENERIC_FALLBACK, { status: 200 });
  }

  const { transcript, snapshot, mode, trigger } = parsed.data;

  if (mode === "advice") {
    const resolvedTrigger: AdviceTrigger = trigger ?? "IDLE_CHECK";
    try {
      const reply = await askAdvice(resolvedTrigger, snapshot);
      return NextResponse.json(reply, { status: 200 });
    } catch (err) {
      console.error("[api/copilot] advice path threw unexpectedly:", err);
      return NextResponse.json({ speech: ADVICE_FALLBACK_LINES[resolvedTrigger], source: "MOCK" as const }, { status: 200 });
    }
  }

  try {
    const reply = await askCopilot(transcript, snapshot);
    return NextResponse.json(reply, { status: 200 });
  } catch (err) {
    // askCopilot is total and should never throw, but the route stays safe either way.
    console.error("[api/copilot] chat path threw unexpectedly:", err);
    return NextResponse.json(GENERIC_FALLBACK, { status: 200 });
  }
}

/**
 * Link check. The HUD shows NEURAL vs LOCAL from the moment it boots, so it
 * needs to know whether a key exists before the pilot has said anything.
 * Reports only whether the key is configured — it never calls the model.
 */
export function GET(): Response {
  return Response.json({ neural: Boolean(process.env.ANTHROPIC_API_KEY) });
}
