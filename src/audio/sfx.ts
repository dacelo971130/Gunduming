/**
 * AUDIO — one synthesized sound per AudioCue.
 *
 * Every cue is built from oscillators, a noise buffer, biquad filters and
 * gain envelopes — no samples. Pitch is jittered a few percent per call so
 * repeated cues (LOCK, FIRE, IMPACT...) don't sound machine-gunned.
 */
import type { AudioCue } from "@/lib/bus";
import { createDistortionCurve, createNoiseBuffer, getCtx, getSfxBus, now, safeAudio } from "./engine";

function jitter(base: number, pct = 0.04): number {
  return base * (1 + (Math.random() * 2 - 1) * pct);
}

/** Exponential-shaped AD(S)R envelope on a GainNode's gain param. Returns end time. */
function envelope(
  gain: GainNode,
  t0: number,
  attack: number,
  peak: number,
  decay: number,
  sustain = 0.0001,
  release = 0,
): number {
  const p = gain.gain;
  p.cancelScheduledValues(t0);
  p.setValueAtTime(0.0001, t0);
  p.exponentialRampToValueAtTime(Math.max(peak, 0.0001), t0 + Math.max(attack, 0.001));
  const decayEnd = t0 + Math.max(attack, 0.001) + Math.max(decay, 0.001);
  p.exponentialRampToValueAtTime(Math.max(sustain, 0.0001), decayEnd);
  if (release > 0) {
    const releaseEnd = decayEnd + release;
    p.exponentialRampToValueAtTime(0.0001, releaseEnd);
    p.setValueAtTime(0, releaseEnd + 0.02);
    return releaseEnd;
  }
  p.setValueAtTime(0, decayEnd + 0.02);
  return decayEnd;
}

function makeOsc(
  ctx: AudioContext,
  type: OscillatorType,
  freq: number,
  dest: AudioNode,
  t0: number,
  t1: number,
): OscillatorNode {
  const o = ctx.createOscillator();
  o.type = type;
  o.frequency.setValueAtTime(freq, t0);
  o.connect(dest);
  o.start(t0);
  o.stop(t1 + 0.03);
  return o;
}

function makeNoise(ctx: AudioContext, duration: number, dest: AudioNode, t0: number): AudioBufferSourceNode | null {
  const buffer = createNoiseBuffer(duration);
  if (!buffer) return null;
  const src = ctx.createBufferSource();
  src.buffer = buffer;
  src.connect(dest);
  src.start(t0);
  src.stop(t0 + duration + 0.03);
  return src;
}

function makeFilter(
  ctx: AudioContext,
  type: BiquadFilterType,
  freq: number,
  q: number,
  dest: AudioNode,
): BiquadFilterNode {
  const f = ctx.createBiquadFilter();
  f.type = type;
  f.frequency.value = freq;
  f.Q.value = q;
  f.connect(dest);
  return f;
}

/* -------------------------------------------------------------- cue defs */

type CueBuilder = (ctx: AudioContext, dest: AudioNode, t0: number) => void;

function cueWake(ctx: AudioContext, dest: AudioNode, t0: number): void {
  // rising filtered sweep — the machine drawing breath
  const g = ctx.createGain();
  const lp = makeFilter(ctx, "lowpass", 200, 0.8, dest);
  g.connect(lp);
  const o = makeOsc(ctx, "sawtooth", jitter(90), g, t0, t0 + 0.55);
  o.frequency.exponentialRampToValueAtTime(jitter(380), t0 + 0.5);
  lp.frequency.setValueAtTime(200, t0);
  lp.frequency.exponentialRampToValueAtTime(2200, t0 + 0.5);
  envelope(g, t0, 0.08, 0.5, 0.45, 0.15, 0.05);

  // soft impact landing the breath
  const ig = ctx.createGain();
  const ilp = makeFilter(ctx, "lowpass", 400, 1, dest);
  ig.connect(ilp);
  makeNoise(ctx, 0.2, ig, t0 + 0.48);
  envelope(ig, t0 + 0.48, 0.005, 0.6, 0.18, 0.0001);
}

