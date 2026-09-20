/**
 * Layer 1 — the world: the surface of the Moon. True-black vacuum sky with a
 * fixed starfield and a distant Earth, a pale regolith plain etched with a
 * faint survey grid, hard-shadowed craters, and a lunar base silhouetted
 * along the horizon. No atmosphere anywhere — every edge here is hard.
 *
 * Palette stays cold greys/black/white; green is reserved for the HUD glass
 * (canopy.ts) and red for CRIMSON-01, so nothing in this file should reach
 * for either as a base terrain color.
 */
import { horizonY, worldDrift } from "./project";

/* --------------------------------------------------------------- lighting */
// Single consistent key-light direction (unit-ish vector pointing TOWARD the
// light source, upper-left) shared by the Earth crescent, crater rims and
// base-structure highlights — the one detail that sells "deliberate".
const LIGHT_RAW = { x: -0.5, y: -0.86 };
const LIGHT_LEN = Math.hypot(LIGHT_RAW.x, LIGHT_RAW.y);
const LIGHT = { x: LIGHT_RAW.x / LIGHT_LEN, y: LIGHT_RAW.y / LIGHT_LEN };
const LIGHT_ANGLE = Math.atan2(LIGHT.y, LIGHT.x);

function hash(n: number): number {
  const s = Math.sin(n) * 43758.5453;
  return s - Math.floor(s);
}

/* ----------------------------------------------------------------- types */
type StructureKind = "dome" | "dish" | "mast" | "tank" | "pad";

interface StructureDef {
  x: number;
  w: number;
  h: number;
  kind: StructureKind;
  seed: number;
}

interface CraterDef {
  xFrac: number; // lateral spread fraction at closest approach (matches grid radial spread)
  depthT: number; // 0 = far (near horizon), 1 = near (bottom of frame)
  rx: number;
  ry: number;
}

interface Mottle {
  xFrac: number;
  depthT: number;
  r: number;
  alpha: number;
}

interface DustMote {
  xFrac: number;
  yFrac: number;
  vx: number; // fraction of screen width per second
  vy: number; // fraction of screen height per second
  life: number;
  maxLife: number;
  active: boolean;
}

export interface WorldState {
  /** Ground grid scroll offset, meters-ish, wraps. */
  gridScroll: number;
  /** Elapsed seconds, frame-rate independent — drives beacon blink / pad chase lights. */
  clock: number;
  structures: StructureDef[];
  craters: CraterDef[];
  mottles: Mottle[];
  dust: DustMote[];
  dustSpawnAccum: number;
}

const DUST_POOL_SIZE = 48;
const DUST_GRAVITY = 0.85; // vacuum: low but present "gravity" in screen-fraction units

