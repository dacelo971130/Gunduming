/**
 * The 5-minute demo script. Reacts to phase:changed and drives timed beats (bgm, HUD, ECHO-01 speech).
 * Win/lose transitions themselves live in engine.ts — this module only performs each phase's show.
 */
import { bus, say } from "@/lib/bus";
import { game } from "@/game/store";
import { SUBSYSTEMS, weaponSpec } from "@/lib/config";
import type { Phase } from "@/game/types";
import { spawnBoss, spawnWave } from "@/game/waves";

const PANEL_ORDER = ["radar", "system", "mission", "weapons", "comms", "ai-core", "pilot"];
const PANEL_GAP_MS = 450;
const BRIEFING_LINE_GAP_MS = 2600;
const BOSS_ARRIVAL_DELAY_MS = 2600;
/** Delay after "hostiles detected" before ECHO-01 mentions the loadout once. */
const LOADOUT_BEAT_DELAY_MS = 3800;

let timers: ReturnType<typeof setTimeout>[] = [];
let loadoutBeatDone = false;

function after(ms: number, fn: () => void): void {
  const id = setTimeout(() => {
    timers = timers.filter((t) => t !== id);
    try {
      fn();
    } catch (err) {
      console.error("[director] step threw", err);
    }
  }, ms);
  timers.push(id);
}

function clearTimers(): void {
  for (const id of timers) clearTimeout(id);
  timers = [];
}

function hourGreeting(): string {
  const hour = new Date().getHours();
  if (hour < 5) return "You're up late, Pilot.";
  if (hour < 12) return "Good morning, Pilot.";
  if (hour < 18) return "Good afternoon, Pilot.";
  return "Good evening, Pilot.";
}

function weatherLine(): string {
  const weather = game.get().weather;
  if (!weather) return "Local weather data is currently unavailable.";
  return `Current conditions over ${weather.city}: ${Math.round(weather.tempC)} degrees, ${weather.condition}, ${Math.round(weather.rainProb)} percent chance of rain.`;
}

function missionLine(): string {
  const mission = game.get().mission;
  return `Mission briefing: ${mission.sector}. ${mission.objective}`;
}

function loadoutLine(): string {
  const name = weaponSpec(game.get().player.weapon).name.toLowerCase();
  const selected = name.charAt(0).toUpperCase() + name.slice(1);
  return `${selected} selected. Say cannon, missiles, blade, incendiary or nuke to switch — or call the fleet.`;
}

/* ------------------------------------------------------------- per-phase */

function runCockpitBoot(): void {
  PANEL_ORDER.forEach((panel, i) => {
    after(i * PANEL_GAP_MS, () => {
      game.get().bringPanelOnline(panel);
      bus.emit("audio:cue", { cue: "PANEL_ON" });
    });
  });
  after(PANEL_ORDER.length * PANEL_GAP_MS + 200, () => {
    game.get().setPhase("BRIEFING");
  });
}

function runBriefing(): void {
  bus.emit("audio:bgm", { track: "BRIEFING" });
  const lines = [
    "System online, Pilot.",
    hourGreeting(),
    "All primary systems are operational.",
    weatherLine(),
    missionLine(),
    "Pilot, all systems are ready. Awaiting your command.",
  ];
  lines.forEach((line, i) => after(i * BRIEFING_LINE_GAP_MS, () => say(line)));
  after(lines.length * BRIEFING_LINE_GAP_MS, () => {
    spawnWave(1);
    game.get().setPhase("COMBAT");
  });
}

function runCombat(): void {
  bus.emit("audio:bgm", { track: "COMBAT" });
  bus.emit("hud:alert", { text: "HOSTILES DETECTED", level: "WARN" });
  say("Pilot, multiple hostile units detected.");
  // One-time loadout beat so the pilot knows the weapon options exist. Only on
  // the first COMBAT entry of a session — wave-to-wave it stays quiet.
  if (!loadoutBeatDone) {
    loadoutBeatDone = true;
    after(LOADOUT_BEAT_DELAY_MS, () => say(loadoutLine()));
  }
}

function runBossIntro(): void {
  bus.emit("audio:bgm", { track: "BOSS" });
  bus.emit("audio:cue", { cue: "ALARM" }); // red alert siren
  bus.emit("hud:alert", { text: "WARNING // HIGH ENERGY SIGNATURE DETECTED", level: "CRIT" });
  say("Pilot... this unit is different.", "urgent");
  after(BOSS_ARRIVAL_DELAY_MS, () => {
    spawnBoss();
    game.get().setPhase("BOSS");
  });
}

function runVictory(): void {
  bus.emit("audio:bgm", { track: "VICTORY" });
  bus.emit("hud:alert", { text: "MISSION COMPLETE", level: "INFO" });
  say("Mission accomplished, Pilot.");
}

export function runDirector(): () => void {
  // The weapon-doctrine advisor (blade range / cannon opening / missile cluster)
  // lives in the NEURAL layer; load it lazily so a failing module never blocks the show.
  let stopWeaponAdvisor: (() => void) | null = null;
  let disposed = false;
  import("@/ai/advisor")
    .then((mod) => {
      if (disposed) return;
      stopWeaponAdvisor = mod.startWeaponAdvisor();
    })
    .catch((err) => {
      console.error("[director] weapon advisor unavailable", err);
    });

  const unsubscribe = bus.on("phase:changed", ({ phase }) => {
    clearTimers(); // a phase change supersedes any pending steps queued for the previous phase
    switch (phase) {
      case "COCKPIT_BOOT":
        runCockpitBoot();
        break;
      case "BRIEFING":
        runBriefing();
        break;
      case "COMBAT":
        runCombat();
        break;
      case "BOSS_INTRO":
        runBossIntro();
        break;
      case "VICTORY":
        runVictory();
        break;
      default:
        break;
    }
  });

  return () => {
    disposed = true;
    stopWeaponAdvisor?.();
    clearTimers();
    unsubscribe();
  };
}

/** Rehearsal hotkey support: jump straight to a phase, priming whatever state it expects. */
export function skipTo(phase: Phase): void {
  clearTimers();
  const store = game.get();
  if (phase === "STANDBY") loadoutBeatDone = false;

  if (phase !== "STANDBY" && phase !== "WAKE" && phase !== "BOOT") {
    for (const panel of PANEL_ORDER) store.bringPanelOnline(panel);
  }
  if (phase !== "STANDBY" && phase !== "WAKE") {
    for (const name of SUBSYSTEMS) store.setSubsystem(name, "ONLINE");
  }

  if (phase === "COMBAT") {
    store.clearEnemies();
    store.setMission({ wave: 0 });
    spawnWave(1);
  }
  if (phase === "BOSS_INTRO") {
    store.clearEnemies();
    store.setMission({ wave: store.mission.totalWaves, status: "ACTIVE" });
  }
  if (phase === "BOSS") {
    store.clearEnemies();
    store.setMission({ wave: store.mission.totalWaves, status: "ACTIVE" });
    spawnBoss();
  }
  if (phase === "VICTORY") {
    store.clearEnemies();
  }

  store.setPhase(phase);
}

/** Lazily loads the NEURAL layer's weather module so a not-yet-built or failing module never blocks the briefing. */
export async function loadWeather(): Promise<void> {
  try {
    const mod = await import("@/ai/weather");
    const weather = await mod.fetchWeather();
    game.get().setWeather(weather);
  } catch {
    // Weather is flavor only — silently fall back to the neutral briefing line.
  }
}