function cueBootTick(ctx: AudioContext, dest: AudioNode, t0: number): void {
  const g = ctx.createGain();
  g.connect(dest);
  makeOsc(ctx, "square", jitter(720, 0.12), g, t0, t0 + 0.05);
  envelope(g, t0, 0.002, 0.35, 0.05, 0.0001);
}

function cueBootDone(ctx: AudioContext, dest: AudioNode, t0: number): void {
  const notes = [440, 554.37, 659.25]; // A4 - C#5 - E5, ascending confirmation
  notes.forEach((f, i) => {
    const g = ctx.createGain();
    g.connect(dest);
    const start = t0 + i * 0.09;
    makeOsc(ctx, "triangle", f, g, start, start + 0.22);
    envelope(g, start, 0.005, 0.32, 0.2, 0.0001);
  });
}

function cuePanelOn(ctx: AudioContext, dest: AudioNode, t0: number): void {
  const g = ctx.createGain();
  const bp = makeFilter(ctx, "bandpass", 500, 1.2, dest);
  g.connect(bp);
  bp.frequency.setValueAtTime(400, t0);
  bp.frequency.exponentialRampToValueAtTime(3200, t0 + 0.28);
  makeNoise(ctx, 0.3, g, t0);
  envelope(g, t0, 0.02, 0.45, 0.26, 0.0001);
}

function cueBeep(ctx: AudioContext, dest: AudioNode, t0: number): void {
  const g = ctx.createGain();
  g.connect(dest);
  makeOsc(ctx, "triangle", jitter(980), g, t0, t0 + 0.08);
  envelope(g, t0, 0.003, 0.3, 0.08, 0.0001);
}

function cueDeny(ctx: AudioContext, dest: AudioNode, t0: number): void {
  [420, 300].forEach((f, i) => {
    const g = ctx.createGain();
    g.connect(dest);
    const start = t0 + i * 0.11;
    makeOsc(ctx, "square", f, g, start, start + 0.09);
    envelope(g, start, 0.002, 0.28, 0.08, 0.0001);
  });
}

function cueLock(ctx: AudioContext, dest: AudioNode, t0: number): void {
  // double-click
  [0, 0.09].forEach((dt) => {
    const g = ctx.createGain();
    g.connect(dest);
    makeOsc(ctx, "square", jitter(1500, 0.05), g, t0 + dt, t0 + dt + 0.02);
    envelope(g, t0 + dt, 0.001, 0.4, 0.02, 0.0001);
  });
  // pitched tail
  const tg = ctx.createGain();
  tg.connect(dest);
  const tail = makeOsc(ctx, "sine", jitter(1200), tg, t0 + 0.1, t0 + 0.32);
  tail.frequency.exponentialRampToValueAtTime(jitter(700), t0 + 0.3);
  envelope(tg, t0 + 0.1, 0.005, 0.3, 0.2, 0.0001);
}

function cueFire(ctx: AudioContext, dest: AudioNode, t0: number): void {
  const g = ctx.createGain();
  const bp = makeFilter(ctx, "bandpass", 1400, 1.5, dest);
  g.connect(bp);
  bp.frequency.setValueAtTime(1600, t0);
  bp.frequency.exponentialRampToValueAtTime(300, t0 + 0.16);
  makeNoise(ctx, 0.18, g, t0);
  envelope(g, t0, 0.001, 0.55, 0.15, 0.0001);

  const bg = ctx.createGain();
  bg.connect(dest);
  const body = makeOsc(ctx, "sawtooth", jitter(500), bg, t0, t0 + 0.14);
  body.frequency.exponentialRampToValueAtTime(jitter(80), t0 + 0.13);
  envelope(bg, t0, 0.001, 0.4, 0.12, 0.0001);
}

function cueImpact(ctx: AudioContext, dest: AudioNode, t0: number): void {
  const g = ctx.createGain();
  const shaper = ctx.createWaveShaper();
  const curve = createDistortionCurve(24);
  if (curve) shaper.curve = curve;
  shaper.connect(dest);
  const lp = makeFilter(ctx, "lowpass", 500, 1, shaper);
  g.connect(lp);
  makeOsc(ctx, "triangle", jitter(90), g, t0, t0 + 0.18);
  envelope(g, t0, 0.001, 0.6, 0.16, 0.0001);
}

