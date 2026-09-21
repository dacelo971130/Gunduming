# GUNDAM // TACTICAL COCKPIT — System Spec

_Status as of 2026-09-21 (commit `20eb397`). Supersedes nothing; `docs/CONTRACT.md` (module contract) and
`docs/REDESIGN.md` (redesign decisions) remain authoritative for their sections. This document is the
single place that describes what the demo IS today and what the next build phase MUST deliver._

## 1. Product

A voice-controlled AI mecha cockpit in the browser for a live Build Day stage demo. The pilot wakes a
machine by voice, watches it boot, sees their own mech revealed in a lunar hangar, then fights waves of
mass-production mechs and a red ace from inside a round cockpit — by talking to an AI co-pilot.

| Thing | Value |
|---|---|
| Player mech | **GUNDAM** (project AETHER FRAME). White/blue/red hero frame, yellow V-fin, green eyes, beam rifle, shield |
| Wake word | **"GUNDAM"** (mishearings accepted: gun dam, gundum, gandam…). **"ECHO"** also wakes it. Space/Enter is the key fallback |
| Boot letters | **G·U·N·D·A·M** → GENERAL / UNILATERAL / NEURO-LINK / DISPERSIVE / AUTONOMIC / MANEUVER, each mapped to a subsystem |
| Co-pilot | **ECHO-01** — Haro-style round green companion robot, lower-right console cradle inside the canopy |
| Grunt | **MANTIS-01** — Zaku-style monoeye green mass-production mech (VOID FLEET) |
| Ace | **CRIMSON-01, THE RED ACE** — red variant with commander fin antenna; adapts to the pilot's habits |
| Setting | Lunar surface, HYPERION BASE, Earth in the sky, allied battleship parked high left |
| IP note | Franchise styling is a **stage-demo-only** decision by the pilot. Switch names/looks back to the original set (`docs/CONTRACT.md`) before any public release |

## 2. Stack & run

Next.js 16 · React 19 · TypeScript strict · Tailwind v4 · motion · zustand · **three.js 0.186** · @anthropic-ai/sdk · zod ·
Web Speech API · Web Audio API · Open-Meteo.

```bash
npm install
cp .env.example .env.local      # optional ANTHROPIC_API_KEY
npm run dev                     # dev server; the team's instance is on :3177
```

Desktop Chrome/Edge, microphone allowed. WebGL2 required for the 3D view; without it the legacy 2D canvas
renderer (`src/components/viewport/legacy/`) takes over automatically. No API key + no network still runs
the whole demo on the mock brain.

## 3. Phase machine

`STANDBY → WAKE → BOOT(LETTERS → REACTOR → REVEAL → SUBSYSTEMS) → COCKPIT_BOOT → BRIEFING → COMBAT(3 waves) → BOSS_INTRO → BOSS → VICTORY`

- REVEAL = `MechReveal` (~6.2 s third-person hangar shot of the GUNDAM; Space/Enter/Esc skip; skipped under
  `prefers-reduced-motion` or without WebGL2).
- Rehearsal keys: `1` STANDBY … `5` COMBAT, `6` BOSS_INTRO, `7` VICTORY, `0` reset.

## 4. Controls

### 4.1 Voice (en-US, push-to-talk by default)

Hold **`M`** (or `Shift`) to open the mic, release to send. `Ctrl+V` toggles always-on listening. `N` mutes.
Two routes: **REFLEX** (local keyword/fuzzy match, <50 ms) for combat verbs; **NEURAL** (Claude tool calling,
`claude-sonnet-5`) for everything else, with a local mock brain when offline.

| Intent | Phrases (shapes, not a fixed list) |
|---|---|
| Lock | lock the nearest / the one on the left / right / the red one / the strongest |
| Fire | attack · open fire · take it down · precision shot · barrage · fire the cannon (switches first if needed) |
| Turn | turn left / right [N degrees] · turn around · face the target · look at the red one |
| Weapons | rifle · cannon · missiles · blade / sword · incendiary / burn them · nuke · call the fleet / fire support · next / previous weapon |
| Stance | defend · evade · full boost · boost left / right · fall back |
| Intel | analyze that unit · scan · where are they · what's our status · how long can we hold |
| Special | finish it |
| Fuzzy → NEURAL | "give me something heavier", "close-quarters weapon", "something for the group", "which weapon should I use" |