export function createWorldState(width: number): WorldState {
  const structures: StructureDef[] = [];

  // Dense base cluster, deliberately off-center (left side) so the view reads asymmetric.
  let x = width * 0.03;
  const clusterEnd = width * 0.58;
  let seedI = 0;
  const kinds: StructureKind[] = ["dome", "dome", "dish", "mast", "tank", "pad", "dome", "mast", "dish"];
  while (x < clusterEnd) {
    const kind = kinds[seedI % kinds.length];
    const r = hash(seedI * 5.13);
    let w: number;
    let h: number;
    if (kind === "dome") {
      w = 30 + r * 34;
      h = w * (0.42 + hash(seedI * 2.2) * 0.15);
    } else if (kind === "dish") {
      w = 5 + r * 4;
      h = 20 + r * 22;
    } else if (kind === "tank") {
      w = 10 + r * 8;
      h = 16 + r * 14;
    } else if (kind === "pad") {
      w = 60 + r * 40;
      h = 6 + r * 3;
    } else {
      w = 2 + r * 2;
      h = 24 + r * 34;
    }
    structures.push({ x, w, h, kind, seed: seedI * 3.71 + 1 });
    x += Math.max(18, w) * (0.75 + hash(seedI * 7.9) * 0.7);
    seedI++;
  }

  // Sparse outliers (masts / pylons) across the rest of the horizon.
  x = clusterEnd + 30 + hash(seedI) * 60;
  while (x < width * 1.3) {
    const r = hash(seedI * 4.4);
    if (r > 0.35) {
      const w = 2 + r * 3;
      const h = 14 + r * 24;
      const kind: StructureKind = r > 0.75 ? "dish" : "mast";
      structures.push({ x, w, h, kind, seed: seedI * 3.71 + 1 });
    }
    x += 70 + hash(seedI * 1.7) * 150;
    seedI++;
  }

  // Craters: fixed set, varying distance, spread across the full width.
  const craters: CraterDef[] = [];
  for (let i = 0; i < 9; i++) {
    const depthT = 0.12 + hash(i * 11.3) * 0.85;
    const xFrac = (hash(i * 6.7) - 0.5) * 2.6;
    const rx = 22 + hash(i * 9.1) * 46;
    const ry = rx * (0.4 + hash(i * 2.9) * 0.15);
    craters.push({ xFrac, depthT, rx, ry });
  }

  // Mottles: fixed dust-texture blobs, drawn once per frame but never regenerated.
  const mottles: Mottle[] = [];
  for (let i = 0; i < 46; i++) {
    mottles.push({
      xFrac: (hash(i * 3.31) - 0.5) * 2.4,
      depthT: hash(i * 8.17),
      r: 14 + hash(i * 5.55) * 60,
      alpha: 0.02 + hash(i * 1.9) * 0.035,
    });
  }

  const dust: DustMote[] = [];
  for (let i = 0; i < DUST_POOL_SIZE; i++) {
    dust.push({ xFrac: 0.5, yFrac: 0.97, vx: 0, vy: 0, life: 0, maxLife: 1, active: false });
  }

  return { gridScroll: 0, clock: 0, structures, craters, mottles, dust, dustSpawnAccum: 0 };
}

/** boostPulse: 0..1+, decays in the caller; higher = grid rushes past faster. */
export function updateWorld(state: WorldState, dt: number, boostPulse: number): void {
  const speed = 22 + boostPulse * 300; // meters/sec equivalent
  state.gridScroll = (state.gridScroll + speed * dt) % 80;
  state.clock += dt;

  // Vacuum dust kicked up by boosting: ballistic, no turbulence, no lingering.
  if (boostPulse > 0.12) {
    state.dustSpawnAccum += dt * boostPulse * 26;
  }
  while (state.dustSpawnAccum >= 1) {
    state.dustSpawnAccum -= 1;
    const mote = state.dust.find((m) => !m.active);
    if (!mote) break;
    mote.active = true;
    mote.life = 0;
    mote.maxLife = 0.55 + Math.random() * 0.75;
    mote.xFrac = 0.5 + (Math.random() - 0.5) * 0.4;
    mote.yFrac = 0.97 + Math.random() * 0.02;
    mote.vx = (Math.random() - 0.5) * 0.55;
    mote.vy = -(0.6 + Math.random() * 1.1);
  }
  for (const mote of state.dust) {
    if (!mote.active) continue;
    mote.vy += DUST_GRAVITY * dt;
    mote.xFrac += mote.vx * dt;
    mote.yFrac += mote.vy * dt;
    mote.life += dt;
    if (mote.life >= mote.maxLife || mote.yFrac > 1.02) mote.active = false;
  }
}

