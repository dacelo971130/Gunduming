/**
 * Layer 2 — enemy silhouettes, floating HUD tags, target lock brackets and
 * the weak-point marker. Original designs only: MANTIS-01 is a towering,
 * mass-production industrial war machine — broad, heavy, small-headed, built
 * cheap and hard to kill. CRIMSON-01 is a taller but sleeker, faster ace
 * machine, a different class entirely. Everything is drawn anchored at
 * (x, groundY) — the enemy's feet — scaled from a 92px base unit at scale 1.
 */

const UNIT = 92;
const SIDES: readonly number[] = [-1, 1];

// Fixed (module-scope, allocated once) detail positions so the render loop
// never builds arrays or objects per frame — only reads them.
const CHEST_RIVETS: readonly [number, number][] = [
  [0.08, 0.12], [0.92, 0.12], [0.08, 0.88], [0.92, 0.88], [0.5, 0.08],
];
const THIGH_RIVETS: readonly [number, number][] = [
  [0.2, 0.2], [0.8, 0.2], [0.5, 0.82],
];
const SCUFF_MARKS: readonly [number, number, number, number][] = [
  [0.1, 0.28, 0.12, 0.05],
  [0.58, 0.52, 0.16, 0.04],
  [0.28, 0.7, 0.1, 0.05],
];
const DUST_PUFFS: readonly [number, number][] = [
  [-0.34, 0.02], [0.3, -0.01], [-0.08, 0.035], [0.16, 0.01],
];

// HUD anchor ratios (relative to UNIT * scale) tuned to clear both the
// grunt's and the ace's silhouettes without being kind-aware.
const HUD_TAG_TOP = 1.62;
const HUD_LOCK_LABEL = 1.82;
const HUD_TORSO_CENTER = 0.72;
const HUD_LOCK_RADIUS = 0.95;
const HUD_WEAKPOINT = 0.72;

export interface EnemyAnim {
  bank: number; // radians, current visual lean
  bankTarget: number;
  bob: number; // phase accumulator
  prevBearing: number;
  trail: { x: number; y: number; scale: number }[]; // CRIMSON afterimage history
  // -- weight/motion cues, computed each frame in updateEnemyAnim --
  lean: number; // eased forward/back lean from closing speed
  leanTarget: number;
  shoulderLag: number; // secondary swing trailing `bank`, sells shoulder mass
  speed: number; // smoothed closing/opening-rate proxy (screen scale delta)
  prevScale: number;
  settleOffset: number; // spring-damped vertical settle after a stop
  settleVel: number;
  primed: boolean; // false until the first update has real prev* values
}

export function createEnemyAnim(bearing: number): EnemyAnim {
  return {
    bank: 0,
    bankTarget: 0,
    bob: Math.random() * Math.PI * 2,
    prevBearing: bearing,
    trail: [],
    lean: 0,
    leanTarget: 0,
    shoulderLag: 0,
    speed: 0,
    prevScale: 0,
    settleOffset: 0,
    settleVel: 0,
    primed: false,
  };
}

