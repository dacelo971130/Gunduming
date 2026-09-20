/**
 * Pseudo-3D projection: turns an enemy's polar position (bearing/distance/altitude,
 * relative to the player) into a screen-space anchor + scale, under a fixed
 * horizontal field of view. No perspective matrix, no 3D library — just enough
 * math to sell "looking out of a cockpit".
 */

/** Horizontal field of view of the canopy glass, in degrees. 0 = dead ahead. */
export const FOV_DEG = 70;
/** Horizon line as a fraction of canvas height (night sky is small, ground is big). */
export const HORIZON_RATIO = 0.56;
/** Distance clamp range, meters. Mirrors Enemy.distance (0..1400) with a safety near-clip. */
export const NEAR_DIST = 30;
export const FAR_DIST = 1400;
/** Distance at which an enemy renders at scale 1. */
const REF_SCALE_DIST = 300;
const MIN_SCALE = 0.05;
const MAX_SCALE = 2.6;
/** How far, as a fraction of height, altitude +-1 swings an anchor near the camera. */
const ALT_SWING_RATIO = 0.16;
/** How far below the horizon a NEAR enemy's feet sit, as a fraction of height. */
const GROUND_DROP_RATIO = 0.34;
/** Keep projected bearing from touching the literal canvas edge. */
const EDGE_PAD = 0.94;

export function clamp(v: number, lo: number, hi: number): number {
  return v < lo ? lo : v > hi ? hi : v;
}

export function horizonY(height: number): number {
  return height * HORIZON_RATIO;
}

export interface Projected {
  x: number;
  y: number;
  /** Render scale: 1 at REF_SCALE_DIST. */
  scale: number;
  /** Inside the FOV cone (with a small buffer for soft clipping). */
  visible: boolean;
  /** 0 = near clip, 1 = far clip. Drives fog / fade. */
  depthT: number;
  /** Which side of the nose the bearing falls on — used for edge arrows even off-FOV. */
  side: "LEFT" | "RIGHT";
  /** Normalized bearing within the FOV cone, -1..1 (unclamped beyond that). */
  norm: number;
}

/** Horizontal span the FOV is mapped onto. Defaults to the full canvas width. */
export interface Glass {
  x: number;
  w: number;
}

/**
 * Project a single enemy anchor (feet/center) into screen space. `glass` is
 * the horizontal region actually visible to the pilot (the canvas fills the
 * whole frame but the HUD panel columns cover its edges) — the FOV cone is
 * mapped onto that span so an enemy dead ahead sits in the middle of the
 * glass and one at the edge of the cone sits at the edge of the glass.
 */
export function projectEnemy(
  bearing: number,
  distance: number,
  altitude: number,
  width: number,
  height: number,
  glass: Glass = { x: 0, w: width },
): Projected {
  const half = FOV_DEG / 2;
  const norm = bearing / half;
  const visible = norm >= -1.06 && norm <= 1.06;

  const hy = horizonY(height);
  const distClamped = clamp(distance, NEAR_DIST, FAR_DIST);
  const depthT = (distClamped - NEAR_DIST) / (FAR_DIST - NEAR_DIST);
  const scale = clamp(REF_SCALE_DIST / distClamped, MIN_SCALE, MAX_SCALE);

  const x = glass.x + glass.w / 2 + norm * (glass.w / 2) * EDGE_PAD;
  const feetDrop = height * GROUND_DROP_RATIO * Math.pow(1 - depthT, 1.4);
  const altPix = altitude * height * ALT_SWING_RATIO * (1 - depthT * 0.5);
  const y = hy + feetDrop - altPix;

  return { x, y, scale, visible, depthT, side: norm < 0 ? "LEFT" : "RIGHT", norm };
}

/** Where to anchor an edge-of-frame "contact this way" arrow for an off-FOV enemy. */
export function edgeArrowPos(
  side: "LEFT" | "RIGHT",
  altitude: number,
  width: number,
  height: number,
  glass: Glass = { x: 0, w: width },
): { x: number; y: number } {
  const hy = horizonY(height);
  const x = side === "LEFT" ? glass.x + glass.w * 0.045 : glass.x + glass.w * 0.955;
  const y = clamp(hy - altitude * height * 0.1, height * 0.14, height * 0.86);
  return { x, y };
}

/** Subtle horizon/world parallax drift as the player's absolute heading changes. */
export function worldDrift(playerBearing: number, width: number): number {
  return Math.sin((playerBearing * Math.PI) / 180) * width * 0.025;
}
