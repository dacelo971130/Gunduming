/**
 * Global demo configuration. Original IP only — no third-party franchise names.
 */
export const AI_NAME = "ECHO-01";
export const AI_SHORT = "ECHO";
export const PLAYER_MECH = "AETHER FRAME";
export const PLAYER_CALLSIGN = "PILOT";
export const ENEMY_FACTION = "VOID FLEET";
export const GRUNT_NAME = "MANTIS-01";
export const BOSS_NAME = "CRIMSON-01";
export const BOSS_TITLE = "THE RED ACE";

/** Wake word variants — Web Speech often mishears short words, so accept near-misses. */
export const WAKE_WORDS = [
  "echo", "eco", "ekko", "echoe", "echo one", "echo 01", "acho", "eccho",
];

export const SPEECH_LANG = "en-US";

/** Boot sequence letters: each expands into the full subsystem name. */
export const BOOT_LETTERS = [
  { letter: "A", word: "AUTONOMOUS", system: "AUTONOMOUS CONTROL" },
  { letter: "E", word: "ENGAGEMENT", system: "WEAPON SYSTEM" },
  { letter: "T", word: "TACTICAL", system: "TACTICAL CORE" },
  { letter: "H", word: "HARMONIC", system: "NEURAL LINK" },
  { letter: "E", word: "EXO", system: "MOBILITY SYSTEM" },
  { letter: "R", word: "RECON", system: "RADAR" },
] as const;

export const SUBSYSTEMS = [
  "TACTICAL CORE",
  "NEURAL LINK",
  "DEFENSE SYSTEM",
  "AUTONOMOUS CONTROL",
  "MOBILITY SYSTEM",
  "WEAPON SYSTEM",
  "RADAR",
  "VOICE LINK",
] as const;
export type Subsystem = (typeof SUBSYSTEMS)[number];

/* ------------------------------------------------------------- weapons */

export type WeaponId = "RIFLE" | "CANNON" | "MISSILE" | "BLADE";

export interface WeaponSpec {
  id: WeaponId;
  /** Full display name, uppercase, e.g. "LINEAR RIFLE". */
  name: string;
  /** 2–4 letter tag for compact HUD readouts. */
  tag: string;
  /** Base damage of one BURST-mode shot. PRECISION/BARRAGE scale from this. */
  damage: number;
  /** Heat added per shot (0..100 scale). */
  heat: number;
  /** Weapon energy spent per shot (0..100 scale). */
  energy: number;
  /** Maximum engagement range in meters; `null` = unlimited. BLADE is melee. */
  maxRange: number | null;
  /** Bearing half-angle in degrees within which splash also hits other units; 0 = single target. */
  splashDeg: number;
  /** One-line flavour for the HUD and for ECHO-01's advice. */
  role: string;
}

/** The AETHER FRAME loadout. Order = cycling order for "next/previous weapon". */
export const WEAPONS: readonly WeaponSpec[] = [
  { id: "RIFLE",   name: "LINEAR RIFLE",  tag: "LR",  damage: 22, heat: 12, energy: 8,  maxRange: null, splashDeg: 0,  role: "Balanced. Always ready." },
  { id: "CANNON",  name: "HEAVY CANNON",  tag: "HC",  damage: 44, heat: 30, energy: 18, maxRange: null, splashDeg: 8,  role: "Slow, armor-breaking. Best on exposed weak points." },
  { id: "MISSILE", name: "MISSILE POD",   tag: "MSL", damage: 9,  heat: 18, energy: 16, maxRange: 1100, splashDeg: 30, role: "Six-round salvo. Hits everything in the cone." },
  { id: "BLADE",   name: "PLASMA BLADE",  tag: "PB",  damage: 60, heat: 8,  energy: 0,  maxRange: 260,  splashDeg: 0,  role: "Melee. Devastating inside 260 meters, useless beyond." },
] as const;

export const DEFAULT_WEAPON: WeaponId = "RIFLE";

export function weaponSpec(id: WeaponId): WeaponSpec {
  return WEAPONS.find((w) => w.id === id) ?? WEAPONS[0];
}

/** Demo safety: pilot cannot actually die during a stage demo. */
export const DEMO_MODE_FLOOR_HP = 0.15;
export const WEATHER_CITY = "Taipei";
export const WEATHER_LAT = 25.033;
export const WEATHER_LON = 121.5654;