export function updateEnemyAnim(anim: EnemyAnim, bearing: number, dt: number, x: number, y: number, scale: number, kind: "MANTIS" | "CRIMSON"): void {
  const dBearing = bearing - anim.prevBearing;
  anim.prevBearing = bearing;
  anim.bankTarget = clamp(-dBearing * 0.12, -0.5, 0.5);
  anim.bank += (anim.bankTarget - anim.bank) * Math.min(1, dt * 6);
  anim.bob += dt * (kind === "CRIMSON" ? 2.4 : 1.6);

  // Shoulder mass trails the turn instead of snapping with the torso.
  anim.shoulderLag += (anim.bank - anim.shoulderLag) * Math.min(1, dt * 2.4);

  // Scale growth/shrink over time is a cheap proxy for closing/opening speed —
  // no extra world-space velocity is available at this layer.
  const safeDt = Math.max(dt, 1 / 240);
  if (anim.primed) {
    const closingRate = (scale - anim.prevScale) / safeDt;
    anim.leanTarget = clamp(closingRate * 3.4, -0.14, 0.24);
    anim.lean += (anim.leanTarget - anim.lean) * Math.min(1, dt * 3.5);

    const rawSpeed = Math.abs(closingRate);
    const prevSpeed = anim.speed;
    anim.speed += (rawSpeed - anim.speed) * Math.min(1, dt * 5);
    const decel = prevSpeed - anim.speed;
    if (decel > 0.3) {
      // A sudden stop kicks the settle spring — the heavier the stop, the harder it settles.
      anim.settleVel -= decel * 1.8;
    }
  } else {
    anim.primed = true;
  }
  anim.prevScale = scale;

  // Critically-damped-ish spring: everything about this motion should say "mass".
  anim.settleVel += (-anim.settleOffset * 46 - anim.settleVel * 9) * dt;
  anim.settleOffset += anim.settleVel * dt;
  anim.settleOffset = clamp(anim.settleOffset, -1.4, 1.4);
  anim.settleVel = clamp(anim.settleVel, -12, 12);

  if (kind === "CRIMSON") {
    anim.trail.unshift({ x, y, scale });
    if (anim.trail.length > 8) anim.trail.length = 8;
  }
}

function clamp(v: number, lo: number, hi: number): number {
  return v < lo ? lo : v > hi ? hi : v;
}

/* ---------------------------------------------------------------- helpers */

/** A filled panel with a lighter bevel along its bottom edge and a dark seam
 * along its top — cheap trick to make flat plates read as thick armour. */
function drawPlate(ctx: CanvasRenderingContext2D, x: number, y: number, w: number, h: number, r: number, fill: string, edgeLight: string, edgeDark: string): void {
  roundedRect(ctx, x, y, w, h, r);
  ctx.fillStyle = fill;
  ctx.fill();
  const bevel = Math.max(0.6, h * 0.12);
  ctx.fillStyle = edgeLight;
  ctx.fillRect(x + r * 0.4, y + h - bevel, Math.max(0, w - r * 0.8), bevel);
  ctx.fillStyle = edgeDark;
  ctx.fillRect(x + r * 0.4, y, Math.max(0, w - r * 0.8), Math.max(0.5, bevel * 0.4));
}

function drawRivet(ctx: CanvasRenderingContext2D, x: number, y: number, s: number): void {
  ctx.fillStyle = "#0b140e";
  ctx.beginPath();
  ctx.arc(x, y, Math.max(0.5, s * 0.012), 0, Math.PI * 2);
  ctx.fill();
}

/** Long cast shadow + faint ground dust — sold weight starts at the feet. */
function drawGroundContact(ctx: CanvasRenderingContext2D, x: number, y: number, s: number, alpha: number, reach: number): void {
  if (alpha <= 0.02) return;
  ctx.save();
  ctx.fillStyle = "#000000";
  ctx.globalAlpha = alpha * 0.45;
  ctx.beginPath();
  ctx.ellipse(x, y, s * 0.44, s * 0.1, 0, 0, Math.PI * 2);
  ctx.fill();
  ctx.globalAlpha = alpha * 0.24;
  ctx.beginPath();
  ctx.ellipse(x + s * reach * 0.55, y, s * reach, s * 0.05, 0, 0, Math.PI * 2);
  ctx.fill();
  ctx.globalAlpha = alpha * 0.15;
  ctx.fillStyle = "#c9c2a8";
  for (const [dx, dy] of DUST_PUFFS) {
    ctx.beginPath();
    ctx.ellipse(x + dx * s, y + dy * s, s * 0.09, s * 0.028, 0, 0, Math.PI * 2);
    ctx.fill();
  }
  ctx.restore();
}

/* -------------------------------------------------------------- MANTIS-01 */

