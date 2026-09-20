"use client";

import { create } from "zustand";
import { SUBSYSTEMS, type Subsystem } from "@/lib/config";
import { bus } from "@/lib/bus";
import type {
  AiStatus,
  CommandAction,
  Enemy,
  GameSnapshot,
  LogEntry,
  LogLevel,
  Mission,
  Phase,
  Player,
  Stance,
  SubsystemStatus,
  Telemetry,
  VoiceLinkState,
  Weather,
} from "./types";

const ACTIONS: CommandAction[] = [
  "LOCK_TARGET", "ATTACK", "DEFEND", "EVADE", "BOOST",
  "RETREAT", "ANALYZE", "SCAN", "STATUS_REPORT", "FIRE_SPECIAL", "NONE",
];

function emptyCounts(): Record<CommandAction, number> {
  return Object.fromEntries(ACTIONS.map((a) => [a, 0])) as Record<CommandAction, number>;
}

const initialPlayer: Player = {
  hp: 100, maxHp: 100, armor: 100, energy: 98,
  boost: 92, heat: 0, stance: "NEUTRAL", bearing: 0, special: 0,
};

const initialMission: Mission = {
  id: "M-01",
  sector: "SECTOR 07",
  objective: "Investigate unknown signals.",
  threat: "LOW",
  status: "PENDING",
  wave: 0,
  totalWaves: 3,
};

let logSeq = 0;

export interface GameStore {
  /* state */
  phase: Phase;
  bootProgress: number;                       // 0..100
  subsystems: Record<Subsystem, SubsystemStatus>;
  /** Which cockpit panels have powered on, in order. */
  panelsOnline: string[];
  player: Player;
  enemies: Enemy[];
  targetId: string | null;
  mission: Mission;
  aiStatus: AiStatus;
  aiCaption: string;                          // what the AI last said, shown under the core
  voiceLink: VoiceLinkState;
  transcript: string;                         // live interim transcript
  weather: Weather | null;
  telemetry: Telemetry;
  log: LogEntry[];
  demoMode: boolean;                          // pilot cannot be destroyed
  neuralOnline: boolean;                      // LLM reachable

  /* mutators */
  setPhase: (phase: Phase) => void;
  setBootProgress: (value: number) => void;
  setSubsystem: (name: Subsystem, status: SubsystemStatus) => void;
  bringPanelOnline: (panel: string) => void;
  setPlayer: (patch: Partial<Player>) => void;
  setStance: (stance: Stance) => void;
  damagePlayer: (amount: number, fromBearing?: number) => void;
  addEnemy: (enemy: Enemy) => void;
  updateEnemy: (id: string, patch: Partial<Enemy>) => void;
  damageEnemy: (id: string, amount: number) => { killed: boolean; hp: number };
  removeEnemy: (id: string) => void;
  clearEnemies: () => void;
  setTarget: (id: string | null) => void;
  setMission: (patch: Partial<Mission>) => void;
  setAiStatus: (status: AiStatus) => void;
  setAiCaption: (text: string) => void;
  setVoiceLink: (state: VoiceLinkState) => void;
  setTranscript: (text: string) => void;
  setWeather: (weather: Weather | null) => void;
  setNeuralOnline: (online: boolean) => void;
  setDemoMode: (on: boolean) => void;
  recordCommand: (action: CommandAction, frontal?: boolean) => void;
  addTelemetry: (patch: Partial<Telemetry>) => void;
  pushLog: (level: LogLevel, text: string) => void;
  getSnapshot: () => GameSnapshot;
  reset: () => void;
}

function freshSubsystems(): Record<Subsystem, SubsystemStatus> {
  return Object.fromEntries(SUBSYSTEMS.map((s) => [s, "OFFLINE"])) as Record<Subsystem, SubsystemStatus>;
}

function freshTelemetry(): Telemetry {
  return {
    counts: emptyCounts(),
    frontalAttacks: 0, flankAttacks: 0,
    damageDealt: 0, damageTaken: 0, killsMantis: 0,
    startedAt: Date.now(),
  };
}