function cueExplosion(ctx: AudioContext, dest: AudioNode, t0: number): void {
  const g = ctx.createGain();
  const lp = makeFilter(ctx, "lowpass", 3500, 0.9, dest);
  g.connect(lp);
  lp.frequency.setValueAtTime(3500, t0);
  lp.frequency.exponentialRampToValueAtTime(120, t0 + 1.1);
  makeNoise(ctx, 1.2, g, t0);
  envelope(g, t0, 0.005, 0.7, 1.0, 0.0001);

  // sub thump
  const sg = ctx.createGain();
  sg.connect(dest);
  const sub = makeOsc(ctx, "sine", 70, sg, t0, t0 + 0.5);
  sub.frequency.exponentialRampToValueAtTime(32, t0 + 0.45);
  envelope(sg, t0, 0.002, 0.85, 0.45, 0.0001);
}

function cuePlayerHit(ctx: AudioContext, dest: AudioNode, t0: number): void {
  const g = ctx.createGain();
  const shaper = ctx.createWaveShaper();
  const curve = createDistortionCurve(40);
  if (curve) shaper.curve = curve;
  shaper.connect(dest);
  const lp = makeFilter(ctx, "lowpass", 700, 1, shaper);
  g.connect(lp);
  makeNoise(ctx, 0.3, g, t0);
  envelope(g, t0, 0.001, 0.9, 0.26, 0.0001);

  // low thud body
  const bg = ctx.createGain();
  bg.connect(dest);
  const body = makeOsc(ctx, "triangle", jitter(70), bg, t0, t0 + 0.3);
  body.frequency.exponentialRampToValueAtTime(jitter(38), t0 + 0.28);
  envelope(bg, t0, 0.001, 0.8, 0.26, 0.0001);

  // metallic ring
  const rg = ctx.createGain();
  const bp = makeFilter(ctx, "bandpass", jitter(1800), 12, dest);
  rg.connect(bp);
  makeOsc(ctx, "square", jitter(1800), rg, t0 + 0.02, t0 + 0.45);
  envelope(rg, t0 + 0.02, 0.005, 0.35, 0.4, 0.0001);
}

function cueShield(ctx: AudioContext, dest: AudioNode, t0: number): void {
  // metallic shimmer — inharmonic partials through a resonant bandpass
  const ratios = [1, 1.6, 2.27, 3.1];
  ratios.forEach((r, i) => {
    const g = ctx.createGain();
    const bp = makeFilter(ctx, "bandpass", jitter(900 * r, 0.03), 9, dest);
    g.connect(bp);
    makeOsc(ctx, "sine", jitter(900 * r, 0.03), g, t0, t0 + 0.5);
    envelope(g, t0 + i * 0.005, 0.005, 0.22 / (i + 1), 0.45, 0.0001);
  });
}

function cueBoost(ctx: AudioContext, dest: AudioNode, t0: number): void {
  const g = ctx.createGain();
  const bp = makeFilter(ctx, "bandpass", 300, 0.9, dest);
  g.connect(bp);
  bp.frequency.setValueAtTime(250, t0);
  bp.frequency.exponentialRampToValueAtTime(2600, t0 + 0.7);
  makeNoise(ctx, 0.75, g, t0);
  envelope(g, t0, 0.15, 0.5, 0.5, 0.15, 0.1);

  const og = ctx.createGain();
  og.connect(dest);
  const o = makeOsc(ctx, "sawtooth", 180, og, t0, t0 + 0.75);
  o.frequency.exponentialRampToValueAtTime(520, t0 + 0.7);
  envelope(og, t0, 0.15, 0.28, 0.5, 0.1, 0.08);
}