/**
 * Mass-production grunt: a towering, slab-shouldered industrial war machine.
 * Deep thick chest, short powerful legs, big splayed feet, small flat head.
 * Weld seams, panel lines, hazard striping, stencilled numbering, rivets and
 * scuffed plating read as "cheap to build, hard to kill". Deliberately plain
 * and functional — no monoeye-on-a-round-head, no tube skirt armour.
 */
export function drawMantis(
  ctx: CanvasRenderingContext2D,
  x: number,
  y: number,
  scale: number,
  anim: EnemyAnim,
  spawnFade: number,
): void {
  const s = UNIT * scale;
  if (s < 1.2) return;

  const bobWave = Math.sin(anim.bob) * s * 0.022 + Math.sin(anim.bob * 2.15) * s * 0.007;
  const settle = anim.settleOffset * s * 0.05;
  const bob = bobWave + settle;

  drawGroundContact(ctx, x, y, s, spawnFade, 1.1);

  ctx.save();
  ctx.translate(x, y + bob);
  ctx.rotate(anim.bank * 0.4 + anim.lean * 0.5);
  ctx.globalAlpha = spawnFade;

  const armor = "#3c6b46";
  const armorDark = "#233d29";
  const armorDeep = "#141f17";
  const armorLight = "#6fac79";
  const armorEdge = "#9adba3";
  const joint = "#101b13";

  // ---- big splayed feet, ground-contact plates ----
  for (const side of SIDES) {
    ctx.save();
    ctx.translate(side * s * 0.26, 0);
    ctx.rotate(side * 0.08);
    ctx.fillStyle = armorDark;
    roundedRect(ctx, -s * 0.2, -s * 0.03, s * 0.4, s * 0.06, s * 0.015);
    ctx.fill();
    ctx.fillStyle = armorDeep;
    roundedRect(ctx, -s * 0.15, -s * 0.11, s * 0.3, s * 0.1, s * 0.02);
    ctx.fill();
    ctx.restore();
  }

  // ---- shins + ankle actuators ----
  for (const side of SIDES) {
    ctx.save();
    ctx.translate(side * s * 0.26, 0);
    ctx.fillStyle = joint;
    roundedRect(ctx, -s * 0.055, -s * 0.16, s * 0.11, s * 0.07, s * 0.015);
    ctx.fill();
    drawPlate(ctx, -s * 0.09, -s * 0.36, s * 0.18, s * 0.2, s * 0.02, armor, armorEdge, armorDeep);
    ctx.restore();
  }

  // ---- knee actuators (hydraulic pistons) ----
  ctx.lineCap = "round";
  for (const side of SIDES) {
    ctx.strokeStyle = "#9fb8a4";
    ctx.lineWidth = s * 0.026;
    ctx.beginPath();
    ctx.moveTo(side * s * 0.26, -s * 0.34);
    ctx.lineTo(side * s * 0.26, -s * 0.48);
    ctx.stroke();
    ctx.fillStyle = armorDeep;
    ctx.beginPath();
    ctx.arc(side * s * 0.26, -s * 0.36, s * 0.045, 0, Math.PI * 2);
    ctx.fill();
  }

  // ---- short, powerful thighs ----
  for (const side of SIDES) {
    ctx.save();
    ctx.translate(side * s * 0.21, -s * 0.48);
    ctx.rotate(side * 0.03);
    drawPlate(ctx, -s * 0.13, 0, s * 0.26, s * 0.2, s * 0.02, armor, armorEdge, armorDeep);
    ctx.restore();
    for (const [dx, dy] of THIGH_RIVETS) {
      drawRivet(ctx, side * s * 0.21 - s * 0.13 + dx * s * 0.26, -s * 0.48 + dy * s * 0.2, s);
    }
  }

  // ---- heavy hip / pelvis block, overlapping the thighs ----
  drawPlate(ctx, -s * 0.33, -s * 0.68, s * 0.66, s * 0.24, s * 0.03, armorDark, armorLight, "#0a120c");

  // ---- narrow waist joint, cinching the mass above from the mass below ----
  ctx.fillStyle = armorDeep;
  ctx.fillRect(-s * 0.14, -s * 0.7, s * 0.28, s * 0.06);

  // ---- deep, thick chest block (back layer, then a lighter front plate) ----
  drawPlate(ctx, -s * 0.35, -s * 1.12, s * 0.7, s * 0.44, s * 0.04, armor, armorEdge, armorDeep);
  drawPlate(ctx, -s * 0.27, -s * 1.04, s * 0.54, s * 0.28, s * 0.03, armorLight, "#c8f2cd", armorDark);

  // weld seam across the chest join
  ctx.strokeStyle = armorDeep;
  ctx.lineWidth = Math.max(0.6, s * 0.012);
  ctx.beginPath();
  ctx.moveTo(-s * 0.27, -s * 0.86);
  ctx.lineTo(s * 0.27, -s * 0.86);
  ctx.stroke();
  // vertical panel line down the sternum
  ctx.beginPath();
  ctx.moveTo(0, -s * 1.04);
  ctx.lineTo(0, -s * 0.78);
  ctx.stroke();

  for (const [dx, dy] of CHEST_RIVETS) {
    drawRivet(ctx, (-0.35 + dx * 0.7) * s, (-1.12 + dy * 0.44) * s, s);
  }
  ctx.fillStyle = "rgba(8,16,10,0.35)";
  for (const [dx, dy, w, h] of SCUFF_MARKS) {
    ctx.fillRect((-0.35 + dx) * s, (-1.12 + dy) * s, w * s, h * s);
  }

  // stencilled unit numbering
  ctx.fillStyle = "rgba(18,36,23,0.85)";
  ctx.font = `${Math.max(6, s * 0.065)}px var(--font-mono, monospace)`;
  ctx.textAlign = "center";
  ctx.fillText("MP-04", 0, -s * 0.8);

  // ---- broad slab shoulders, wider than the torso, swinging with lag ----
  for (const side of SIDES) {
    ctx.save();
    ctx.translate(side * s * 0.48 + anim.shoulderLag * side * s * 0.03, -s * 1.06);
    ctx.rotate(anim.shoulderLag * 0.15 * side);
    drawPlate(ctx, -s * 0.16, -s * 0.13, s * 0.32, s * 0.27, s * 0.03, armorDark, armorLight, "#0a120c");
    ctx.restore();
  }

  // hazard stripe, clipped to the left shoulder plate only
  ctx.save();
  ctx.translate(-s * 0.48, -s * 1.06);
  roundedRect(ctx, -s * 0.16, -s * 0.13, s * 0.32, s * 0.27, s * 0.03);
  ctx.clip();
  for (let i = -2; i <= 3; i++) {
    ctx.fillStyle = i % 2 === 0 ? "#1a1a1a" : "#e0b400";
    ctx.beginPath();
    ctx.moveTo(-s * 0.2 + i * s * 0.1, -s * 0.2);
    ctx.lineTo(-s * 0.2 + i * s * 0.1 + s * 0.06, -s * 0.2);
    ctx.lineTo(-s * 0.2 + i * s * 0.1 + s * 0.06 - s * 0.4, s * 0.2);
    ctx.lineTo(-s * 0.2 + i * s * 0.1 - s * 0.4, s * 0.2);
    ctx.closePath();
    ctx.fill();
  }
  ctx.restore();

  // ---- upper arms + forearms, thick piston actuators ----
  for (const side of SIDES) {
    ctx.strokeStyle = armorDark;
    ctx.lineWidth = s * 0.09;
    ctx.lineCap = "round";
    ctx.beginPath();
    ctx.moveTo(side * s * 0.52, -s * 0.96);
    ctx.lineTo(side * s * 0.58, -s * 0.7);
    ctx.stroke();
    ctx.strokeStyle = "#9fb8a4";
    ctx.lineWidth = s * 0.03;
    ctx.beginPath();
    ctx.moveTo(side * s * 0.58, -s * 0.7);
    ctx.lineTo(side * s * 0.62, -s * 0.52);
    ctx.stroke();
  }

  // ---- small head, flat industrial block (small on purpose — the scale tell) ----
  ctx.fillStyle = armorLight;
  roundedRect(ctx, -s * 0.09, -s * 1.32, s * 0.18, s * 0.16, s * 0.015);
  ctx.fill();

  // single horizontal optical band
  ctx.fillStyle = "#bff5d0";
  ctx.shadowColor = "#4ef5a7";
  ctx.shadowBlur = s * 0.1;
  ctx.fillRect(-s * 0.075, -s * 1.26, s * 0.15, s * 0.022);
  ctx.shadowBlur = 0;

  // thin sensor antennae
  ctx.strokeStyle = "#8affd0";
  ctx.lineWidth = Math.max(0.5, s * 0.012);
  for (const side of SIDES) {
    ctx.beginPath();
    ctx.moveTo(side * s * 0.03, -s * 1.32);
    ctx.lineTo(side * s * 0.07, -s * 1.44);
    ctx.stroke();
  }

  // ---- stubby, heavy rifle held low ----
  ctx.fillStyle = "#0c130e";
  ctx.fillRect(s * 0.6, -s * 0.58, s * 0.32, s * 0.09);
  ctx.fillRect(s * 0.86, -s * 0.6, s * 0.08, s * 0.13);
  ctx.fillStyle = armorDeep;
  ctx.fillRect(s * 0.6, -s * 0.6, s * 0.1, s * 0.13);

  // ---- exhaust vents on the lower back, heat glow + shimmer ----
  const heat = 0.55 + Math.sin(anim.bob * 1.6) * 0.25;
  ctx.save();
  ctx.globalAlpha *= 0.85;
  for (const side of SIDES) {
    const vx = side * s * 0.12;
    const vy = -s * 0.58;
    ctx.fillStyle = armorDeep;
    ctx.fillRect(vx - s * 0.03, vy, s * 0.06, s * 0.1);
    const grad = ctx.createRadialGradient(vx, vy + s * 0.1, 0, vx, vy + s * 0.1, s * 0.12 * heat);
    grad.addColorStop(0, "rgba(255,150,60,0.55)");
    grad.addColorStop(1, "rgba(255,150,60,0)");
    ctx.fillStyle = grad;
    ctx.beginPath();
    ctx.arc(vx, vy + s * 0.1, s * 0.12 * heat, 0, Math.PI * 2);
    ctx.fill();
  }
  // faint heat shimmer: wavy vertical streaks rising off the vents
  ctx.strokeStyle = "rgba(255,205,160,0.18)";
  ctx.lineWidth = Math.max(0.5, s * 0.01);
  for (const side of SIDES) {
    const vx = side * s * 0.12;
    ctx.beginPath();
    for (let i = 0; i <= 4; i++) {
      const t = i / 4;
      const wobble = Math.sin(anim.bob * 3 + t * 4 + side) * s * 0.015;
      const px = vx + wobble;
      const py = -s * 0.58 - t * s * 0.16;
      if (i === 0) ctx.moveTo(px, py);
      else ctx.lineTo(px, py);
    }
    ctx.stroke();
  }
  ctx.restore();

  ctx.restore();
}

