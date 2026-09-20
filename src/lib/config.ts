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

/** Demo safety: pilot cannot actually die during a stage demo. */
export const DEMO_MODE_FLOOR_HP = 0.15;
export const WEATHER_CITY = "Taipei";
export const WEATHER_LAT = 25.033;
export const WEATHER_LON = 121.5654;
