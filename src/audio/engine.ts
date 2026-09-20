/**
 * AUDIO — lazy Web Audio engine.
 *
 * Owns the single AudioContext for the whole demo. Nothing here may throw:
 * unsupported browsers, blocked autoplay, SSR — everything degrades to
 * silence. The context itself is only constructed on `unlockAudio()`, which
 * the integrator calls from the first user gesture (keypress/click), since
 * browsers refuse to start an AudioContext before that.
 *
 * Graph:
 *   sfxBus   \
 *             -> compressor -> masterGain -> destination
 *   musicBus /
 *
 * `sfxBus` and `musicBus` are exposed to sfx.ts / bgm.ts so cues and music
 * land on the right side of the mix (music ducks under speech, sfx doesn't).
 */

const MUTE_KEY = "aether-frame:audio-muted";
const MASTER_VOLUME = 0.75; // conservative — this plays through a venue PA

let ctx: AudioContext | null = null;
let masterGain: GainNode | null = null;
let compressor: DynamicsCompressorNode | null = null;
let sfxBus: GainNode | null = null;
let musicBus: GainNode | null = null;
let unlocked = false;
let muted = false;

function isBrowser(): boolean {
  return typeof window !== "undefined";
}

function readStoredMute(): boolean {
  try {
    if (!isBrowser()) return false;
    return window.localStorage.getItem(MUTE_KEY) === "1";
  } catch {
    return false;
  }
}

muted = readStoredMute();

function getCtor(): typeof AudioContext | null {
  if (!isBrowser()) return null;
  try {
    const w = window as unknown as {
      AudioContext?: typeof AudioContext;
      webkitAudioContext?: typeof AudioContext;
    };
    return w.AudioContext ?? w.webkitAudioContext ?? null;
  } catch {
    return null;
  }
}

function ensureGraph(): void {
  if (!ctx || masterGain) return;
  try {
    masterGain = ctx.createGain();
    masterGain.gain.value = muted ? 0 : MASTER_VOLUME;

    compressor = ctx.createDynamicsCompressor();
    compressor.threshold.value = -18;
    compressor.knee.value = 18;
    compressor.ratio.value = 6;
    compressor.attack.value = 0.003;
    compressor.release.value = 0.25;

    sfxBus = ctx.createGain();
    sfxBus.gain.value = 0.9;

    musicBus = ctx.createGain();
    musicBus.gain.value = 0.55;

    sfxBus.connect(compressor);
    musicBus.connect(compressor);
    compressor.connect(masterGain);
    masterGain.connect(ctx.destination);
  } catch (err) {
    console.error("[audio] failed to build audio graph", err);
    ctx = null;
    masterGain = null;
    compressor = null;
    sfxBus = null;
    musicBus = null;
  }
}

/** Call from the first user gesture. Safe to call repeatedly. */
export function unlockAudio(): void {
  if (!isBrowser()) return;
  try {
    const Ctor = getCtor();
    if (!Ctor) return; // Web Audio unavailable — no-op forever
    if (!ctx) {
      ctx = new Ctor();
    }
    ensureGraph();
    if (ctx.state === "suspended") {
      void ctx.resume().catch(() => {});
    }
    unlocked = true;
  } catch (err) {
    console.error("[audio] unlockAudio failed", err);
  }
}

export function setMuted(m: boolean): void {
  muted = m;
  try {
    if (masterGain && ctx) {
      masterGain.gain.cancelScheduledValues(ctx.currentTime);
      masterGain.gain.setTargetAtTime(m ? 0 : MASTER_VOLUME, ctx.currentTime, 0.05);
    }
  } catch {
    // no-op
  }
  try {
    if (isBrowser()) window.localStorage.setItem(MUTE_KEY, m ? "1" : "0");
  } catch {
    // private mode / disabled storage — ignore
  }
}

export function isMuted(): boolean {
  return muted;
}

/* ------------------------------------------------ internals for sfx/bgm */

/** True once the context + graph exist and are usable. */
export function isReady(): boolean {
  return !!(ctx && sfxBus && musicBus);
}

export function isUnlocked(): boolean {
  return unlocked;
}

export function getCtx(): AudioContext | null {
  return ctx;
}

export function getSfxBus(): GainNode | null {
  return sfxBus;
}

export function getMusicBus(): GainNode | null {
  return musicBus;
}

/** Current AudioContext clock, or 0 if unavailable. */
export function now(): number {
  return ctx ? ctx.currentTime : 0;
}

/** Run fn and swallow any error — nothing audio-related may ever throw. */
export function safeAudio(fn: () => void): void {
  try {
    fn();
  } catch (err) {
    console.error("[audio] error", err);
  }
}

/** White-noise buffer, `duration` seconds long. Null if context unavailable. */
export function createNoiseBuffer(duration = 1): AudioBuffer | null {
  if (!ctx) return null;
  try {
    const length = Math.max(1, Math.floor(ctx.sampleRate * duration));
    const buffer = ctx.createBuffer(1, length, ctx.sampleRate);
    const data = buffer.getChannelData(0);
    for (let i = 0; i < length; i++) data[i] = Math.random() * 2 - 1;
    return buffer;
  } catch {
    return null;
  }
}

/** Soft-clip distortion curve for a WaveShaperNode. */
export function createDistortionCurve(amount = 30): Float32Array<ArrayBuffer> | null {
  if (!ctx) return null;
  try {
    const samples = 1024;
    const curve = new Float32Array(new ArrayBuffer(samples * Float32Array.BYTES_PER_ELEMENT));
    for (let i = 0; i < samples; i++) {
      const x = (i / (samples - 1)) * 2 - 1;
      curve[i] = ((3 + amount) * x * 20 * (Math.PI / 180)) / (Math.PI + amount * Math.abs(x));
    }
    return curve;
  } catch {
    return null;
  }
}