/* ------------------------------------------------------------- CRIMSON-01 */

/**
 * The Red Ace: taller than the grunts but a different class of machine —
 * sharp swept forms, long head crest, twin bright core lights, trailing
 * energy wake. Sleeker and faster, never bulkier. Original design only.
 */
export function drawCrimson(
  ctx: CanvasRenderingContext2D,
  x: number,
  y: number,
  scale: number,
  anim: EnemyAnim,
  spawnFade: number,
  time: number,
): void {
  const s = UNIT * scale * 1.32;
  if (s < 1.2) return;

  // Afterimage trail first, underneath the main body.
  for (let i = anim.trail.length - 1; i >= 0; i--) {
    const g = anim.trail[i];
    const t = i / anim.trail.length;
    ctx.save();
    ctx.globalAlpha = spawnFade * (1 - t) * 0.16;
    ctx.translate(g.x, g.y);
    ctx.scale((UNIT * g.scale * 1.32) / s, (UNIT * g.scale * 1.32) / s);
    drawCrimsonBody(ctx, s, anim, "#ff3b4e", "#8f0f1e", time, true);
    ctx.restore();
  }

  const bob = Math.sin(anim.bob) * s * 0.025;
  ctx.save();
  ctx.translate(x, y + bob);
  ctx.rotate(anim.bank + anim.lean * 0.6);
  ctx.globalAlpha = spawnFade;
  drawCrimsonBody(ctx, s, anim, "#ff1f3d", "#2b2f33", time, false);
  ctx.restore();
}