/* ------------------------------------------------------------------- sky */
export function drawSky(
  ctx: CanvasRenderingContext2D,
  width: number,
  height: number,
  time: number,
  playerBearing: number,
): void {
  const hy = horizonY(height);

  // True vacuum black — a whisper of depth near the horizon, nothing more.
  const grad = ctx.createLinearGradient(0, 0, 0, hy);
  grad.addColorStop(0, "#000000");
  grad.addColorStop(1, "#050608");
  ctx.fillStyle = grad;
  ctx.fillRect(0, 0, width, hy);

  const drift = worldDrift(playerBearing, width) * 0.15;

  // Dense, still starfield — deterministic index hash, never Math.random(), so it can't shimmer.
  ctx.save();
  for (let i = 0; i < 260; i++) {
    const sx = (Math.sin(i * 12.9898) * 43758.5453) % 1;
    const sy = (Math.sin(i * 78.233) * 12543.111) % 1;
    let px = ((sx < 0 ? sx + 1 : sx) * width + drift) % width;
    if (px < 0) px += width;
    const py = (sy < 0 ? sy + 1 : sy) * hy * 0.92;
    const bright = hash(i * 5.5 + 2);
    const isBright = bright > 0.93;
    const size = isBright ? 1.6 : 1;
    ctx.globalAlpha = isBright ? 0.85 + bright * 0.15 : 0.25 + bright * 0.45;
    ctx.fillStyle = isBright ? "#eaf2ff" : "#cdd7de";
    ctx.fillRect(px, py, size, size);
    if (isBright) {
      ctx.globalAlpha *= 0.4;
      ctx.fillRect(px - 1.5, py, 4, 0.6);
      ctx.fillRect(px, py - 1.5, 0.6, 4);
    }
  }
  ctx.restore();

  drawEarth(ctx, width, hy, drift * 0.3);
}

function drawEarth(ctx: CanvasRenderingContext2D, width: number, hy: number, drift: number): void {
  const ex = width * 0.74 + drift;
  const ey = hy * 0.4;
  const r = Math.max(16, Math.min(width, hy) * 0.052);

  // Faint atmospheric halo behind the disc.
  ctx.save();
  const halo = ctx.createRadialGradient(ex, ey, r * 0.7, ex, ey, r * 2.1);
  halo.addColorStop(0, "rgba(120,170,255,0.10)");
  halo.addColorStop(1, "rgba(120,170,255,0)");
  ctx.fillStyle = halo;
  ctx.beginPath();
  ctx.arc(ex, ey, r * 2.1, 0, Math.PI * 2);
  ctx.fill();
  ctx.restore();

  ctx.save();
  ctx.beginPath();
  ctx.arc(ex, ey, r, 0, Math.PI * 2);
  ctx.clip();

  // Lit marble base.
  const marble = ctx.createRadialGradient(
    ex - LIGHT.x * r * 0.3,
    ey - LIGHT.y * r * 0.3,
    r * 0.1,
    ex,
    ey,
    r * 1.05,
  );
  marble.addColorStop(0, "#bfe0ff");
  marble.addColorStop(0.55, "#5f9fd9");
  marble.addColorStop(1, "#1c3a55");
  ctx.fillStyle = marble;
  ctx.fillRect(ex - r, ey - r, r * 2, r * 2);

  // Faint cloud banding.
  ctx.globalAlpha = 0.22;
  ctx.strokeStyle = "#eaf6ff";
  ctx.lineWidth = r * 0.09;
  for (let i = 0; i < 3; i++) {
    ctx.beginPath();
    ctx.ellipse(ex - r * 0.1, ey + (i - 1) * r * 0.35, r * 0.8, r * 0.16, 0.3, 0, Math.PI * 2);
    ctx.stroke();
  }
  ctx.globalAlpha = 1;

  // Night hemisphere: dark disc shifted away from the light, carving a crescent.
  ctx.fillStyle = "#04070b";
  ctx.beginPath();
  ctx.arc(ex - LIGHT.x * r * 0.95, ey - LIGHT.y * r * 0.95, r * 1.02, 0, Math.PI * 2);
  ctx.fill();

  // Soften the terminator line slightly.
  const term = ctx.createRadialGradient(
    ex - LIGHT.x * r * 0.95,
    ey - LIGHT.y * r * 0.95,
    r * 0.75,
    ex - LIGHT.x * r * 0.95,
    ey - LIGHT.y * r * 0.95,
    r * 1.15,
  );
  term.addColorStop(0, "rgba(4,7,11,0)");
  term.addColorStop(1, "rgba(4,7,11,0.5)");
  ctx.fillStyle = term;
  ctx.beginPath();
  ctx.arc(ex - LIGHT.x * r * 0.95, ey - LIGHT.y * r * 0.95, r * 1.15, 0, Math.PI * 2);
  ctx.fill();
  ctx.restore();

  // Thin atmospheric rim light on the sunward edge only.
  ctx.save();
  ctx.strokeStyle = "rgba(160,205,255,0.55)";
  ctx.lineWidth = 1.4;
  ctx.beginPath();
  ctx.arc(ex, ey, r + 1, LIGHT_ANGLE - 1.1, LIGHT_ANGLE + 1.1);
  ctx.stroke();
  ctx.restore();
}