function cueAlarm(ctx: AudioContext, dest: AudioNode, t0: number): void {
  for (let rep = 0; rep < 2; rep++) {
    const base = t0 + rep * 0.5;
    [820, 620].forEach((f, i) => {
      const g = ctx.createGain();
      g.connect(dest);
      const start = base + i * 0.2;
      makeOsc(ctx, "square", f, g, start, start + 0.18);
      envelope(g, start, 0.005, 0.35, 0.16, 0.0001);
    });
  }
}

function cueAnalyze(ctx: AudioContext, dest: AudioNode, t0: number): void {
  const notes = [660, 780, 900, 1080];
  notes.forEach((f, i) => {
    const g = ctx.createGain();
    g.connect(dest);
    const start = t0 + i * 0.06;
    makeOsc(ctx, "square", jitter(f, 0.02), g, start, start + 0.05);
    envelope(g, start, 0.001, 0.22, 0.045, 0.0001);
  });
}

function cueSpecial(ctx: AudioContext, dest: AudioNode, t0: number): void {
  // charging sweep
  const cg = ctx.createGain();
  const hp = makeFilter(ctx, "highpass", 200, 0.7, dest);
  cg.connect(hp);
  const charge = makeOsc(ctx, "sawtooth", 90, cg, t0, t0 + 0.9);
  charge.frequency.exponentialRampToValueAtTime(900, t0 + 0.85);
  envelope(cg, t0, 0.5, 0.4, 0.4, 0.3);

  // heavy release
  const rg = ctx.createGain();
  const lp = makeFilter(ctx, "lowpass", 4000, 0.8, dest);
  rg.connect(lp);
  lp.frequency.setValueAtTime(4000, t0 + 0.9);
  lp.frequency.exponentialRampToValueAtTime(150, t0 + 1.6);
  makeNoise(ctx, 0.8, rg, t0 + 0.88);
  envelope(rg, t0 + 0.88, 0.01, 0.9, 0.7, 0.0001);

  const sg = ctx.createGain();
  sg.connect(dest);
  makeOsc(ctx, "sine", 60, sg, t0 + 0.88, t0 + 1.5);
  envelope(sg, t0 + 0.88, 0.01, 0.8, 0.6, 0.0001);
}

function cueVictory(ctx: AudioContext, dest: AudioNode, t0: number): void {
  // restrained, resolved major-ish cadence — military, not cheerful
  const chord = [220, 277.18, 329.63, 440]; // A major-ish voicing
  chord.forEach((f, i) => {
    const g = ctx.createGain();
    g.connect(dest);
    makeOsc(ctx, "triangle", f, g, t0, t0 + 1.8);
    envelope(g, t0 + i * 0.03, 0.15, 0.22, 1.3, 0.12, 0.3);
  });
}

/* ------------------------------------------------------- weapon loadout */

function cueWeaponSwitch(ctx: AudioContext, dest: AudioNode, t0: number): void {
  // mechanical servo clack — two filtered noise ticks with a low latch thunk between them
  [
    { dt: 0, freq: 2600 },
    { dt: 0.075, freq: 1900 },
  ].forEach(({ dt, freq }) => {
    const g = ctx.createGain();
    const bp = makeFilter(ctx, "bandpass", jitter(freq, 0.06), 6, dest);
    g.connect(bp);
    makeNoise(ctx, 0.045, g, t0 + dt);
    envelope(g, t0 + dt, 0.001, 0.5, 0.04, 0.0001);
  });

  const tg = ctx.createGain();
  const lp = makeFilter(ctx, "lowpass", 320, 1.2, dest);
  tg.connect(lp);
  const thunk = makeOsc(ctx, "triangle", jitter(150), tg, t0 + 0.07, t0 + 0.22);
  thunk.frequency.exponentialRampToValueAtTime(jitter(70), t0 + 0.2);
  envelope(tg, t0 + 0.07, 0.002, 0.5, 0.13, 0.0001);

  // confirm tone — two quick ascending sine notes once the latch seats
  [
    { f: 1046.5, dt: 0.17 },
    { f: 1568, dt: 0.24 },
  ].forEach(({ f, dt }) => {
    const g = ctx.createGain();
    g.connect(dest);
    makeOsc(ctx, "sine", f, g, t0 + dt, t0 + dt + 0.09);
    envelope(g, t0 + dt, 0.004, 0.22, 0.085, 0.0001);
  });
}