function drawCrimsonBody(
  ctx: CanvasRenderingContext2D,
  s: number,
  _anim: EnemyAnim,
  primary: string,
  secondary: string,
  time: number,
  silhouetteOnly: boolean,
): void {
  // Trailing energy wake behind the body.
  if (!silhouetteOnly) {
    const grad = ctx.createLinearGradient(0, -s * 0.5, s * 0.7, -s * 0.2);
    grad.addColorStop(0, "rgba(255,31,61,0.35)");
    grad.addColorStop(1, "rgba(255,31,61,0)");
    ctx.fillStyle = grad;
    ctx.beginPath();
    ctx.moveTo(-s * 0.1, -s * 0.55);
    ctx.quadraticCurveTo(s * 0.5, -s * 0.35, s * 0.85, -s * 0.15);
    ctx.lineTo(s * 0.75, -s * 0.02);
    ctx.quadraticCurveTo(s * 0.4, -s * 0.2, -s * 0.15, -s * 0.4);
    ctx.closePath();
    ctx.fill();
  }

  // Swept dark-grey torso.
  ctx.fillStyle = secondary;
  ctx.beginPath();
  ctx.moveTo(-s * 0.22, -s * 0.7);
  ctx.lineTo(s * 0.18, -s * 0.76);
  ctx.lineTo(s * 0.28, -s * 0.5);
  ctx.lineTo(s * 0.14, -s * 0.18);
  ctx.lineTo(-s * 0.2, -s * 0.22);
  ctx.lineTo(-s * 0.3, -s * 0.48);
  ctx.closePath();
  ctx.fill();

  // Crimson chest plate, sharp swept edge.
  ctx.fillStyle = primary;
  ctx.beginPath();
  ctx.moveTo(-s * 0.16, -s * 0.66);
  ctx.lineTo(s * 0.12, -s * 0.7);
  ctx.lineTo(s * 0.2, -s * 0.5);
  ctx.lineTo(-s * 0.02, -s * 0.28);
  ctx.lineTo(-s * 0.18, -s * 0.46);
  ctx.closePath();
  ctx.fill();

  // Swept shoulder blades, angular.
  for (const side of SIDES) {
    ctx.save();
    ctx.translate(side * s * 0.26, -s * 0.66);
    ctx.scale(side, 1);
    ctx.fillStyle = primary;
    ctx.beginPath();
    ctx.moveTo(0, -s * 0.06);
    ctx.lineTo(s * 0.28, -s * 0.02);
    ctx.lineTo(s * 0.22, s * 0.14);
    ctx.lineTo(0, s * 0.12);
    ctx.closePath();
    ctx.fill();
    ctx.restore();
  }

  // Long head crest.
  ctx.fillStyle = primary;
  ctx.beginPath();
  ctx.moveTo(-s * 0.05, -s * 0.98);
  ctx.lineTo(s * 0.02, -s * 1.26);
  ctx.lineTo(s * 0.07, -s * 0.98);
  ctx.lineTo(s * 0.16, -s * 0.86);
  ctx.lineTo(-s * 0.08, -s * 0.84);
  ctx.closePath();
  ctx.fill();
  ctx.fillStyle = secondary;
  roundedRect(ctx, -s * 0.11, -s * 0.88, s * 0.24, s * 0.14, s * 0.02);
  ctx.fill();

  // Twin bright core lights — the tell of an ace unit.
  const pulse = 0.7 + Math.sin(time * 6) * 0.3;
  ctx.save();
  ctx.shadowColor = "#fff0d0";
  ctx.shadowBlur = s * 0.18 * pulse;
  ctx.fillStyle = "#fff0d0";
  ctx.beginPath();
  ctx.arc(-s * 0.06, -s * 0.82, s * 0.028 * pulse, 0, Math.PI * 2);
  ctx.arc(s * 0.02, -s * 0.82, s * 0.028 * pulse, 0, Math.PI * 2);
  ctx.fill();
  ctx.restore();

  // Legs, swept back mid-stride.
  ctx.strokeStyle = secondary;
  ctx.lineWidth = s * 0.06;
  ctx.lineCap = "round";
  for (const side of SIDES) {
    ctx.beginPath();
    ctx.moveTo(side * s * 0.08, -s * 0.2);
    ctx.lineTo(side * s * 0.2 + s * 0.06, s * 0.05);
    ctx.lineTo(side * s * 0.12, s * 0.02);
    ctx.stroke();
  }
}

