/**
 * AUDIO — procedural BGM engine.
 *
 * A lookahead scheduler (the standard "setInterval polls, AudioContext
 * clock schedules" pattern) drives five tracks, all built from the same D
 * natural-minor family so crossfades never clash. Tracks crossfade over
 * ~1.2s on a `track` bus per active track; COMBAT/BOSS read player HP and
 * enemy count periodically to open a filter / add a layer as the fight
 * gets desperate.
 */
import type { BgmTrack } from "@/lib/bus";
import { game } from "@/game/store";
import { createDistortionCurve, createNoiseBuffer, getCtx, getMusicBus, isReady, now, safeAudio } from "./engine";

const LOOKAHEAD_MS = 25;
const SCHEDULE_AHEAD = 0.15; // seconds of the AudioContext clock kept scheduled
const CROSSFADE = 1.2; // seconds
const DUCK_LEVEL = 0.35; // music level while ECHO-01 speaks

/* ------------------------------------------------------------ music key
 * D natural minor. Everything (pads, basses, stabs) draws from this so
 * crossfading BRIEFING -> COMBAT -> BOSS -> VICTORY never clashes.
 */
const ROOT = 36.71; // D1
const SCALE = [0, 2, 3, 5, 7, 8, 10];

function freqOf(step: number, octave: number): number {
  const len = SCALE.length;
  const s = SCALE[((step % len) + len) % len];
  return ROOT * Math.pow(2, octave + s / 12);
}

function bpmFor(track: BgmTrack): number {
  switch (track) {
    case "COMBAT":
      return 128;
    case "BOSS":
      return 92;
    case "BRIEFING":
      return 76;
    case "VICTORY":
      return 58;
    default:
      return 70;
  }
}

/* ------------------------------------------------------------------ voice
 * One "voice" = one active or fading-out track: its own gain bus (for the
 * crossfade) feeding an intensity-controlled lowpass, then into the shared
 * music bus from engine.ts.
 */
interface Voice {
  track: BgmTrack;
  bus: GainNode;
  filter: BiquadFilterNode;
  target: number; // resting gain once fade-in completes
  stepIndex: number;
  nextTime: number;
  stepDur: number; // seconds per 16th note
  stingDone: boolean;
  fadingOut: boolean;
  stopAt: number | null; // AudioContext time to disconnect + stop generating
  // persistent drone/pad oscillators for ambient/pad-style tracks
  sustained: { osc: OscillatorNode; gain: GainNode }[];
}

let timer: ReturnType<typeof setInterval> | null = null;
let retryTimer: ReturnType<typeof setTimeout> | null = null;
let desired: BgmTrack = "NONE";
let active: Voice | null = null;
const fading: Voice[] = [];
let intensity = 0; // 0..1 smoothed, read from game state
let lastIntensityPoll = 0;
let duckDepth = 0; // 0 = normal, 1 = fully ducked (set by AudioLink while ECHO-01 speaks)

function stopVoice(ctx: AudioContext, v: Voice): void {
  safeAudio(() => {
    v.sustained.forEach(({ osc }) => {
      try {
        osc.stop(ctx.currentTime + 0.05);
      } catch {
        // already stopped
      }
    });
    v.sustained = [];
    v.bus.disconnect();
  });
}

function newVoice(ctx: AudioContext, track: BgmTrack, dest: AudioNode): Voice {
  const bus = ctx.createGain();
  bus.gain.value = 0.0001;
  const filter = ctx.createBiquadFilter();
  filter.type = "lowpass";
  filter.frequency.value = 2200;
  filter.connect(dest);
  bus.connect(filter);

  const bpm = bpmFor(track);
  const beat = 60 / bpm;
  return {
    track,
    bus,
    filter,
    target: track === "AMBIENT" ? 0.55 : 0.85,
    stepIndex: 0,
    nextTime: ctx.currentTime + 0.05,
    stepDur: beat / 4,
    stingDone: false,
    fadingOut: false,
    stopAt: null,
    sustained: [],
  };
}

function fadeIn(ctx: AudioContext, v: Voice): void {
  safeAudio(() => {
    v.bus.gain.cancelScheduledValues(ctx.currentTime);
    v.bus.gain.setValueAtTime(0.0001, ctx.currentTime);
    v.bus.gain.exponentialRampToValueAtTime(v.target, ctx.currentTime + CROSSFADE);
  });
}