function cueFireCannon(ctx: AudioContext, dest: AudioNode, t0: number): void {
  const shaper = ctx.createWaveShaper();
  const curve = createDistortionCurve(18);
  if (curve) shaper.curve = curve;
  shaper.connect(dest);

  // deep report — noise through a fast-closing lowpass, soft-clipped
  const g = ctx.createGain();
  const lp = makeFilter(ctx, "lowpass", 1200, 0.7, shaper);
  g.connect(lp);
  lp.frequency.setValueAtTime(1200, t0);
  lp.frequency.exponentialRampToValueAtTime(90, t0 + 0.5);
  makeNoise(ctx, 0.55, g, t0);
  envelope(g, t0, 0.002, 0.9, 0.45, 0.0001);

  // sub thump
  const sg = ctx.createGain();
  sg.connect(dest);
  const sub = makeOsc(ctx, "sine", jitter(58), sg, t0, t0 + 0.6);
  sub.frequency.exponentialRampToValueAtTime(26, t0 + 0.55);
  envelope(sg, t0, 0.003, 0.95, 0.55, 0.0001);

  // muzzle crack — sawtooth dropping fast through the clipper
  const bg = ctx.createGain();
  bg.connect(shaper);
  const body = makeOsc(ctx, "sawtooth", jitter(320), bg, t0, t0 + 0.2);
  body.frequency.exponentialRampToValueAtTime(jitter(45), t0 + 0.18);
  envelope(bg, t0, 0.001, 0.5, 0.17, 0.0001);

  // long tail — low rumble rolling off over ~1.4 s
  const tg = ctx.createGain();
  const tlp = makeFilter(ctx, "lowpass", 260, 0.8, dest);
  tg.connect(tlp);
  makeNoise(ctx, 1.5, tg, t0 + 0.12);
  envelope(tg, t0 + 0.12, 0.05, 0.35, 1.3, 0.0001);
}

function cueFireMissile(ctx: AudioContext, dest: AudioNode, t0: number): void {
  // six rounds, ~70 ms apart — each an ignition pop, a rising whoosh and a motor tone
  for (let i = 0; i < 6; i++) {
    const start = t0 + i * 0.07 + Math.random() * 0.008;

    const pg = ctx.createGain();
    pg.connect(dest);
    const pop = makeOsc(ctx, "square", jitter(700, 0.1), pg, start, start + 0.04);
    pop.frequency.exponentialRampToValueAtTime(jitter(140), start + 0.035);
    envelope(pg, start, 0.001, 0.3, 0.035, 0.0001);

    const wg = ctx.createGain();
    const bp = makeFilter(ctx, "bandpass", 500, 1.1, dest);
    wg.connect(bp);
    bp.frequency.setValueAtTime(jitter(450, 0.1), start);
    bp.frequency.exponentialRampToValueAtTime(jitter(2600, 0.08), start + 0.12);
    bp.frequency.exponentialRampToValueAtTime(jitter(900), start + 0.4);
    makeNoise(ctx, 0.45, wg, start);
    envelope(wg, start, 0.02, 0.4, 0.38, 0.0001);

    const mg = ctx.createGain();
    mg.connect(dest);
    const motor = makeOsc(ctx, "sawtooth", jitter(180, 0.08), mg, start, start + 0.3);
    motor.frequency.exponentialRampToValueAtTime(jitter(420), start + 0.28);
    envelope(mg, start, 0.01, 0.12, 0.27, 0.0001);
  }
}