function roundedRect(ctx: CanvasRenderingContext2D, x: number, y: number, w: number, h: number, r: number): void {
  ctx.beginPath();
  ctx.moveTo(x + r, y);
  ctx.arcTo(x + w, y, x + w, y + h, r);
  ctx.arcTo(x + w, y + h, x, y + h, r);
  ctx.arcTo(x, y + h, x, y, r);
  ctx.arcTo(x, y, x + w, y, r);
  ctx.closePath();
}

/* ---------------------------------------------------------------- HUD tag */

export function drawEnemyTag(
  ctx: CanvasRenderingContext2D,
  x: number,
  y: number,
  scale: number,
  codename: string,
  hpPct: number,
  distance: number,
  color: string,
  alpha: number,
): void {
  if (scale < 0.08) return;
  const tagY = y - UNIT * scale * HUD_TAG_TOP - 10;
  ctx.save();
  ctx.globalAlpha = alpha;
  ctx.font = "9px var(--font-mono, monospace)";
  ctx.textAlign = "center";
  ctx.fillStyle = color;
  ctx.textBaseline = "alphabetic";
  ctx.shadowColor = color;
  ctx.shadowBlur = 3;
  ctx.fillText(codename, x, tagY);
  ctx.shadowBlur = 0;

  const barW = 42;
  const barH = 3;
  const segs = 8;
  const bx = x - barW / 2;
  const by = tagY + 4;
  ctx.strokeStyle = "rgba(255,255,255,0.25)";
  ctx.lineWidth = 1;
  ctx.strokeRect(bx, by, barW, barH);
  const filled = Math.round((hpPct / 100) * segs);
  const segW = barW / segs;
  ctx.fillStyle = hpPct > 50 ? color : hpPct > 20 ? "#ffb43d" : "#ff3b4e";
  for (let i = 0; i < filled; i++) {
    ctx.fillRect(bx + i * segW + 0.5, by + 0.5, segW - 1, barH - 1);
  }

  ctx.fillStyle = "rgba(232,244,242,0.7)";
  ctx.font = "8px var(--font-mono, monospace)";
  ctx.fillText(`${Math.round(distance)}M`, x, by + 12);
  ctx.restore();
}

