# AETHER FRAME — Build Contract

> **2026-09-20 redesign:** `docs/REDESIGN.md` amends this file (WebGL viewport, circular canopy, weapon loadout, new ownership map). Where the two disagree, REDESIGN.md wins.

A voice-controlled AI co-pilot that turns the browser into a living mecha cockpit.
Several agents build this in parallel. **This file is the integration surface. Do not edit it.**

## Locked decisions

| Thing | Value |
|---|---|
| AI co-pilot | `ECHO-01` (original IP — never "Haro"/Gundam/Zaku/Char or any official name, silhouette, logo or line) |
| Wake word | "ECHO" (see `WAKE_WORDS` in `src/lib/config.ts`) |
| Player mech | `AETHER FRAME` |
| Grunt enemy | `MANTIS-01` (green mass-production) |
| Boss | `CRIMSON-01`, "THE RED ACE" |
| Speech language | `en-US` |
| Command routing | Dual path — **REFLEX** (local keyword, <50ms) for combat-critical verbs, **NEURAL** (LLM tool calling) for everything else |
| Art | 100% procedural (SVG/Canvas/CSS). No image, audio or font files. |
| BGM | Synthesized live with Web Audio. No mp3 assets. |

## Stack

Next.js 16 App Router · React 19 · TypeScript strict · Tailwind **v4** · `motion` · `zustand` · `@anthropic-ai/sdk` · `zod`

- Tailwind v4: tokens live in `@theme` inside `src/app/globals.css`. Use `bg-hud-panel`, `text-hud-green`, `border-hud-line`, `text-hud-amber`, `text-hud-red`, etc. **There is no `tailwind.config.js`** — do not create one.
- Animation import is `import { motion, AnimatePresence } from "motion/react"` (not `framer-motion`).
- Anything with hooks, browser APIs or the store needs `"use client"` at the top.
- **Do not install packages. Do not run `npm run dev`** (port conflicts with other agents). Typecheck with
  `npx tsc --noEmit 2>&1 | grep "<your directory>"` — errors in other agents' unfinished files are expected, ignore them.

## Frozen shared modules — read them, never edit them

- `src/lib/config.ts` — names, wake words, boot letters, subsystem list.
- `src/game/types.ts` — every domain type (`Phase`, `Player`, `Enemy`, `GameCommand`, `CommandResult`, `GameSnapshot`, …).
- `src/game/store.ts` — the zustand store. React: `useGame((s) => s.player)`. Outside React: `game.get()`, `game.snapshot()`.
- `src/lib/bus.ts` — typed event bus (`bus.on`, `bus.emit`, `say()`) and the `BusEvents` map.
- `src/app/globals.css` — design tokens + utility classes (`.hud-panel`, `.hud-bracket`, `.hud-label`, `.crt-scan`, `.crt-vignette`, `.text-glow`, `.animate-sweep`, `.animate-breathe`, `.animate-blink`, `.animate-glitch`, `.animate-shake`, `.animate-flicker`, `.animate-red-alert`, `.dot-leader`).

If you genuinely need a new field or event, **add it and say so in your final report** — but prefer working within what exists.

## Phase machine

`STANDBY → WAKE → BOOT → COCKPIT_BOOT → BRIEFING → COMBAT → BOSS_INTRO → BOSS → VICTORY`

## Module ownership — touch only your own files

| Owner | Files | Must export |
|---|---|---|
| **ENGINE** | `src/game/commands.ts`, `engine.ts`, `enemyAI.ts`, `waves.ts`, `boss.ts`, `director.ts` | `executeCommand(cmd, source): CommandResult`; `startEngine(): () => void`; `runDirector(): () => void`; `spawnWave(n)`, `spawnBoss()` |
| **BOOT** | `src/components/boot/*` | `BootStage` (default-ish named export from `src/components/boot/BootStage.tsx`) |
| **COCKPIT** | `src/components/cockpit/*`, `src/components/radar/*`, `src/components/ai-core/*` | `Cockpit({ viewport }: { viewport: ReactNode })` from `src/components/cockpit/Cockpit.tsx`; `Radar()` from `src/components/radar/Radar.tsx`; `AiCore()` from `src/components/ai-core/AiCore.tsx` |
| **VOICE** | `src/voice/*`, `src/components/voice/*` | `VoiceLink()` from `src/voice/VoiceLink.tsx`; `matchReflex(text): GameCommand \| null`; `matchWakeWord(text): boolean`; `speak(text): Promise<void>` |
| **NEURAL** | `src/ai/*`, `src/app/api/**` | `askCopilot(transcript, snapshot): Promise<CopilotReply>`; `requestAdvice(trigger, snapshot): Promise<string>`; `fetchWeather(): Promise<Weather>` |
| **AUDIO** | `src/audio/*` | `AudioLink()` from `src/audio/AudioLink.tsx`; `unlockAudio(): void` |
| **VIEWPORT** | `src/components/viewport/*` | `BattleViewport()` from `src/components/viewport/BattleViewport.tsx` |

`src/app/page.tsx`, `layout.tsx`, `README.md` and `.env.example` belong to the **integrator**. Do not write them.

## Cross-module protocol

Everything flows through the store and the bus:

```
voice/keyboard → GameCommand → executeCommand() → store mutation → bus event → UI + audio + TTS
```

- Speak a line: `say("Target locked.")` from `@/lib/bus`. The voice module owns TTS and sets `aiStatus`.
- Big HUD callout: `bus.emit("hud:alert", { text: "TARGET LOCKED", level: "INFO" })`.
- Sound: `bus.emit("audio:cue", { cue: "LOCK" })`. Music: `bus.emit("audio:bgm", { track: "BOSS" })`.
- Combat log: `game.get().pushLog("WARN", "…")`.

## Reply shape from the LLM

```ts
export interface CopilotReply {
  speech: string;            // what ECHO-01 says out loud, <= 2 short sentences
  commands: GameCommand[];   // tool calls to execute in order
  source: "NEURAL" | "MOCK";
}
```

## Visual language

Military mecha + retro terminal. Black `#04070a` base, thin 1px lines, dotted leaders, uppercase 9–11px labels
with wide tracking, corner brackets, scanlines. Green = system/friendly. Amber = caution. Red = hostile.
No rounded cards, no gradients-as-decoration, no SaaS dashboard look, no neon cyberpunk.
Typography is the star: big condensed mono, `letter-spacing`, dot leaders, `........ ONLINE`.

## Demo reliability (non-negotiable)

- Every voice command has a keyboard fallback.
- The whole demo must run with **no API key and no network** (mock paths).
- Nothing may throw on unsupported browsers — feature-detect, degrade, log to the HUD.