function cueFireBlade(ctx: AudioContext, dest: AudioNode, t0: number): void {
  const shaper = ctx.createWaveShaper();
  const curve = createDistortionCurve(12);
  if (curve) shaper.curve = curve;
  shaper.connect(dest);

  // plasma ignition hum — two detuned saws through an opening lowpass, rising
  const hg = ctx.createGain();
  const lp = makeFilter(ctx, "lowpass", 250, 2, shaper);
  hg.connect(lp);
  lp.frequency.setValueAtTime(250, t0);
  lp.frequency.exponentialRampToValueAtTime(3200, t0 + 0.32);
  const a = makeOsc(ctx, "sawtooth", jitter(110), hg, t0, t0 + 0.5);
  const b = makeOsc(ctx, "sawtooth", jitter(113), hg, t0, t0 + 0.5);
  a.frequency.exponentialRampToValueAtTime(jitter(220), t0 + 0.32);
  b.frequency.exponentialRampToValueAtTime(jitter(226), t0 + 0.32);
  envelope(hg, t0, 0.18, 0.35, 0.3, 0.0001);

  // slash sweep — bandpass noise arcing up and away
  const sStart = t0 + 0.28;
  const sg = ctx.createGain();
  const bp = makeFilter(ctx, "bandpass", 700, 2.5, dest);
  sg.connect(bp);
  bp.frequency.setValueAtTime(700, sStart);
  bp.frequency.exponentialRampToValueAtTime(4200, sStart + 0.12);
  bp.frequency.exponentialRampToValueAtTime(500, sStart + 0.3);
  makeNoise(ctx, 0.35, sg, sStart);
  envelope(sg, sStart, 0.01, 0.6, 0.3, 0.0001);

  // plasma whine riding the slash
  const wg = ctx.createGain();
  wg.connect(dest);
  const whine = makeOsc(ctx, "sine", jitter(1900), wg, sStart, sStart + 0.3);
  whine.frequency.exponentialRampToValueAtTime(jitter(380), sStart + 0.28);
  envelope(wg, sStart, 0.005, 0.25, 0.27, 0.0001);

  // contact ring
  const rg = ctx.createGain();
  const rbp = makeFilter(ctx, "bandpass", jitter(1300), 10, dest);
  rg.connect(rbp);
  makeOsc(ctx, "square", jitter(1300), rg, sStart + 0.1, sStart + 0.5);
  envelope(rg, sStart + 0.1, 0.005, 0.2, 0.38, 0.0001);
}

const BUILDERS: Record<AudioCue, CueBuilder> = {
  WEAPON_SWITCH: cueWeaponSwitch,
  FIRE_CANNON: cueFireCannon,
  FIRE_MISSILE: cueFireMissile,
  FIRE_BLADE: cueFireBlade,
  WAKE: cueWake,
  BOOT_TICK: cueBootTick,
  BOOT_DONE: cueBootDone,
  PANEL_ON: cuePanelOn,
  BEEP: cueBeep,
  DENY: cueDeny,
  LOCK: cueLock,
  FIRE: cueFire,
  IMPACT: cueImpact,
  PLAYER_HIT: cuePlayerHit,
  EXPLOSION: cueExplosion,
  SHIELD: cueShield,
  BOOST: cueBoost,
  ALARM: cueAlarm,
  SPECIAL: cueSpecial,
  ANALYZE: cueAnalyze,
  VICTORY: cueVictory,
};

/**
 * Minimum spacing per cue. A missile salvo lands six rounds on every unit in
 * the cone in the same tick, and the store emits one IMPACT per hit — a dozen
 * identical impacts stacked at t=0 would just be one impact twelve times too
 * loud, so collapse anything inside the window into the first.
 */
const MIN_GAP_MS: Partial<Record<AudioCue, number>> = { IMPACT: 60, EXPLOSION: 40 };
const lastPlayedAt: Partial<Record<AudioCue, number>> = {};

/** Play a synthesized cue immediately. Never throws. */
export function playCue(cue: AudioCue): void {
  safeAudio(() => {
    const gap = MIN_GAP_MS[cue];
    if (gap) {
      const t = Date.now();
      if (t - (lastPlayedAt[cue] ?? 0) < gap) return;
      lastPlayedAt[cue] = t;
    }
    const ctx = getCtx();
    const sfxBus = getSfxBus();
    if (!ctx || !sfxBus) return;
    const builder = BUILDERS[cue];
    if (!builder) return;
    builder(ctx, sfxBus, now());
  });
}