export function drawTargetLock(
  ctx: CanvasRenderingContext2D,
  x: number,
  y: number,
  scale: number,
  time: number,
): void {
  const r = UNIT * scale * HUD_LOCK_RADIUS + Math.sin(time * 4) * 2;
  const snap = Math.min(1, time * 6); // brackets snap in fast on first draw call after lock
  ctx.save();
  ctx.translate(x, y - UNIT * scale * HUD_TORSO_CENTER);
  ctx.strokeStyle = "#4ef5a7";
  ctx.lineWidth = 1.5;
  ctx.shadowColor = "#4ef5a7";
  ctx.shadowBlur = 6;
  const len = r * 0.35;
  const corners: [number, number, number, number][] = [
    [-r, -r, 1, 0], [-r, -r, 0, 1],
    [r, -r, -1, 0], [r, -r, 0, 1],
    [-r, r, 1, 0], [-r, r, 0, -1],
    [r, r, -1, 0], [r, r, 0, -1],
  ];
  ctx.globalAlpha = 0.85;
  const scaled = 0.6 + snap * 0.4;
  ctx.save();
  ctx.scale(scaled, scaled);
  for (let i = 0; i < corners.length; i += 2) {
    const [cx, cy] = corners[i];
    ctx.beginPath();
    ctx.moveTo(cx + corners[i][2] * len, cy);
    ctx.lineTo(cx, cy);
    ctx.lineTo(cx, cy + corners[i + 1][3] * len);
    ctx.stroke();
  }
  ctx.restore();
  ctx.restore();

  ctx.save();
  ctx.globalAlpha = 0.9;
  ctx.fillStyle = "#4ef5a7";
  ctx.font = "10px var(--font-mono, monospace)";
  ctx.textAlign = "center";
  ctx.shadowColor = "#4ef5a7";
  ctx.shadowBlur = 4;
  ctx.fillText("TARGET LOCKED", x, y - UNIT * scale * HUD_LOCK_LABEL - 24);
  ctx.restore();
}

