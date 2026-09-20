/**
 * Layer 3/4 helpers — weapon fire (tracers + charged beam) and lingering
 * impact scars, plus the BOSS_INTRO entrance choreography (streak, heat
 * haze, settle). Pure draw/update functions; BattleViewport owns the bus
 * subscriptions and calls into these.
 */

export interface Tracer {
  x0: number; y0: number; x1: number; y1: number; life: number; maxLife: number;
}

export interface Scar {
  x: number; y: number; scale: number; life: number; maxLife: number;
}

export interface FxState {
  tracers: Tracer[];
  beamT: number; // 0..1, counts down after fx:special
  beamTarget: { x: number; y: number } | null;
  scars: Scar[];
}

export function createFxState(): FxState {
  return { tracers: [], beamT: 0, beamTarget: null, scars: [] };
}

export function fireTracer(state: FxState, x0: number, y0: number, x1: number, y1: number): void {
  state.tracers.push({ x0, y0, x1, y1, life: 0.22, maxLife: 0.22 });
  if (state.tracers.length > 24) state.tracers.shift();
}

export function fireBeam(state: FxState, target: { x: number; y: number } | null): void {
  state.beamT = 1;
  state.beamTarget = target;
}

export function addScar(state: FxState, x: number, y: number, scale: number): void {
  state.scars.push({ x, y, scale, life: 6, maxLife: 6 });
  if (state.scars.length > 12) state.scars.shift();
}

export function updateFx(state: FxState, dt: number): void {
  for (let i = state.tracers.length - 1; i >= 0; i--) {
    state.tracers[i].life -= dt;
    if (state.tracers[i].life <= 0) state.tracers.splice(i, 1);
  }
  if (state.beamT > 0) state.beamT = Math.max(0, state.beamT - dt / 0.5);
  for (let i = state.scars.length - 1; i >= 0; i--) {
    state.scars[i].life -= dt;
    if (state.scars[i].life <= 0) state.scars.splice(i, 1);
  }
}

export function drawTracers(ctx: CanvasRenderingContext2D, state: FxState): void {
  for (const t of state.tracers) {
    const a = t.life / t.maxLife;
    ctx.save();
    ctx.globalAlpha = a;
    ctx.strokeStyle = "#c9ffe6";
    ctx.lineWidth = 1.6;
    ctx.shadowColor = "#4ef5a7";
    ctx.shadowBlur = 8;
    ctx.beginPath();
    ctx.moveTo(t.x0, t.y0);
    ctx.lineTo(t.x1, t.y1);
    ctx.stroke();
    ctx.restore();
  }
}

export function drawBeam(ctx: CanvasRenderingContext2D, state: FxState, width: number, height: number): void {
  if (state.beamT <= 0) return;
  const t = state.beamT;
  const target = state.beamTarget ?? { x: width / 2, y: height * 0.5 };
  ctx.save();
  ctx.globalAlpha = Math.min(1, t * 1.6);
  const grad = ctx.createLinearGradient(width * 0.5, height, target.x, target.y);
  grad.addColorStop(0, "rgba(78,245,167,0.9)");
  grad.addColorStop(1, "rgba(200,255,230,0.95)");
  ctx.strokeStyle = grad;
  ctx.lineWidth = 14 * t + 3;
  ctx.shadowColor = "#4ef5a7";
  ctx.shadowBlur = 40 * t;
  ctx.beginPath();
  ctx.moveTo(width * 0.5, height);
  ctx.lineTo(target.x, target.y);
  ctx.stroke();

  // Screen-filling bloom wash on the first instant.
  if (t > 0.75) {
    ctx.globalAlpha = (t - 0.75) * 2.2;
    ctx.fillStyle = "rgba(78,245,167,0.18)";
    ctx.fillRect(0, 0, width, height);
  }
  ctx.restore();
}

export function drawScars(ctx: CanvasRenderingContext2D, state: FxState): void {
  for (const sc of state.scars) {
    const a = Math.min(1, sc.life / sc.maxLife) * 0.35;
    ctx.save();
    ctx.globalAlpha = a;
    ctx.fillStyle = "#1a1712";
    ctx.beginPath();
    ctx.ellipse(sc.x, sc.y, 14 * sc.scale, 5 * sc.scale, 0, 0, Math.PI * 2);
    ctx.fill();
    ctx.strokeStyle = "rgba(255,120,60,0.4)";
    ctx.lineWidth = 1;
    ctx.stroke();
    ctx.restore();
  }
}

/* ----------------------------------------------------------- BOSS_INTRO */

export interface BossIntroState {
  active: boolean;
  t: number; // seconds elapsed
  duration: number;
}

export function createBossIntroState(): BossIntroState {
  return { active: false, t: 0, duration: 1.7 };
}

export function startBossIntro(state: BossIntroState): void {
  state.active = true;
  state.t = 0;
}

export function updateBossIntro(state: BossIntroState, dt: number): void {
  if (!state.active) return;
  state.t += dt;
  if (state.t >= state.duration) state.active = false;
}

export function drawBossIntro(
  ctx: CanvasRenderingContext2D,
  width: number,
  height: number,
  state: BossIntroState,
): void {
  if (!state.active) return;
  const t = state.t / state.duration;

  // High-speed streak crossing the frame in the first ~0.35s.
  if (t < 0.32) {
    const st = t / 0.32;
    const y = height * (0.3 + 0.15 * st);
    const sx = -width * 0.2 + (width * 1.4) * st;
    ctx.save();
    ctx.globalAlpha = 1 - st * 0.3;
    const grad = ctx.createLinearGradient(sx - 260, y, sx, y);
    grad.addColorStop(0, "rgba(255,31,61,0)");
    grad.addColorStop(1, "rgba(255,220,220,0.95)");
    ctx.strokeStyle = grad;
    ctx.lineWidth = 3;
    ctx.shadowColor = "#ff3b4e";
    ctx.shadowBlur = 20;
    ctx.beginPath();
    ctx.moveTo(sx - 260, y + 10);
    ctx.lineTo(sx, y);
    ctx.stroke();
    ctx.restore();
  }

  // Heat-haze distortion: cheap fake refraction via offset translucent bands.
  if (t > 0.2 && t < 0.95) {
    const ht = (t - 0.2) / 0.75;
    ctx.save();
    ctx.globalAlpha = 0.5 * (1 - ht);
    const bands = 10;
    for (let i = 0; i < bands; i++) {
      const y = (i / bands) * height;
      const wobble = Math.sin(i * 1.7 + state.t * 14) * 6 * (1 - ht);
      ctx.fillStyle = i % 2 === 0 ? "rgba(255,90,60,0.05)" : "rgba(255,180,120,0.04)";
      ctx.fillRect(wobble, y, width, height / bands + 1);
    }
    ctx.restore();
  }

  // Red temperature-drop wash, strongest mid-sequence, fading as CRIMSON settles.
  const washT = Math.sin(Math.min(1, t) * Math.PI);
  ctx.save();
  ctx.globalAlpha = 0.16 * washT;
  ctx.fillStyle = "#8f0f1e";
  ctx.fillRect(0, 0, width, height);
  ctx.restore();
}
