/**
 * Layer 5 — the canopy overlay: reticle, bearing tape, range ticks, frame
 * struts, CRT vignette, interference bands, and the cracked-glass effect
 * from a player hit. This is the glass itself, always drawn last.
 */

export interface CanopyState {
  crackT: number; // 0..1, counts down after a hit
  crackFromBearing: number;
  interferenceT: number; // countdown for an occasional scan-glitch band
  interferenceCooldown: number;
}

export function createCanopyState(): CanopyState {
  return { crackT: 0, crackFromBearing: 0, interferenceT: 0, interferenceCooldown: 4 + Math.random() * 5 };
}

export function triggerCrack(state: CanopyState, fromBearing: number): void {
  state.crackT = 1;
  state.crackFromBearing = fromBearing;
}

export function updateCanopy(state: CanopyState, dt: number): void {
  if (state.crackT > 0) state.crackT = Math.max(0, state.crackT - dt / 1.6);
  state.interferenceCooldown -= dt;
  if (state.interferenceCooldown <= 0) {
    state.interferenceT = 0.15 + Math.random() * 0.1;
    state.interferenceCooldown = 5 + Math.random() * 7;
  }
  if (state.interferenceT > 0) state.interferenceT = Math.max(0, state.interferenceT - dt);
}

export function drawReticle(
  ctx: CanvasRenderingContext2D,
  width: number,
  height: number,
  openness: number,
  hasTarget: boolean,
): void {
  const cx = width / 2;
  const cy = height / 2;
  const gap = 6 + openness * 16;
  const len = 14;
  ctx.save();
  ctx.strokeStyle = hasTarget ? "#4ef5a7" : "rgba(232,244,242,0.6)";
  ctx.lineWidth = 1.2;
  ctx.globalAlpha = 0.85;
  // Four ticks opening/closing around center.
  const dirs: [number, number][] = [[0, -1], [0, 1], [-1, 0], [1, 0]];
  for (const [dx, dy] of dirs) {
    ctx.beginPath();
    ctx.moveTo(cx + dx * gap, cy + dy * gap);
    ctx.lineTo(cx + dx * (gap + len), cy + dy * (gap + len));
    ctx.stroke();
  }
  ctx.beginPath();
  ctx.arc(cx, cy, 1.4, 0, Math.PI * 2);
  ctx.fillStyle = ctx.strokeStyle;
  ctx.fill();
  ctx.restore();
}

export function drawBearingTape(
  ctx: CanvasRenderingContext2D,
  width: number,
  playerBearing: number,
): void {
  const barY = 14;
  const span = 90; // degrees visible across the tape
  const pxPerDeg = width / span;
  ctx.save();
  ctx.beginPath();
  ctx.rect(width * 0.12, 0, width * 0.76, 30);
  ctx.clip();

  ctx.strokeStyle = "rgba(78,245,167,0.3)";
  ctx.fillStyle = "rgba(232,244,242,0.8)";
  ctx.font = "9px var(--font-mono, monospace)";
  ctx.textAlign = "center";
  ctx.lineWidth = 1;

  const centerDeg = Math.round(playerBearing);
  const startDeg = centerDeg - span / 2 - 10;
  const endDeg = centerDeg + span / 2 + 10;
  for (let d = Math.ceil(startDeg / 5) * 5; d <= endDeg; d += 5) {
    const x = width / 2 + (d - playerBearing) * pxPerDeg;
    const major = d % 10 === 0;
    ctx.globalAlpha = major ? 0.9 : 0.4;
    ctx.beginPath();
    ctx.moveTo(x, barY);
    ctx.lineTo(x, barY + (major ? 8 : 4));
    ctx.stroke();
    if (major) {
      const norm = ((d % 360) + 360) % 360;
      ctx.globalAlpha = 0.85;
      ctx.fillText(String(norm).padStart(3, "0"), x, barY - 3);
    }
  }
  ctx.restore();

  ctx.save();
  ctx.strokeStyle = "#4ef5a7";
  ctx.lineWidth = 1.4;
  ctx.beginPath();
  ctx.moveTo(width / 2, barY);
  ctx.lineTo(width / 2 - 4, barY + 10);
  ctx.lineTo(width / 2 + 4, barY + 10);
  ctx.closePath();
  ctx.stroke();
  ctx.restore();
}