### 4.2 Keyboard (every voice command has one)

| Key | Action | Key | Action |
|---|---|---|---|
| `Space` | wake / attack | `Q` / `W` | next / previous weapon |
| `L` | lock nearest | `←` `→` (hold) | turn 55°/s |
| `R` | lock the red ace | `A` | analyze |
| `F` | attack | `S` | scan |
| `D` | defend | `T` | status report |
| `E` | evade | `X` | special (when charged) |
| `B` | boost | `M` (hold) | push-to-talk |
| `N` | mute | `Ctrl+V` | PTT / always-on |
| `/` | type a command | `1`–`7`, `0` | rehearsal / reset |

Clicking a slot in the WEAPON SELECT MFD also switches weapons.

## 5. Aiming model

- `Enemy.bearing` is RELATIVE to the nose (−180..180, + = right). `player.bearing` is the absolute heading.
- `turnPlayer(delta)` shifts every enemy's relative bearing by −delta and emits `player:turned`; enemy AI and
  the boss shift their cached goals so they never "follow" the turn.
- `LOCK_TARGET` auto-faces the target when it is >12° off the nose.
- Camera hFOV maps bearing ±35° onto the circular aperture's diameter; the world yaws with the heading.
- Enemy AI keeps committed bearings within ±70° (flankers 45–70°, boss flank 45–60°) so targets are reachable
  with a short turn; edge arrows show off-screen contacts.

## 6. Weapons (`WEAPONS` in `src/lib/config.ts`)

| # | Id | Name | Kind | Dmg | Heat | Energy | Range | Cone | Ammo / cooldown | Notes |
|---|---|---|---|---|---|---|---|---|---|---|
| 1 | RIFLE | LINEAR RIFLE | HELD | 22 | 12 | 8 | ∞ | 0° | ∞ | default |
| 2 | CANNON | HEAVY CANNON | HELD | 44 | 30 | 18 | ∞ | 8° | ∞ | ×1.8 on open weak point |
| 3 | MISSILE | MISSILE POD | HELD | 9×6 | 18 | 16 | ≤1100 m | 30° | ∞ | salvo hits everything in cone |
| 4 | BLADE | PLASMA BLADE | HELD | 60 | 8 | 0 | ≤260 m | 0° | ∞ | melee |
| 5 | INCENDIARY | INCENDIARY SHELLS | ORDNANCE | 12 + 8 dps × 6 s | 22 | 14 | ≤1000 m | 25° | 4 · 4 s | burning units skip every 3rd shot |
| 6 | NUKE | TACTICAL NUKE | ORDNANCE | 400 (boss 250 + stagger) | 45 | 30 | ≥450 m | 90° | 1 | 1.2 s arming; shockwave −6 armor if a hit was <650 m |
| 7 | FLEET_CANNON | FLEET CANNON SUPPORT | SUPPORT | 90×3 | 0 | 0 | ∞ | 35° | 45 s | selecting = calling; impact 3 s later; auto-returns to last HELD |

Modes: BURST (default), PRECISION (×1.5 dmg, more heat), BARRAGE (×0.72, wider cone). Fire cues per weapon
(`FIRE`, `FIRE_CANNON`, `FIRE_MISSILE`, `FIRE_BLADE`, `FIRE_INCENDIARY`, `FIRE_NUKE`, `NUKE_ARM`, `FLEET_CALL`,
`FLEET_IMPACT`, `BURNING`, `WEAPON_SWITCH`), all synthesized.

Co-pilot doctrine (prompt + mock + advisor): blade inside 260 m; cannon on an exposed weak point / the ace;
missiles or fleet for groups; nuke only for 3+ enemies beyond 450 m; call-outs throttled (20 s per trigger).

## 7. Screen layout

`src/components/cockpit/layout.ts` is the single geometry source:

- `canopyAperture(w, h)` → circle `{cx: 0.5w, cy: 0.5h, r: min(0.44h, 0.46w)}`.
- HUD MFDs occupy the columns left/right of the circle (`hudSideColumnWidth`); a thin status rail caps the top,
  the voice console the bottom; only the rim gauges (heading tape, HEAT/ENERGY arcs) and ECHO-01's caption
  strip enter the circle.
