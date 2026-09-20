import type { Subsystem, WeaponId } from "@/lib/config";

export type { WeaponId } from "@/lib/config";

/* ------------------------------------------------------------------ phases */

export type Phase =
  | "STANDBY"       // black screen, waiting for wake word
  | "WAKE"          // wake word detected flash
  | "BOOT"          // letter expansion + subsystem load
  | "COCKPIT_BOOT"  // HUD panels powering on one by one
  | "BRIEFING"      // AI reports weather / mission / status
  | "COMBAT"        // MANTIS waves
  | "BOSS_INTRO"    // CRIMSON-01 arrival
  | "BOSS"          // red ace fight
  | "VICTORY"
  | "DEFEAT";

export type SubsystemStatus = "OFFLINE" | "BOOTING" | "ONLINE";

/* ----------------------------------------------------------------- player */

export type Stance = "NEUTRAL" | "ASSAULT" | "GUARD" | "EVADE";

export interface Player {
  hp: number;          // 0..100 structural integrity
  maxHp: number;
  armor: number;       // 0..100 ablative plating
  energy: number;      // 0..100 weapon energy
  boost: number;       // 0..100 thruster charge
  heat: number;        // 0..100 weapon heat, locks fire at 100
  stance: Stance;
  bearing: number;     // where the mech is facing, degrees, 0 = north
  special: number;     // 0..100 charge for the finishing move
  weapon: WeaponId;    // currently selected weapon (see WEAPONS in config.ts)
}

/* ----------------------------------------------------------------- enemies */

export type EnemyKind = "MANTIS" | "CRIMSON";

export type EnemyState =
  | "SPAWNING"
  | "IDLE"
  | "PATROL"
  | "DETECT"
  | "ATTACK"
  | "FLANK"
  | "STAGGERED"
  | "RETREAT"
  | "DESTROYED";

export interface Enemy {
  id: string;
  codename: string;      // e.g. "MANTIS-01 / A3"
  kind: EnemyKind;
  hp: number;
  maxHp: number;
  shield: number;        // 0..1 damage reduction
  /** Polar position relative to the player. bearing: -180..180, 0 = dead ahead, + = right. */
  bearing: number;
  distance: number;      // 0..1400 meters
  altitude: number;      // -1..1, visual vertical offset in the viewport
  state: EnemyState;
  threat: number;        // 0..1, drives radar blip intensity
  analyzed: boolean;     // ANALYZE revealed its stats
  weakPointOpen: boolean;// temporary opening the co-pilot can call out
  lastFireAt: number;    // ms timestamp
  spawnAt: number;
  /** CRIMSON only: which adaptation the ace has locked onto. */
  adaptation?: BossAdaptation | null;
}

export type BossAdaptation =
  | "NONE"
  | "FRONTAL_GUARD"   // counters repeated frontal attacks
  | "FLANKING"        // circles to the player's flank
  | "BOOST_INTERCEPT" // punishes boost spam
  | "SHIELD_BREAK";   // counters turtling

/* ---------------------------------------------------------------- mission */

export interface Mission {
  id: string;
  sector: string;
  objective: string;
  threat: "LOW" | "MODERATE" | "HIGH" | "CRITICAL";
  status: "PENDING" | "ACTIVE" | "COMPLETE" | "FAILED";
  wave: number;
  totalWaves: number;
}

/* -------------------------------------------------------------- co-pilot */

export type AiStatus = "OFFLINE" | "IDLE" | "LISTENING" | "THINKING" | "SPEAKING";
export type VoiceLinkState = "OFFLINE" | "STANDBY" | "LISTENING" | "MUTED" | "ERROR";

export interface Weather {
  city: string;
  tempC: number;
  rainProb: number;
  windKph: number;
  condition: string;
  isMock: boolean;
}

export type LogLevel = "SYS" | "INFO" | "WARN" | "CRIT" | "AI" | "PILOT";

export interface LogEntry {
  id: string;
  at: number;
  level: LogLevel;
  text: string;
}

/* -------------------------------------------------------------- commands */

export type TargetSelector =
  | { type: "ID"; id: string }
  | { type: "NEAREST" }
  | { type: "FARTHEST" }
  | { type: "LEFT" }
  | { type: "RIGHT" }
  | { type: "FRONT" }
  | { type: "REAR" }
  | { type: "STRONGEST" }
  | { type: "WEAKEST" }
  | { type: "RED_ACE" };

export type GameCommand =
  | { action: "LOCK_TARGET"; target: TargetSelector }
  | { action: "ATTACK"; mode?: "BURST" | "PRECISION" | "BARRAGE" }
  | { action: "DEFEND" }
  | { action: "EVADE" }
  | { action: "BOOST"; direction?: "FORWARD" | "LEFT" | "RIGHT" | "BACK" }
  | { action: "RETREAT" }
  | { action: "ANALYZE"; target?: TargetSelector }
  | { action: "SCAN" }
  | { action: "STATUS_REPORT" }
  | { action: "FIRE_SPECIAL" }
  | { action: "SWITCH_WEAPON"; weapon: WeaponId | "NEXT" | "PREVIOUS" }
  | { action: "NONE" };

export type CommandAction = GameCommand["action"];
export type CommandSource = "REFLEX" | "NEURAL" | "MANUAL";

export interface CommandResult {
  ok: boolean;
  action: CommandAction;
  source: CommandSource;
  /** Short line the co-pilot should speak. Empty means stay silent. */
  speech: string;
  /** Big HUD callout, e.g. "TARGET LOCKED". */
  hud?: string;
  detail?: Record<string, unknown>;
}

/* ------------------------------------------------------------- telemetry */

export interface Telemetry {
  /** How many times the pilot issued each action — feeds the Red Ace adaptation. */
  counts: Record<CommandAction, number>;
  frontalAttacks: number;
  flankAttacks: number;
  damageDealt: number;
  damageTaken: number;
  killsMantis: number;
  startedAt: number;
}

/* -------------------------------------------------------------- snapshot */

/** Compact, LLM-facing view of the world. Keep it small — it goes in every prompt. */
export interface GameSnapshot {
  phase: Phase;
  mission: Mission;
  player: Player;
  enemies: Array<{
    id: string;
    codename: string;
    kind: EnemyKind;
    hpPct: number;
    bearing: number;
    distance: number;
    state: EnemyState;
    analyzed: boolean;
    weakPointOpen: boolean;
    isTarget: boolean;
  }>;
  targetId: string | null;
  weather: Weather | null;
  telemetry: Telemetry;
  recentLog: string[];
}

export interface Subsystems {
  name: Subsystem;
  status: SubsystemStatus;
}