export function drawRangeTicks(ctx: CanvasRenderingContext2D, width: number, height: number): void {
  ctx.save();
  ctx.strokeStyle = "rgba(78,245,167,0.25)";
  ctx.fillStyle = "rgba(109,138,138,0.8)";
  ctx.font = "8px var(--font-mono, monospace)";
  ctx.lineWidth = 1;
  const x = width * 0.08;
  const top = height * 0.3;
  const bottom = height * 0.82;
  ctx.beginPath();
  ctx.moveTo(x, top);
  ctx.lineTo(x, bottom);
  ctx.stroke();
  const ticks = 6;
  for (let i = 0; i <= ticks; i++) {
    const y = top + (i / ticks) * (bottom - top);
    ctx.beginPath();
    ctx.moveTo(x - 4, y);
    ctx.lineTo(x, y);
    ctx.stroke();
  }
  ctx.restore();
}

export function drawFrameStruts(ctx: CanvasRenderingContext2D, width: number, height: number): void {
  ctx.save();
  ctx.strokeStyle = "rgba(11,18,25,0.9)";
  ctx.fillStyle = "rgba(8,13,18,0.55)";
  ctx.lineWidth = 2;
  const cut = Math.min(width, height) * 0.09;
  const corners: [number, number, number, number][] = [
    [0, 0, 1, 1],
    [width, 0, -1, 1],
    [0, height, 1, -1],
    [width, height, -1, -1],
  ];
  for (const [cx, cy, dx, dy] of corners) {
    ctx.beginPath();
    ctx.moveTo(cx, cy + dy * cut * 1.8);
    ctx.lineTo(cx, cy);
    ctx.lineTo(cx + dx * cut * 1.8, cy);
    ctx.stroke();
    ctx.beginPath();
    ctx.moveTo(cx, cy);
    ctx.lineTo(cx + dx * cut * 0.5, cy);
    ctx.lineTo(cx, cy + dy * cut * 0.5);
    ctx.closePath();
    ctx.fill();
  }
  ctx.restore();
}

export function drawVignette(ctx: CanvasRenderingContext2D, width: number, height: number): void {
  ctx.save();
  const grad = ctx.createRadialGradient(
    width / 2, height / 2, Math.min(width, height) * 0.35,
    width / 2, height / 2, Math.max(width, height) * 0.72,
  );
  grad.addColorStop(0, "rgba(0,0,0,0)");
  grad.addColorStop(1, "rgba(0,0,0,0.62)");
  ctx.fillStyle = grad;
  ctx.fillRect(0, 0, width, height);
  ctx.restore();
}

export function drawInterference(
  ctx: CanvasRenderingContext2D,
  width: number,
  height: number,
  state: CanopyState,
): void {
  if (state.interferenceT <= 0) return;
  ctx.save();
  ctx.globalAlpha = 0.5;
  const bandH = 18 + Math.random() * 30;
  const y = Math.random() * height;
  ctx.fillStyle = "rgba(78,245,167,0.08)";
  ctx.fillRect(0, y, width, bandH);
  ctx.fillStyle = "rgba(232,244,242,0.05)";
  ctx.fillRect(0, y + bandH * 0.4, width, 1.5);
  ctx.restore();
}

export function drawCrack(
  ctx: CanvasRenderingContext2D,
  width: number,
  height: number,
  state: CanopyState,
): void {
  if (state.crackT <= 0) return;
  const a = state.crackT;
  const originX = width / 2 + Math.sin((state.crackFromBearing * Math.PI) / 180) * width * 0.4;
  const originY = height * 0.45;

  ctx.save();
  ctx.globalAlpha = 0.35 * a;
  ctx.fillStyle = "#ff3b4e";
  ctx.fillRect(0, 0, width, height);
  ctx.restore();

  ctx.save();
  ctx.globalAlpha = Math.min(1, a * 1.4);
  ctx.strokeStyle = "rgba(232,244,242,0.85)";
  ctx.lineWidth = 1;
  const spokes = 9;
  for (let i = 0; i < spokes; i++) {
    const ang = (i / spokes) * Math.PI * 2 + i * 0.4;
    const len = (60 + (i % 3) * 40) * (0.5 + a * 0.5);
    let cx = originX;
    let cy = originY;
    ctx.beginPath();
    ctx.moveTo(cx, cy);
    const segs = 3;
    for (let seg = 0; seg < segs; seg++) {
      cx += Math.cos(ang + (Math.random() - 0.5) * 0.6) * (len / segs);
      cy += Math.sin(ang + (Math.random() - 0.5) * 0.6) * (len / segs);
      ctx.lineTo(cx, cy);
    }
    ctx.stroke();
  }
  // Concentric shock rings near the impact point.
  for (let r = 10; r < 50; r += 16) {
    ctx.beginPath();
    ctx.arc(originX, originY, r * (0.6 + a * 0.4), 0, Math.PI * 2);
    ctx.stroke();
  }
  ctx.restore();
}