export function drawWeakPoint(
  ctx: CanvasRenderingContext2D,
  x: number,
  y: number,
  scale: number,
  time: number,
): void {
  const pulse = 0.6 + Math.sin(time * 10) * 0.4;
  ctx.save();
  ctx.translate(x, y - UNIT * scale * HUD_WEAKPOINT);
  ctx.globalAlpha = 0.85;
  ctx.strokeStyle = "#ffb43d";
  ctx.fillStyle = "rgba(255,180,61,0.25)";
  ctx.lineWidth = 1.5;
  const r = 6 + pulse * 3;
  ctx.beginPath();
  ctx.arc(0, 0, r, 0, Math.PI * 2);
  ctx.fill();
  ctx.stroke();
  ctx.beginPath();
  ctx.moveTo(-r * 1.8, 0);
  ctx.lineTo(r * 1.8, 0);
  ctx.moveTo(0, -r * 1.8);
  ctx.lineTo(0, r * 1.8);
  ctx.stroke();
  ctx.restore();
}

export function drawEdgeArrow(
  ctx: CanvasRenderingContext2D,
  x: number,
  y: number,
  side: "LEFT" | "RIGHT",
  color: string,
  label: string,
): void {
  const dir = side === "LEFT" ? -1 : 1;
  ctx.save();
  ctx.translate(x, y);
  ctx.globalAlpha = 0.85;
  ctx.fillStyle = color;
  ctx.shadowColor = color;
  ctx.shadowBlur = 5;
  ctx.beginPath();
  ctx.moveTo(dir * 10, 0);
  ctx.lineTo(-dir * 6, -7);
  ctx.lineTo(-dir * 6, 7);
  ctx.closePath();
  ctx.fill();
  ctx.shadowBlur = 0;
  ctx.font = "8px var(--font-mono, monospace)";
  ctx.textAlign = "center";
  ctx.fillStyle = color;
  ctx.fillText(label, 0, dir === -1 ? 18 : 18);
  ctx.restore();
}
