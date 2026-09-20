# AETHER FRAME

**A voice-controlled AI co-pilot that turns a browser into a living mecha cockpit.**

You do not open a website. You say a word into a dark room, and a war machine wakes up.

```
VOICE LINK
STANDBY

SAY "ECHO" TO INITIALIZE
```

## Run it

```bash
npm install
cp .env.example .env.local   # optional — put an ANTHROPIC_API_KEY in it
npm run dev
```

Open http://localhost:3000 in **desktop Chrome or Edge** and allow the microphone.
Speech recognition needs Chromium and a network connection; everything else runs locally.

**With no API key and no network the entire demo still runs** on a local mock brain and a
hand-written fallback script. Nothing on stage depends on a request succeeding.

## What it is

| | |
|---|---|
| Pilot's machine | **AETHER FRAME** |
| AI co-pilot | **ECHO-01** — original design, a floating geometric drone |
| Hostiles | **MANTIS-01**, green mass-production units of the **VOID FLEET** |
| Ace | **CRIMSON-01**, *THE RED ACE* — analyses how you fight and stops falling for it |

All names, designs, UI, music and sound in this project are original. Nothing is
borrowed from any existing franchise.

## The AI is not a chat box

The co-pilot holds tools and the game state, and commands travel down two paths at once:

```
voice → transcript ─┬─ REFLEX  keyword match, <50ms ──┐
                    └─ NEURAL  Claude tool calling ───┴→ executeCommand() → game state → HUD · audio · TTS
```

Combat verbs ("attack", "lock the nearest") take the reflex path so the mech answers
instantly. Everything else — questions, unusual phrasings, "how long can we hold?" —
goes to Claude with a snapshot of the live battle, comes back as tool calls, and runs
through the exact same funnel. The HUD labels which link served each command, so the
architecture is visible on screen.

Beyond taking orders the co-pilot watches the fight and speaks up on its own: hostiles
converging, armor below thirty percent, an opening in the ace's defense.

## The Red Ace actually adapts

`CRIMSON-01` reads your telemetry, not a script. Keep attacking head-on and it measures it:

```
TACTICAL PATTERN DETECTED
FRONTAL ATTACK FREQUENCY: 78%

TACTICAL ADAPTATION
FLANKING MANEUVER
```

Then it swings to your flank and your habit stops working. Lean on boost and it learns to
intercept; turtle behind guard and it switches to armor-piercing fire.

## Voice commands

Natural language — these are the shapes, not a fixed list.

```
lock the nearest target        attack / open fire / take it down
lock the one on the right      precision shot   ·   barrage
lock the red one               defend · evade · full boost · fall back
analyze that unit              scan · where are they
what's our status              how long can we hold?
finish it                      (special, once charged)
```

## Keyboard fallback

Every command has a key, because microphones fail in front of an audience.

| Key | |  | Key | |
|---|---|---|---|---|
| `Space` | wake / attack | | `A` | analyze |
| `L` | lock nearest | | `S` | scan |
| `R` | lock the red ace | | `T` | status report |
| `F` | attack | | `X` | special |
| `D` | defend | | `M` (hold) | push-to-talk: hold to speak, release to send |
| `E` | evade | | `/` | type a command instead |
| `B` | boost | | `N` | mute microphone |
| | | | `Ctrl+V` | toggle push-to-talk / always-on listening |
| | | | `1`–`7` | jump to a phase (rehearsal) |
| | | | `0` | reset the demo |

## Demo flow — about five minutes

1. **Black screen.** "ECHO." → `VOICE COMMAND DETECTED`
2. **Boot.** A · E · T · H · E · R each expand into a subsystem, then the load list and `ALL SYSTEMS OPERATIONAL`
3. **Cockpit.** Panels power on one at a time — radar, systems, mission, weapons, comms, AI core, pilot
4. **Briefing.** ECHO-01 greets the pilot and reports live Taipei weather, the mission and system status
5. **Contact.** `HOSTILES DETECTED` — MANTIS waves, fought by voice
6. **The ace.** `WARNING // HIGH ENERGY SIGNATURE DETECTED`, the music drops into half-time, CRIMSON-01 arrives
7. **Adaptation.** It reads your pattern and changes tactics; ECHO-01 calls it out
8. **`MISSION COMPLETE`** — then back to `VOICE LINK / STANDBY`

## Built with

Next.js 16 · React 19 · TypeScript strict · Tailwind v4 · motion · zustand · Claude (`claude-sonnet-5`) tool calling ·
Web Speech API · Web Audio API · Open-Meteo

Every visual is drawn in code — SVG and canvas, no image files. Every sound, including the
battle music and the ace's entrance sting, is synthesized live in the Web Audio API, and the
score reacts to how badly the fight is going.

## Where this goes next

The cockpit is a shell around a general pattern: voice in, a model holding real tools, typed
state, visible consequences. Swap the tools and the same co-pilot reports your calendar, your
build status, your open pull requests and today's weather — the mission briefing is already
doing exactly that, with a real forecast.

## Layout

```
src/
├── app/              route, layout, /api/copilot, /api/weather
├── components/
│   ├── boot/         black screen → wake word → letter expansion → subsystem load
│   ├── cockpit/      HUD frame and panels
│   ├── radar/        polar radar
│   ├── ai-core/      ECHO-01's presence
│   ├── viewport/     canvas battle view, procedural mecha
│   └── voice/        voice link bar
├── game/             types · store · commands · enemy AI · red ace · director
├── ai/               Claude provider, tools, prompts, advisor, mock brain, weather
├── voice/            speech recognition, TTS, reflex matcher, keyboard fallback
├── audio/            synthesized SFX and reactive BGM
└── lib/              config, event bus
```

`docs/CONTRACT.md` is the module contract the build was split along.