/* ------------------------------------------------------------- base -- horizon silhouette */
export function drawBase(
  ctx: CanvasRenderingContext2D,
  width: number,
  height: number,
  state: WorldState,
  playerBearing: number,
): void {
  const hy = horizonY(height);
  const drift = worldDrift(playerBearing, width) * 0.4;
  ctx.save();
  for (const s of state.structures) {
    const sx = s.x + drift;
    if (sx < -60 || sx > width + 60) continue;
    switch (s.kind) {
      case "dome":
        drawDome(ctx, sx, hy, s.w, s.h, s.seed, state.clock);
        break;
      case "dish":
        drawDish(ctx, sx, hy, s.w, s.h, s.seed);
        break;
      case "mast":
        drawMast(ctx, sx, hy, s.w, s.h, s.seed, state.clock);
        break;
      case "tank":
        drawTank(ctx, sx, hy, s.w, s.h, s.seed);
        break;
      case "pad":
        drawPad(ctx, sx, hy, s.w, s.h, state.clock);
        break;
    }
  }
  ctx.restore();
}

function drawDome(
  ctx: CanvasRenderingContext2D,
  x: number,
  baseY: number,
  w: number,
  h: number,
  seed: number,
  clock: number,
): void {
  ctx.save();
  // Solid black — this needs to read as a cutout against the starfield, not blend into it.
  ctx.fillStyle = "#000000";
  ctx.beginPath();
  ctx.ellipse(x, baseY, w / 2, h, 0, Math.PI, Math.PI * 2);
  ctx.closePath();
  ctx.fill();

  // Full-perimeter outline so the shape reads regardless of light direction.
  ctx.strokeStyle = "rgba(120,132,148,0.4)";
  ctx.lineWidth = 1;
  ctx.beginPath();
  ctx.ellipse(x, baseY, w / 2, h, 0, Math.PI, Math.PI * 2);
  ctx.stroke();

  // Sunward rim highlight — same light direction as the craters/Earth.
  ctx.strokeStyle = "rgba(205,215,230,0.75)";
  ctx.lineWidth = 1.2;
  ctx.beginPath();
  ctx.ellipse(x, baseY, w / 2, h, 0, LIGHT_ANGLE - 0.5, LIGHT_ANGLE + 0.5);
  ctx.stroke();

  // Lit interior windows.
  const n = 3 + Math.floor(hash(seed) * 3);
  for (let i = 0; i < n; i++) {
    const wx = x + (hash(seed + i * 3.1) - 0.5) * w * 0.65;
    const wy = baseY - h * (0.28 + hash(seed + i * 7.7) * 0.55);
    const flick = 0.65 + 0.35 * Math.sin(clock * 1.3 + seed + i * 1.7);
    ctx.fillStyle = `rgba(255,182,120,${(0.85 * flick).toFixed(3)})`;
    ctx.fillRect(wx, wy, 2.4, 2.4);
  }
  ctx.restore();
}