function fadeOutAndRetire(ctx: AudioContext, v: Voice): void {
  safeAudio(() => {
    v.fadingOut = true;
    v.bus.gain.cancelScheduledValues(ctx.currentTime);
    const current = Math.max(v.bus.gain.value, 0.0001);
    v.bus.gain.setValueAtTime(current, ctx.currentTime);
    v.bus.gain.exponentialRampToValueAtTime(0.0001, ctx.currentTime + CROSSFADE);
    v.stopAt = ctx.currentTime + CROSSFADE + 0.05;
    fading.push(v);
  });
}

/* -------------------------------------------------------------- helpers */

function tone(
  ctx: AudioContext,
  dest: AudioNode,
  type: OscillatorType,
  freq: number,
  t0: number,
  dur: number,
  peak: number,
  attack = 0.005,
): void {
  const g = ctx.createGain();
  g.connect(dest);
  const o = ctx.createOscillator();
  o.type = type;
  o.frequency.setValueAtTime(freq, t0);
  o.connect(g);
  o.start(t0);
  o.stop(t0 + dur + 0.05);
  const p = g.gain;
  p.setValueAtTime(0.0001, t0);
  p.exponentialRampToValueAtTime(Math.max(peak, 0.0001), t0 + attack);
  p.exponentialRampToValueAtTime(0.0001, t0 + dur);
}

function noiseHit(ctx: AudioContext, dest: AudioNode, t0: number, dur: number, filterFreq: number, peak: number): void {
  const buffer = createNoiseBuffer(dur);
  if (!buffer) return;
  const src = ctx.createBufferSource();
  src.buffer = buffer;
  const bp = ctx.createBiquadFilter();
  bp.type = "bandpass";
  bp.frequency.value = filterFreq;
  bp.Q.value = 1;
  const g = ctx.createGain();
  src.connect(bp);
  bp.connect(g);
  g.connect(dest);
  src.start(t0);
  src.stop(t0 + dur + 0.02);
  g.gain.setValueAtTime(0.0001, t0);
  g.gain.exponentialRampToValueAtTime(Math.max(peak, 0.0001), t0 + 0.003);
  g.gain.exponentialRampToValueAtTime(0.0001, t0 + dur);
}

function kick(ctx: AudioContext, dest: AudioNode, t0: number, peak = 0.9): void {
  const g = ctx.createGain();
  g.connect(dest);
  const o = ctx.createOscillator();
  o.type = "sine";
  o.frequency.setValueAtTime(150, t0);
  o.frequency.exponentialRampToValueAtTime(45, t0 + 0.12);
  o.connect(g);
  o.start(t0);
  o.stop(t0 + 0.2);
  g.gain.setValueAtTime(0.0001, t0);
  g.gain.exponentialRampToValueAtTime(peak, t0 + 0.004);
  g.gain.exponentialRampToValueAtTime(0.0001, t0 + 0.18);
}

function snare(ctx: AudioContext, dest: AudioNode, t0: number, peak = 0.5): void {
  noiseHit(ctx, dest, t0, 0.12, 1800, peak);
}

/* --------------------------------------------------------- track voices */

function ensureSustained(ctx: AudioContext, v: Voice, specs: { freq: number; type: OscillatorType; gain: number }[]): void {
  if (v.sustained.length > 0) return;
  specs.forEach((spec) => {
    const g = ctx.createGain();
    g.gain.value = 0.0001;
    g.connect(v.bus);
    const o = ctx.createOscillator();
    o.type = spec.type;
    o.frequency.value = spec.freq;
    o.connect(g);
    o.start();
    g.gain.exponentialRampToValueAtTime(spec.gain, ctx.currentTime + 1.5);
    v.sustained.push({ osc: o, gain: g });
  });
}

function scheduleAmbient(ctx: AudioContext, v: Voice, t0: number): void {
  ensureSustained(ctx, v, [
    { freq: freqOf(0, -2), type: "sine", gain: 0.35 },
    { freq: freqOf(4, -2) * 1.003, type: "sine", gain: 0.18 }, // gentle beat between two low sines: cockpit hum
  ]);
  // occasional sonar ping
  if (Math.random() < 0.22) {
    tone(ctx, v.bus, "sine", freqOf(7, 1), t0, 1.4, 0.22, 0.02);
  }
}

