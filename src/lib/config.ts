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

export type WeaponId = "RIFLE" | "CANNON" | "MISSILE" | "BLADE" | "INCENDIARY" | "NUKE" | "FLEET_CANNON";

/** HELD = the mech's own weapon · ORDNANCE = limited-ammo heavy munition · SUPPORT = off-map fire call. */
export type WeaponKind = "HELD" | "ORDNANCE" | "SUPPORT";

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
  kind: WeaponKind;
  /** Rounds available per mission; `null` = unlimited. Tracked in `player.ammo`. */
  ammo: number | null;
  /** Reload/cooldown between uses, ms; 0 = none. Tracked in `player.weaponReadyAt`. */
  cooldownMs: number;
  /** Safety minimum range in meters (NUKE); firing inside it is denied. */
  minRange?: number;
  /** Seconds-scale delay between the call and impact (FLEET_CANNON shells fall from orbit). */
  delayMs?: number;
  /** Damage over time applied to everything hit: `dps` for `ms` (INCENDIARY). */
  burn?: { dps: number; ms: number };
  /** For SUPPORT/ORDNANCE salvos: number of shells/rounds per use. */
  rounds?: number;
}

/** The AETHER FRAME loadout. Order = cycling order for "next/previous weapon". */
export const WEAPONS: readonly WeaponSpec[] = [
  { id: "RIFLE",   name: "LINEAR RIFLE",  tag: "LR",  kind: "HELD", ammo: null, cooldownMs: 0, damage: 22, heat: 12, energy: 8,  maxRange: null, splashDeg: 0,  role: "Balanced. Always ready." },
  { id: "CANNON",  name: "HEAVY CANNON",  tag: "HC",  kind: "HELD", ammo: null, cooldownMs: 0, damage: 44, heat: 30, energy: 18, maxRange: null, splashDeg: 8,  role: "Slow, armor-breaking. Best on exposed weak points." },
  { id: "MISSILE", name: "MISSILE POD",   tag: "MSL", kind: "HELD", ammo: null, cooldownMs: 0, damage: 9,  heat: 18, energy: 16, maxRange: 1100, splashDeg: 30, rounds: 6, role: "Six-round salvo. Hits everything in the cone." },
  { id: "BLADE",   name: "PLASMA BLADE",  tag: "PB",  kind: "HELD", ammo: null, cooldownMs: 0, damage: 60, heat: 8,  energy: 0,  maxRange: 260,  splashDeg: 0,  role: "Melee. Devastating inside 260 meters, useless beyond." },
  { id: "INCENDIARY", name: "INCENDIARY SHELLS", tag: "INC", kind: "ORDNANCE", ammo: 4, cooldownMs: 4000, damage: 12, heat: 22, energy: 14, maxRange: 1000, splashDeg: 25, burn: { dps: 8, ms: 6000 }, role: "Sets the cone on fire. Everything hit burns for six seconds. Four shells." },
  { id: "NUKE", name: "TACTICAL NUKE", tag: "NUK", kind: "ORDNANCE", ammo: 1, cooldownMs: 0, damage: 400, heat: 45, energy: 30, maxRange: null, minRange: 450, splashDeg: 90, role: "One warhead. Wipes everything in front of you. Never inside 450 meters — the blast comes back." },
  { id: "FLEET_CANNON", name: "FLEET CANNON SUPPORT", tag: "FLT", kind: "SUPPORT", ammo: null, cooldownMs: 45000, damage: 90, heat: 0, energy: 0, maxRange: null, splashDeg: 35, delayMs: 3000, rounds: 3, role: "Calls the battleship in orbit. Three shells, three seconds out, forty-five second reload." },
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