function drawDish(ctx: CanvasRenderingContext2D, x: number, baseY: number, w: number, h: number, seed: number): void {
  ctx.save();
  ctx.strokeStyle = "#000000";
  ctx.lineWidth = Math.max(1.5, w * 0.5);
  ctx.beginPath();
  ctx.moveTo(x, baseY);
  ctx.lineTo(x, baseY - h);
  ctx.stroke();
  ctx.strokeStyle = "rgba(120,132,148,0.35)";
  ctx.lineWidth = 0.8;
  ctx.beginPath();
  ctx.moveTo(x, baseY);
  ctx.lineTo(x, baseY - h);
  ctx.stroke();

  const tilt = -0.5 + hash(seed) * 0.3;
  ctx.fillStyle = "#000000";
  ctx.beginPath();
  ctx.ellipse(x, baseY - h, w * 1.8, w * 0.7, tilt, 0, Math.PI * 2);
  ctx.fill();

  ctx.strokeStyle = "rgba(120,132,148,0.4)";
  ctx.lineWidth = 0.8;
  ctx.beginPath();
  ctx.ellipse(x, baseY - h, w * 1.8, w * 0.7, tilt, 0, Math.PI * 2);
  ctx.stroke();

  ctx.strokeStyle = "rgba(205,215,230,0.75)";
  ctx.lineWidth = 1;
  ctx.beginPath();
  ctx.ellipse(x, baseY - h, w * 1.8, w * 0.7, tilt, LIGHT_ANGLE - 0.4, LIGHT_ANGLE + 0.5);
  ctx.stroke();
  ctx.restore();
}

function drawMast(
  ctx: CanvasRenderingContext2D,
  x: number,
  baseY: number,
  w: number,
  h: number,
  seed: number,
  clock: number,
): void {
  ctx.save();
  ctx.strokeStyle = "#000000";
  ctx.lineWidth = Math.max(1.5, w * 0.6);
  ctx.beginPath();
  ctx.moveTo(x, baseY);
  ctx.lineTo(x, baseY - h);
  ctx.stroke();
  ctx.strokeStyle = "rgba(120,132,148,0.4)";
  ctx.lineWidth = 0.8;
  ctx.beginPath();
  ctx.moveTo(x, baseY);
  ctx.lineTo(x, baseY - h);
  ctx.stroke();

  const blink = Math.sin(clock * 1.6 + seed);
  if (blink > 0.55) {
    const a = (blink - 0.55) / 0.45;
    ctx.fillStyle = `rgba(255,80,68,${(0.5 + 0.5 * a).toFixed(3)})`;
    ctx.beginPath();
    ctx.arc(x, baseY - h, 1.8, 0, Math.PI * 2);
    ctx.fill();
  }
  ctx.restore();
}

function drawTank(ctx: CanvasRenderingContext2D, x: number, baseY: number, w: number, h: number, seed: number): void {
  ctx.save();
  ctx.fillStyle = "#000000";
  ctx.beginPath();
  ctx.rect(x - w / 2, baseY - h, w, h);
  ctx.fill();
  ctx.beginPath();
  ctx.ellipse(x, baseY - h, w / 2, w * 0.22, 0, 0, Math.PI * 2);
  ctx.fill();

  ctx.strokeStyle = "rgba(120,132,148,0.4)";
  ctx.lineWidth = 1;
  ctx.strokeRect(x - w / 2, baseY - h, w, h);

  ctx.strokeStyle = "rgba(205,215,230,0.7)";
  ctx.lineWidth = 1;
  ctx.beginPath();
  ctx.moveTo(x - w / 2, baseY - h);
  ctx.lineTo(x - w / 2, baseY);
  ctx.stroke();

  ctx.strokeStyle = "rgba(150,165,185,0.3)";
  ctx.lineWidth = 1;
  ctx.beginPath();
  ctx.moveTo(x - w / 2, baseY - h * (0.3 + hash(seed) * 0.3));
  ctx.lineTo(x + w / 2, baseY - h * (0.3 + hash(seed) * 0.3));
  ctx.stroke();
  ctx.restore();
}