function scheduleBriefing(ctx: AudioContext, v: Voice, t0: number, step: number): void {
  ensureSustained(ctx, v, [
    { freq: freqOf(0, -1), type: "sine", gain: 0.22 },
    { freq: freqOf(2, -1), type: "sine", gain: 0.14 },
    { freq: freqOf(4, -1), type: "triangle", gain: 0.1 },
  ]);
  // soft pulse on the beat (every 4 sixteenths)
  if (step % 4 === 0) {
    tone(ctx, v.bus, "sine", freqOf(0, 0), t0, 0.5, 0.14, 0.05);
  }
}

function scheduleCombat(ctx: AudioContext, v: Voice, t0: number, step: number, intensityNow: number): void {
  const s16 = step % 16;
  // driving 16th-note bass ostinato
  const bassPattern = [0, 0, 3, 0, 0, 3, 5, 0, 0, 0, 3, 0, 0, 5, 3, 0];
  tone(ctx, v.bus, "sawtooth", freqOf(bassPattern[s16], -2), t0, v.stepDur * 0.9, 0.22, 0.002);
  // kick 1 & 3
  if (s16 === 0 || s16 === 8) kick(ctx, v.bus, t0, 0.8);
  // snare 2 & 4
  if (s16 === 4 || s16 === 12) snare(ctx, v.bus, t0, 0.45);
  // tense held pad, sustained
  ensureSustained(ctx, v, [
    { freq: freqOf(0, -1), type: "sawtooth", gain: 0.05 },
    { freq: freqOf(3, -1), type: "sawtooth", gain: 0.045 },
  ]);
  // desperation layer: extra hi-hat-ish tick when things are dicey
  if (intensityNow > 0.55 && s16 % 2 === 0) {
    noiseHit(ctx, v.bus, t0, 0.04, 6000, 0.06 + intensityNow * 0.06);
  }
}

function scheduleBoss(ctx: AudioContext, v: Voice, t0: number, step: number, intensityNow: number): void {
  const s16 = step % 16;
  // half-time heavy kick — only on 1 (and a ghost on the "and of 3")
  if (s16 === 0) kick(ctx, v.bus, t0, 1.0);
  if (s16 === 10) kick(ctx, v.bus, t0, 0.55);
  // distorted detuned bass, driving 16ths under the half-time kick
  const bassPattern = [0, 0, 0, 3, 0, 0, 1, 0, 0, 0, 0, 3, 0, 1, 0, 0];
  const shaper = ctx.createWaveShaper();
  const curve = createDistortionCurve(50);
  if (curve) shaper.curve = curve;
  shaper.connect(v.bus);
  tone(ctx, shaper, "sawtooth", freqOf(bassPattern[s16], -2) * 1.01, t0, v.stepDur * 0.95, 0.28, 0.002);
  tone(ctx, shaper, "square", freqOf(bassPattern[s16], -2) * 0.995, t0, v.stepDur * 0.95, 0.18, 0.002);
  // dissonant tritone stab on the downbeat
  if (s16 === 0) {
    tone(ctx, v.bus, "sawtooth", freqOf(0, -1), t0, 0.4, 0.22, 0.005);
    tone(ctx, v.bus, "sawtooth", freqOf(0, -1) * Math.pow(2, 6 / 12), t0, 0.4, 0.2, 0.005);
  }
  // high metallic pulse, every 8th
  if (s16 % 2 === 0) {
    noiseHit(ctx, v.bus, t0, 0.05, 5200, 0.09 + intensityNow * 0.05);
  }
  // arrival sting: huge descending sweep into a hit, once
  if (!v.stingDone) {
    v.stingDone = true;
    const sg = ctx.createGain();
    sg.connect(v.bus);
    const sweep = ctx.createOscillator();
    sweep.type = "sawtooth";
    sweep.frequency.setValueAtTime(1800, t0);
    sweep.frequency.exponentialRampToValueAtTime(50, t0 + 0.8);
    sweep.connect(sg);
    sweep.start(t0);
    sweep.stop(t0 + 0.85);
    sg.gain.setValueAtTime(0.0001, t0);
    sg.gain.exponentialRampToValueAtTime(0.5, t0 + 0.1);
    sg.gain.exponentialRampToValueAtTime(0.0001, t0 + 0.78);
    kick(ctx, v.bus, t0 + 0.78, 1.0);
    noiseHit(ctx, v.bus, t0 + 0.78, 0.3, 200, 0.6);
  }
}

function scheduleVictory(ctx: AudioContext, v: Voice, t0: number): void {
  ensureSustained(ctx, v, [
    { freq: freqOf(0, -1), type: "triangle", gain: 0.18 },
    { freq: freqOf(2, -1), type: "triangle", gain: 0.14 },
    { freq: freqOf(4, -1), type: "sine", gain: 0.12 },
    { freq: freqOf(0, 0), type: "sine", gain: 0.08 },
  ]);
}