- Panel ids powered on by the director, in order: `radar system mission weapons comms ai-core pilot`.
- The viewport fills the frame; its 3D cockpit ring has its inner lip exactly on the aperture.

## 8. Viewport (`src/components/viewport/`)

| Module | Owns |
|---|---|
| `BattleViewport.tsx` | WebGL2 detect → `three/scene.ts`; 30 bad frames → `LegacyBattleViewport` |
| `three/scene.ts` | renderer (ACES, shadows 2048, dpr ≤ 2), composer (Bloom → grain/vignette → Output → SMAA), bus wiring, per-frame store read |
| `three/camera.ts` | FOV↔aperture mapping, sway/shake, heading ease (150 ms) + 2–3° bank on turn |
| `three/world.ts` | regolith + analytic craters, seeded stars, Earth, lunar base beacons, battleship, sun + Earthshine |
| `three/mechs.ts`, `parts.ts` | procedural `buildGrunt()` (MANTIS), `buildAce()` (CRIMSON), `buildHero()` (GUNDAM), `buildHeroForearm()`, `buildBeamRifle()` |
| `three/enemies.ts` | polar placement (×1.8 scale), walk/lean/shoulder lag, wind-up freeze, wrecks, burning, nuke hurl |
| `three/cockpit.ts` | canopy ring, glass, dash, lamps, hero forearms with all 7 weapon models, recoil |
| `three/echo.ts` | ECHO-01: sphere 72×54, eyes/iris/pupil, hinged ear flaps, pop-out limbs, cradle; reactions to aiStatus / hits / kills / boss / low hp |
| `three/fx.ts`, `particles.ts`, `overlay.ts` | pooled tracers/shells/missiles/lobs/streaks, beam, slash, explosions, fire pools, nuke, fleet strikes; 2D overlay tags/brackets/arrows/reticle/cracks (≤3, 4 s fade) |
| `MechReveal.tsx`, `three/reveal.ts` | hangar reveal, scripted camera, `onDone` once |

Bus events consumed: `fx:fire(weapon)`, `fx:hit`, `fx:special`, `fx:playerHit`, `fx:nuke`, `fx:fleetCall`,
`fx:fleetImpact`, `phase:changed`, `cmd:executed`, `weapon:changed`, `player:turned`.

## 9. Known gaps (as of this commit)

- Everything is procedural primitives: the GUNDAM/Zaku/Haro read as "block-built" — see §10 for the fix.
- Headless SwiftShader renders ~3 fps (screenshots only); real GPUs are real-time. If a laptop struggles: lower
  bloom, shadow map 1024, dpr 1.
- Speech recognition is English only (Web Speech `en-US`).
- ESLint: a few pre-existing `react-hooks/set-state-in-effect` errors in boot components; tsc is clean.
- Handlers `say()` and the pipeline also speaks `result.speech` (pre-existing double-speak convention).

---

## 10. NEXT PHASE SPEC — Real 3D models (glTF)

**Goal:** the pilot's verdict on the current build is "驚喜，但跟鋼彈完全不一樣". Procedural primitives cannot
deliver franchise-accurate silhouettes. Replace the three hero assets with real glTF models, keeping the
procedural builders as the automatic fallback so the demo never depends on a file loading.

### 10.1 Assets

| Slot | File | Source | Used by |
|---|---|---|---|
| Hero mech (full body) | `public/models/gundam.glb` | pilot-supplied fan model (e.g. RX-78-2 style) | `MechReveal` full body; forearms + rifle for the cockpit view are **extracted by node name** or a separate `gundam-forearm-l/r.glb` |
| Grunt | `public/models/zaku.glb` | pilot-supplied | MANTIS-01 instances (`three/enemies.ts`) |
| Ace | `public/models/zaku-red.glb` (optional) | pilot-supplied; otherwise reuse `zaku.glb` with a red material override + fin antenna primitive | CRIMSON-01 |
| Companion | `public/models/haro.glb` | pilot-supplied | ECHO-01 body; eyes/ears animated by node name if present, else the procedural eyes/ears are parented on top |