function drawPad(ctx: CanvasRenderingContext2D, x: number, baseY: number, w: number, h: number, clock: number): void {
  ctx.save();
  ctx.strokeStyle = "rgba(140,150,162,0.28)";
  ctx.lineWidth = 1;
  ctx.beginPath();
  ctx.ellipse(x, baseY - 1, w / 2, Math.max(2, h), 0, 0, Math.PI * 2);
  ctx.stroke();

  const lights = 10;
  for (let i = 0; i < lights; i++) {
    const a = (i / lights) * Math.PI * 2;
    const lx = x + Math.cos(a) * (w / 2);
    const ly = baseY - 1 + Math.sin(a) * Math.max(2, h);
    const phase = ((clock * 0.6 - i / lights) % 1 + 1) % 1;
    if (phase < 0.5) {
      ctx.fillStyle = `rgba(255,208,140,${(0.75 * (1 - phase / 0.5)).toFixed(3)})`;
      ctx.beginPath();
      ctx.arc(lx, ly, 1.1, 0, Math.PI * 2);
      ctx.fill();
    }
  }
  ctx.restore();
}

/* ------------------------------------------------------------------- horizon */
export function drawHorizon(
  ctx: CanvasRenderingContext2D,
  width: number,
  height: number,
  playerBearing: number,
): void {
  const hy = horizonY(height);
  const drift = worldDrift(playerBearing, width);
  ctx.save();
  ctx.strokeStyle = "rgba(205,212,222,0.55)";
  ctx.lineWidth = 1;
  ctx.beginPath();
  ctx.moveTo(0, hy + drift * 0.05);
  ctx.lineTo(width, hy - drift * 0.05);
  ctx.stroke();
  ctx.restore();
}

/* ------------------------------------------------------------------- regolith + grid */
export function drawGrid(
  ctx: CanvasRenderingContext2D,
  width: number,
  height: number,
  state: WorldState,
  playerBearing: number,
): void {
  const hy = horizonY(height);
  const groundH = height - hy;
  if (groundH <= 0) return;
  const drift = worldDrift(playerBearing, width);
  const vanishX = width / 2 + drift;

  ctx.save();
  ctx.beginPath();
  ctx.rect(0, hy, width, groundH);
  ctx.clip();

  // Pale, cool regolith plane — dust, not video-game turf.
  const groundGrad = ctx.createLinearGradient(0, hy, 0, height);
  groundGrad.addColorStop(0, "rgba(96,98,104,0.28)");
  groundGrad.addColorStop(1, "rgba(8,8,10,0.92)");
  ctx.fillStyle = groundGrad;
  ctx.fillRect(0, hy, width, groundH);

  // Mottling — fixed soft blobs of dust-texture variation.
  for (const m of state.mottles) {
    const y = hy + Math.pow(m.depthT, 2.1) * groundH;
    const x = vanishX + m.xFrac * width * 1.3 * m.depthT;
    const rad = m.r * (0.3 + m.depthT * 1.3);
    if (rad < 2) continue;
    ctx.fillStyle = `rgba(150,150,156,${m.alpha.toFixed(3)})`;
    ctx.beginPath();
    ctx.ellipse(x, y, rad, rad * 0.35, 0, 0, Math.PI * 2);
    ctx.fill();
  }

  // Faint survey/landing grid, cool and dim — etched into the dust, not glowing turf.
  ctx.strokeStyle = "rgba(160,172,186,0.12)";
  ctx.lineWidth = 1;
  const rows = 14;
  for (let i = 1; i <= rows; i++) {
    const t = (i / rows + state.gridScroll / 80 / rows) % 1;
    const y = hy + Math.pow(t, 2.1) * groundH;
    ctx.globalAlpha = 0.55 * (1 - t) + 0.04;
    ctx.beginPath();
    ctx.moveTo(0, y);
    ctx.lineTo(width, y);
    ctx.stroke();
  }
  ctx.globalAlpha = 1;

  const cols = 16;
  ctx.strokeStyle = "rgba(160,172,186,0.09)";
  for (let i = -cols; i <= cols; i++) {
    const spread = (i / cols) * width * 1.3;
    ctx.beginPath();
    ctx.moveTo(vanishX, hy);
    ctx.lineTo(vanishX + spread, height);
    ctx.stroke();
  }
  ctx.restore();
}