export const useGame = create<GameStore>((set, get) => ({
  phase: "STANDBY",
  bootProgress: 0,
  subsystems: freshSubsystems(),
  panelsOnline: [],
  player: { ...initialPlayer },
  enemies: [],
  targetId: null,
  mission: { ...initialMission },
  aiStatus: "OFFLINE",
  aiCaption: "",
  voiceLink: "OFFLINE",
  transcript: "",
  weather: null,
  telemetry: freshTelemetry(),
  log: [],
  demoMode: true,
  neuralOnline: false,

  setPhase: (phase) => {
    const previous = get().phase;
    if (previous === phase) return;
    set({ phase });
    bus.emit("phase:changed", { phase, previous });
  },

  setBootProgress: (value) => set({ bootProgress: Math.max(0, Math.min(100, value)) }),

  setSubsystem: (name, status) =>
    set((s) => ({ subsystems: { ...s.subsystems, [name]: status } })),

  bringPanelOnline: (panel) =>
    set((s) => (s.panelsOnline.includes(panel) ? s : { panelsOnline: [...s.panelsOnline, panel] })),

  setPlayer: (patch) => set((s) => ({ player: { ...s.player, ...patch } })),

  setStance: (stance) => set((s) => ({ player: { ...s.player, stance } })),

  damagePlayer: (amount, fromBearing = 0) => {
    const { player, demoMode } = get();
    // Armor soaks damage first, structure takes the remainder.
    const guard = player.stance === "GUARD" ? 0.45 : player.stance === "EVADE" ? 0.7 : 1;
    const incoming = amount * guard;
    const armorSoak = Math.min(player.armor, incoming * 0.6);
    let hp = player.hp - (incoming - armorSoak);
    const floor = demoMode ? player.maxHp * 0.15 : 0;
    hp = Math.max(floor, hp);
    set({
      player: { ...player, armor: Math.max(0, player.armor - armorSoak), hp },
      telemetry: { ...get().telemetry, damageTaken: get().telemetry.damageTaken + incoming },
    });
    bus.emit("fx:playerHit", { amount: incoming, fromBearing });
    bus.emit("audio:cue", { cue: "PLAYER_HIT" });
    bus.emit("hud:shake", { intensity: Math.min(1, incoming / 25) });
  },

  addEnemy: (enemy) => set((s) => ({ enemies: [...s.enemies, enemy] })),

  updateEnemy: (id, patch) =>
    set((s) => ({ enemies: s.enemies.map((e) => (e.id === id ? { ...e, ...patch } : e)) })),

  damageEnemy: (id, amount) => {
    const enemy = get().enemies.find((e) => e.id === id);
    if (!enemy || enemy.state === "DESTROYED") return { killed: false, hp: 0 };
    const applied = amount * (1 - enemy.shield);
    const hp = Math.max(0, enemy.hp - applied);
    const killed = hp <= 0;
    set((s) => ({
      enemies: s.enemies.map((e) =>
        e.id === id ? { ...e, hp, state: killed ? "DESTROYED" : e.state } : e,
      ),
      telemetry: {
        ...s.telemetry,
        damageDealt: s.telemetry.damageDealt + applied,
        killsMantis: s.telemetry.killsMantis + (killed && enemy.kind === "MANTIS" ? 1 : 0),
      },
    }));
    bus.emit("fx:hit", { targetId: id, amount: applied, killed });
    bus.emit("audio:cue", { cue: killed ? "EXPLOSION" : "IMPACT" });
    return { killed, hp };
  },

  removeEnemy: (id) =>
    set((s) => ({
      enemies: s.enemies.filter((e) => e.id !== id),
      targetId: s.targetId === id ? null : s.targetId,
    })),

  clearEnemies: () => set({ enemies: [], targetId: null }),

  setTarget: (id) => set({ targetId: id }),

  setMission: (patch) => set((s) => ({ mission: { ...s.mission, ...patch } })),

  setAiStatus: (aiStatus) => set({ aiStatus }),

  setAiCaption: (aiCaption) => set({ aiCaption }),

  setVoiceLink: (voiceLink) => set({ voiceLink }),

  setTranscript: (transcript) => set({ transcript }),

  setWeather: (weather) => set({ weather }),

  setNeuralOnline: (neuralOnline) => set({ neuralOnline }),

  setDemoMode: (demoMode) => set({ demoMode }),

  recordCommand: (action, frontal) =>
    set((s) => ({
      telemetry: {
        ...s.telemetry,
        counts: { ...s.telemetry.counts, [action]: (s.telemetry.counts[action] ?? 0) + 1 },
        frontalAttacks: s.telemetry.frontalAttacks + (frontal === true ? 1 : 0),
        flankAttacks: s.telemetry.flankAttacks + (frontal === false ? 1 : 0),
      },
    })),

  addTelemetry: (patch) => set((s) => ({ telemetry: { ...s.telemetry, ...patch } })),

  pushLog: (level, text) =>
    set((s) => ({
      log: [...s.log, { id: `log-${++logSeq}`, at: Date.now(), level, text }].slice(-60),
    })),

  getSnapshot: () => {
    const s = get();
    return {
      phase: s.phase,
      mission: s.mission,
      player: s.player,
      enemies: s.enemies
        .filter((e) => e.state !== "DESTROYED")
        .map((e) => ({
          id: e.id,
          codename: e.codename,
          kind: e.kind,
          hpPct: Math.round((e.hp / e.maxHp) * 100),
          bearing: Math.round(e.bearing),
          distance: Math.round(e.distance),
          state: e.state,
          analyzed: e.analyzed,
          weakPointOpen: e.weakPointOpen,
          isTarget: e.id === s.targetId,
        })),
      targetId: s.targetId,
      weather: s.weather,
      telemetry: s.telemetry,
      recentLog: s.log.slice(-8).map((l) => `${l.level}: ${l.text}`),
    };
  },

  reset: () =>
    set({
      phase: "STANDBY",
      bootProgress: 0,
      subsystems: freshSubsystems(),
      panelsOnline: [],
      player: { ...initialPlayer },
      enemies: [],
      targetId: null,
      mission: { ...initialMission },
      aiStatus: "OFFLINE",
      aiCaption: "",
      voiceLink: "OFFLINE",
      transcript: "",
      telemetry: freshTelemetry(),
      log: [],
    }),
}));

/** Non-reactive access for engine/voice modules outside React. */
export const game = {
  get: () => useGame.getState(),
  snapshot: () => useGame.getState().getSnapshot(),
};