Constraints: `.glb` (binary glTF 2.0), ≤ 15 MB each, ≤ 150 k triangles for enemies (they are instanced ×4),
PBR materials baked in (no external textures), Y-up, front = −Z, real-world scale in metres (a hero mech is
18 m tall). Draco/Meshopt compression allowed (`DRACOLoader`/`MeshoptDecoder` from `three/examples/jsm`).
Licensing is the pilot's responsibility; stage demo only.

### 10.2 Loader module — `src/components/viewport/three/models.ts` (new, VIEWPORT ownership)

```ts
export type ModelSlot = "gundam" | "zaku" | "zaku-red" | "haro";
export interface LoadedModel { root: THREE.Group; height: number; nodes: Record<string, THREE.Object3D> }
export function loadModel(slot: ModelSlot): Promise<LoadedModel | null>;  // null = missing/failed → caller uses procedural
export function preloadModels(): void;                                    // kicked off in STANDBY so nothing loads mid-demo
```

- `GLTFLoader` (+ Draco/Meshopt) from `three/examples/jsm`. Cache per slot; clone with `SkeletonUtils.clone`
  for instances. Normalize: recentre on the feet (min-Y = 0), scale so `height` matches the design height
  (hero 18 m, grunt 17.5 m, ace 19 m, haro 0.4 m), face −Z. Enable `castShadow`/`receiveShadow`. Convert
  materials to `MeshStandardMaterial` if not already PBR; apply `envMapIntensity` consistent with the scene.
- Node-name conventions for optional animation hooks (documented in the loader; all optional):
  `Head`, `ArmL`, `ArmR`, `ForearmL`, `ForearmR`, `Rifle`, `Shield`, `EyeL`, `EyeR`, `Monoeye`, `EarL`, `EarR`,
  `Mouth`, `Hatch`. If a name is missing, the corresponding animation is skipped, never thrown.
- Failure policy: any error (404, parse, WebGL) → resolve `null`, log once to the HUD comms
  (`pushLog("WARN", "Model <slot> unavailable — procedural fallback")`), keep the procedural rig.
- Timeout: 8 s per model; the reveal must not wait — if `gundam` isn't ready when REVEAL starts, use procedural.

### 10.3 Integration points

| Where | Change |
|---|---|
| `three/reveal.ts` | `buildHero()` → `loadModel("gundam") ?? buildHero()`. Camera path keys stay relative to `height`. Eyes-ignite beat uses `EyeL/EyeR` emissive if present, else the flare only. Hatch beat uses `Hatch` node rotation if present. |
| `three/enemies.ts` | per kind: `zaku` / `zaku-red` clone per instance; keep `ENEMY_SCALE`, wreck tipping, burning emitters (attach to bounding-box centre), weak-point marker at chest height = `0.62·height`. Walk bob/lean applied to the root. Monoeye glow: emissive on `Monoeye` node if present. |
| `three/cockpit.ts` | forearms: if `ForearmL/R` + `Rifle` nodes exist in `gundam.glb`, clone them for the first-person arms (scale to current placement); else keep `buildHeroForearm`. Weapon swaps keep the procedural weapon models attached to the hand node. |
| `three/echo.ts` | body from `haro.glb` if present; procedural eyes/ears overlay only when the model lacks `EyeL/EyeR/EarL/EarR`. All behaviour (bounce, blink, reactions) unchanged. |
| `docs/CONTRACT.md` "Art 100% procedural" | amend: procedural remains the guaranteed fallback; glb assets are optional overlays. |

### 10.4 Acceptance

1. With all four files present: reveal shows the loaded GUNDAM; combat shows Zaku-style grunts and a red ace;
   ECHO-01 is the loaded Haro; no console errors; 60 fps at 1440×900 on an integrated GPU (measure with the
   existing playwright scripts + `performance.now()` frame timing logged once).
2. With the `public/models/` folder empty: identical behaviour to today's build (procedural), one WARN line per
   missing slot, no delay in the boot flow.
3. `npx tsc --noEmit` clean; `npx eslint src/components/viewport` clean.
4. Screenshots committed to `docs/shots/` (reveal, combat, haro close-up, boss) for the record.

### 10.5 Out of scope for this phase

Rigged walk animations from the glb (we keep procedural bob/lean on the root), Chinese speech recognition,
publishing/IP clean-up.
