/**
 * Shared math for the WebGL viewport: seeded RNG, value noise, the lunar
 * terrain height field (used both to displace the ground mesh and to plant
 * enemies on it) and the polar → world mapping for enemies.
 *
 * Units are metres. The camera (pilot's eye) sits at EYE_Y above the ground.
 */

export const DEG = Math.PI / 180;
/** Bearing half-angle that lands on the aperture rim (see docs/REDESIGN.md). */
export const APERTURE_HALF_DEG = 35;
export const TAN_APERTURE = Math.tan(APERTURE_HALF_DEG * DEG);
/** Pilot's eye height above the regolith. */
export const EYE_Y = 11;

export function clamp(v: number, lo: number, hi: number): number {
  return v < lo ? lo : v > hi ? hi : v;
}
export function lerp(a: number, b: number, t: number): number {
  return a + (b - a) * t;
}
export function smoothstep(e0: number, e1: number, x: number): number {
  const t = clamp((x - e0) / (e1 - e0), 0, 1);
  return t * t * (3 - 2 * t);
}
/** Frame-rate independent exponential approach. */
export function damp(current: number, target: number, lambda: number, dt: number): number {
  return lerp(current, target, 1 - Math.exp(-lambda * dt));
}
export function easeOutCubic(t: number): number {
  const u = 1 - clamp(t, 0, 1);
  return 1 - u * u * u;
}
export function easeInCubic(t: number): number {
  const u = clamp(t, 0, 1);
  return u * u * u;
}

/** Deterministic PRNG (mulberry32) so the world is identical every run. */
export function seeded(seed: number): () => number {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

function hash2(x: number, y: number): number {
  const s = Math.sin(x * 127.1 + y * 311.7) * 43758.5453;
  return s - Math.floor(s);
}

/** Smooth 2D value noise in [0,1]. */
export function valueNoise(x: number, y: number): number {
  const xi = Math.floor(x);
  const yi = Math.floor(y);
  const xf = x - xi;
  const yf = y - yi;
  const u = xf * xf * (3 - 2 * xf);
  const v = yf * yf * (3 - 2 * yf);
  const a = hash2(xi, yi);
  const b = hash2(xi + 1, yi);
  const c = hash2(xi, yi + 1);
  const d = hash2(xi + 1, yi + 1);
  return lerp(lerp(a, b, u), lerp(c, d, u), v);
}

export function fbm(x: number, y: number, octaves = 3): number {
  let amp = 0.5;
  let freq = 1;
  let sum = 0;
  for (let i = 0; i < octaves; i++) {
    sum += amp * valueNoise(x * freq, y * freq);
    freq *= 2.03;
    amp *= 0.5;
  }
  return sum;
}

/* --------------------------------------------------------------- terrain */

export interface Crater {
  x: number;
  z: number;
  r: number;
  depth: number;
}

export const TERRAIN_SIZE = 2600;

/** Fixed-seed crater field. Nothing within ~110 m of the pilot so the foreground stays walkable. */
export const CRATERS: Crater[] = (() => {
  const rnd = seeded(20260920);
  const out: Crater[] = [];
  while (out.length < 64) {
    const x = (rnd() - 0.5) * TERRAIN_SIZE * 0.9;
    const z = (rnd() - 0.5) * TERRAIN_SIZE * 0.9;
    const r = 14 + Math.pow(rnd(), 2.2) * 150;
    if (Math.hypot(x, z) < 110 + r) continue;
    out.push({ x, z, r, depth: r * (0.09 + rnd() * 0.08) });
  }
  return out;
})();

/** Height of the regolith at (x, z). Analytic so enemies can stand on it exactly. */
export function terrainHeight(x: number, z: number): number {
  let h = (fbm(x / 420 + 7.3, z / 420 + 2.1, 3) - 0.5) * 14;
  h += (fbm(x / 60 + 3.1, z / 60 + 9.7, 2) - 0.5) * 1.6;
  for (let i = 0; i < CRATERS.length; i++) {
    const c = CRATERS[i];
    const dx = x - c.x;
    const dz = z - c.z;
    const d2 = dx * dx + dz * dz;
    const lim = c.r * 1.35;
    if (d2 > lim * lim) continue;
    const r = Math.sqrt(d2) / c.r;
    if (r < 1) {
      const bowl = 1 - r * r;
      h -= c.depth * bowl * bowl;
    }
    const rim = Math.exp(-((r - 1) * (r - 1)) / 0.02);
    h += c.depth * 0.32 * rim;
  }
  // Flatten the pilot's stand so the near foreground never pokes into the canopy.
  const near = Math.hypot(x, z);
  if (near < 90) h *= smoothstep(30, 90, near);
  return h;
}

/* ------------------------------------------------------- enemy placement */

/**
 * Store distances are 0..1400 "metres" of gameplay range. Rendering them
 * literally makes a 20 m mech a 30 px smudge, so the view compresses range:
 * a unit at 200 m stands ~63 m out, a unit at 1400 m ~260 m.
 */
export function renderDistance(distance: number): number {
  return 30 + clamp(distance, 0, 1500) * 0.165;
}

/** Polar (bearing deg, gameplay distance) → world x/z on the ground plane. */
export function polarToWorld(absBearingDeg: number, distance: number, out: { x: number; z: number }): void {
  const d = renderDistance(distance);
  const b = absBearingDeg * DEG;
  out.x = d * Math.sin(b);
  out.z = -d * Math.cos(b);
}