/* ------------------------------------------------------------ intensity */

function pollIntensity(): void {
  safeAudio(() => {
    const s = game.get();
    const hpPct = s.player.maxHp > 0 ? s.player.hp / s.player.maxHp : 1;
    const enemyCount = s.enemies.filter((e) => e.state !== "DESTROYED").length;
    const target = Math.max(0, Math.min(1, (1 - hpPct) * 0.6 + Math.min(enemyCount, 5) / 5 * 0.4));
    // smooth
    intensity += (target - intensity) * 0.25;
  });
}

/* -------------------------------------------------------------- ticking */

function tick(): void {
  const ctx = getCtx();
  const dest = getMusicBus();
  if (!ctx || !dest) return;

  const t = ctx.currentTime;
  if (t - lastIntensityPoll > 0.5) {
    lastIntensityPoll = t;
    pollIntensity();
  }

  // apply duck + intensity to whichever voice is active
  if (active) {
    safeAudio(() => {
      const cutoff = active!.track === "COMBAT" || active!.track === "BOSS" ? 900 + intensity * 2600 : 2200;
      active!.filter.frequency.setTargetAtTime(cutoff, t, 0.4);
      const duckMul = 1 - duckDepth * (1 - DUCK_LEVEL);
      active!.bus.gain.setTargetAtTime(active!.fadingOut ? active!.bus.gain.value : active!.target * duckMul, t, 0.15);
    });
  }

  // schedule ahead for the active voice
  if (active && !active.fadingOut) {
    const v = active;
    while (v.nextTime < t + SCHEDULE_AHEAD) {
      safeAudio(() => {
        switch (v.track) {
          case "AMBIENT":
            scheduleAmbient(ctx, v, v.nextTime);
            break;
          case "BRIEFING":
            scheduleBriefing(ctx, v, v.nextTime, v.stepIndex);
            break;
          case "COMBAT":
            scheduleCombat(ctx, v, v.nextTime, v.stepIndex, intensity);
            break;
          case "BOSS":
            scheduleBoss(ctx, v, v.nextTime, v.stepIndex, intensity);
            break;
          case "VICTORY":
            scheduleVictory(ctx, v, v.nextTime);
            break;
          case "NONE":
          default:
            break;
        }
      });
      v.stepIndex += 1;
      // AMBIENT pings on a slower, looser clock than a strict 16th grid
      v.nextTime += v.track === "AMBIENT" ? 1.2 : v.stepDur;
    }
  }

  // retire fully faded-out voices
  for (let i = fading.length - 1; i >= 0; i--) {
    const v = fading[i];
    if (v.stopAt !== null && t >= v.stopAt) {
      stopVoice(ctx, v);
      fading.splice(i, 1);
    }
  }
}

function ensureScheduler(): void {
  if (timer !== null) return;
  const ctx = getCtx();
  if (!ctx) return;
  timer = setInterval(() => safeAudio(tick), LOOKAHEAD_MS);
}

function applyDesired(): void {
  const ctx = getCtx();
  const dest = getMusicBus();
  if (!ctx || !dest) return;

  if (active && active.track === desired) return; // already there

  if (active) {
    fadeOutAndRetire(ctx, active);
    active = null;
  }

  if (desired === "NONE") return;

  const v = newVoice(ctx, desired, dest);
  active = v;
  fadeIn(ctx, v);
  ensureScheduler();
}

let retryCount = 0;
function scheduleRetry(): void {
  if (retryTimer !== null || retryCount > 60) return;
  retryTimer = setTimeout(() => {
    retryTimer = null;
    retryCount += 1;
    if (isReady()) {
      applyDesired();
    } else {
      scheduleRetry();
    }
  }, 200);
}

/** Request a track. Crossfades from whatever is currently playing. */
export function setTrack(track: BgmTrack): void {
  desired = track;
  safeAudio(() => {
    if (!isReady()) {
      scheduleRetry();
      return;
    }
    retryCount = 0;
    applyDesired();
  });
}

/** Duck the whole music bus to ~35% (ECHO-01 speaking). */
export function duckMusic(): void {
  duckDepth = 1;
}

/** Restore the music bus after ECHO-01 finishes speaking. */
export function unduckMusic(): void {
  duckDepth = 0;
}
