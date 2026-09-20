# AETHER FRAME — Realistic Redesign Brief (2026-09-20)

Amends `docs/CONTRACT.md`. Three specialists build this in parallel; this file is the shared surface.

## The ask (from the pilot)

> 寫實風，不要現在的像素風。要有圓形駕駛艙、哈囉（我們的原創版本 ECHO-01）、武器選項。

Translate: **realistic military-mecha look**, not flat/retro-pixel. A **circular cockpit** the pilot
looks out of. The **spherical companion drone ECHO-01** physically present in the cockpit.
A **selectable weapon loadout** the pilot switches by voice, key or click.

## Locked decisions (new)

| Thing | Value |
|---|---|
| Renderer | **three.js `0.186`** (`three`, `@types/three` installed). WebGL2 with a `WebGLRenderer`; on failure fall back to the legacy 2D canvas viewport. Everything is still procedural — geometry built in code, no model/texture/image/audio files. |
| Look | Physically-based: `MeshStandardMaterial`/`MeshPhysicalMaterial`, one hard sun (`DirectionalLight`) + Earthshine fill + emissive accents, real shadows on the mech and the cockpit, ACES tonemapping, subtle bloom (UnrealBloomPass from `three/examples/jsm`), film grain/vignette allowed. No cel outlines, no flat fills, no neon-cyberpunk saturation. Reference: Real Robot military anime rendered as a live-action cockpit — matte painted armour with chipped edges, warning decals, weld seams, hydraulics, heat haze. |
| Canopy | **Circular aperture** — `canopyAperture(width, height)` in `src/components/cockpit/layout.ts`. HUD lives outside the circle; the viewport's physical frame has its inner rim on the circle. Both sides use only that function. |
| ECHO-01 | Floating spherical drone, **original design**: segmented matte shell, machined equatorial ring, a single iris lens (no face, no ears, no Haro silhouette). Lives in the 3D scene, upper-right of the pilot's view, tethered by nothing — it hovers. Reacts to `aiStatus` (IDLE breathe · LISTENING iris dilates, ring tilts toward pilot · THINKING ring spins · SPEAKING iris pulses with the caption), to `fx:playerHit` (recoil, iris flashes red), to a kill (barrel roll), to `phase` BOSS_INTRO (retreats, iris narrows). |
| Weapons | `WEAPONS` in `src/lib/config.ts` (RIFLE · CANNON · MISSILE · BLADE). `player.weapon` in the store. `SWITCH_WEAPON` command. `weapon:changed` bus event. `fx:fire` now carries `weapon`. New audio cues `WEAPON_SWITCH`, `FIRE_CANNON`, `FIRE_MISSILE`, `FIRE_BLADE`. Keys: **`Q` next weapon, `W` previous weapon**; digits stay rehearsal keys. |
| Voice shapes | "switch to cannon" · "cannon" · "missiles" / "missile pod" · "blade" / "sword" · "rifle" · "next weapon" · "previous weapon" — REFLEX path. Anything fuzzier goes NEURAL via a `switch_weapon` tool. |
| Demo safety | Unchanged and non-negotiable: no API key/no network still runs; nothing throws on unsupported browsers; every voice command has a key. |

## Ownership (touch only your own files)

| Specialist | Files | Notes |
|---|---|---|
| **3D / viewport engineer** | `src/components/viewport/**` | New three.js `BattleViewport` (same export name/props). Move the current canvas renderer to `src/components/viewport/legacy/` and use it as the WebGL fallback. Owns: lunar world, lighting, MANTIS-01 + CRIMSON-01 procedural 3D models and animation, the AETHER FRAME's own arms/weapon visible at the bottom of the view (swap on `weapon:changed`), all weapon fire FX per weapon, hits/explosions/wrecks, the **round cockpit interior** (frame ring on the aperture, struts, glass with reflections/dirt, seat edges, console silhouette), and the **ECHO-01 drone** inside the cockpit. |
| **UI/UX designer** | `src/components/cockpit/**`, `src/components/radar/**`, `src/components/ai-core/**`, `src/components/voice/VoiceBar.tsx`, `src/app/globals.css` (extend tokens/classes, never delete existing ones) | HUD as real glass MFDs (multi-function displays) arranged around the circular aperture: bezels, backlight bleed, subtle reflections, instrument typography. Keep `PanelFrame` ids `radar system mission weapons comms ai-core pilot` (the director powers them on by id). **Weapon selector** in the WEAPONS MFD: four slots, current highlighted, click/tap switches via `runManualCommand({ action: "SWITCH_WEAPON", weapon })` from `@/voice/pipeline`, shows heat/energy cost/range and a range warning when the locked target is outside `maxRange`. `AiCore` becomes ECHO-01's caption strip + status (the drone itself is in 3D). Radar stays top-down but realistic (phosphor, sweep, range rings, real bearing math). |
| **Weapons / gameplay engineer** | `src/game/commands.ts`, `src/game/director.ts` (only if a weapon beat is needed), `src/ai/**`, `src/app/api/copilot/route.ts`, `src/voice/reflex.ts`, `src/voice/keyboard.ts`, `src/audio/sfx.ts`, `src/audio/AudioLink.tsx` (cue wiring only) | `SWITCH_WEAPON` handler (emit `weapon:changed`, `audio:cue WEAPON_SWITCH`, `hud:alert`, speech). ATTACK uses the selected weapon's damage/heat/energy/splash/maxRange; BLADE out of range is denied with a useful line; MISSILE fires a 6-round salvo hitting everything in the cone; CANNON ×1.8 on open weak points. `fx:fire` includes `weapon`. Reflex phrases + `Q`/`W` keys. `switch_weapon` tool for Claude + mock brain + prompt text so ECHO-01 recommends weapons ("Blade range — close in and switch to the blade"). Advisor: call out when the target is inside blade range or a weak point opens while the cannon is selected. Synthesize the four new cues. |

Integrator (me) owns `src/app/page.tsx`, `layout.tsx`, `README.md`, `docs/**`, `src/lib/**`, `src/game/types.ts`, `src/game/store.ts`, `package.json`.

## Shared geometry — read `src/components/cockpit/layout.ts`

```ts
canopyAperture(width, height) → { cx, cy, r }   // circle in CSS px
hudSideColumnWidth(width, height)                // px per side for MFD columns
```

The 3D camera's horizontal FOV maps bearing ±35° onto the aperture's horizontal diameter
(so an enemy at bearing 0 is dead centre and ±35° is the rim). Enemies live at polar
(`bearing`, `distance`, `altitude`) relative to the pilot — see `Enemy` in `src/game/types.ts`.

## Verification available

- `npx tsc --noEmit 2>&1 | grep "<your dir>"` — must be clean for your files.
- `npx eslint <your files>` — no new errors (pre-existing `set-state-in-effect` errors elsewhere are known).
- Dev server is already running on **http://localhost:3000** with hot reload — **do not start another**.
- Headless screenshots: `/tmp/gundum-e2e/` has `playwright` installed (uses system Chrome). `shot2.mjs` there is a template: it loads the page, presses `5` (skip to COMBAT), `l`/`f` (lock/fire), `6` (BOSS_INTRO→BOSS) and saves PNGs. Copy and adapt it; WebGL works headless via SwiftShader.
- Rehearsal keys: `1` STANDBY … `5` COMBAT, `6` BOSS_INTRO, `7` VICTORY, `0` reset. `/` types a command.