/* ------------------------------------------------------------------- craters */
export function drawCraters(
  ctx: CanvasRenderingContext2D,
  width: number,
  height: number,
  state: WorldState,
  playerBearing: number,
): void {
  const hy = horizonY(height);
  const groundH = height - hy;
  if (groundH <= 0) return;
  const drift = worldDrift(playerBearing, width);
  const vanishX = width / 2 + drift;

  ctx.save();
  ctx.beginPath();
  ctx.rect(0, hy, width, groundH);
  ctx.clip();

  for (const c of state.craters) {
    const t = c.depthT;
    const y = hy + Math.pow(t, 2.1) * groundH;
    const x = vanishX + c.xFrac * width * 1.3 * t;
    const persp = 0.25 + t * 1.5;
    const rx = c.rx * persp;
    const ry = c.ry * persp;
    if (rx < 2 || ry < 1) continue;
    const alpha = 0.25 + t * 0.65;

    // Shallow bowl.
    ctx.fillStyle = `rgba(15,15,17,${(0.4 * alpha).toFixed(3)})`;
    ctx.beginPath();
    ctx.ellipse(x, y, rx, ry, 0, 0, Math.PI * 2);
    ctx.fill();

    // Hard black shadow on the side away from the light — an offset ellipse
    // clipped to the crater bowl, same trick as the Earth's terminator, so
    // the edge follows the bowl's curve instead of radiating from center.
    ctx.save();
    ctx.beginPath();
    ctx.ellipse(x, y, rx, ry, 0, 0, Math.PI * 2);
    ctx.clip();
    ctx.fillStyle = `rgba(0,0,0,${Math.min(0.95, 0.7 * alpha + 0.2).toFixed(3)})`;
    ctx.beginPath();
    ctx.ellipse(x - LIGHT.x * rx * 0.6, y - LIGHT.y * ry * 0.6, rx * 0.98, ry * 0.98, 0, 0, Math.PI * 2);
    ctx.fill();
    ctx.restore();

    // Bright hard rim on the lit side.
    ctx.strokeStyle = `rgba(226,230,236,${Math.min(1, 0.55 * alpha + 0.25).toFixed(3)})`;
    ctx.lineWidth = 1;
    ctx.beginPath();
    ctx.ellipse(x, y, rx, ry, 0, LIGHT_ANGLE - 1.05, LIGHT_ANGLE + 1.05);
    ctx.stroke();
  }
  ctx.restore();
}

/* ------------------------------------------------------------------- boost dust */
export function drawDust(ctx: CanvasRenderingContext2D, width: number, height: number, state: WorldState): void {
  ctx.save();
  ctx.fillStyle = "#c9cacd";
  for (const mote of state.dust) {
    if (!mote.active) continue;
    const alpha = Math.max(0, 1 - mote.life / mote.maxLife) * 0.55;
    if (alpha <= 0.01) continue;
    ctx.globalAlpha = alpha;
    const x = mote.xFrac * width;
    const y = mote.yFrac * height;
    ctx.fillRect(x, y, 1.4, 1.4);
  }
  ctx.restore();
  ctx.globalAlpha = 1;
}
