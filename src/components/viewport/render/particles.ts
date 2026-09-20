/**
 * One small pooled particle system shared by muzzle flash, impacts, explosions,
 * thruster wash and drifting ash. Fixed-size ring buffer — spawning never
 * allocates in the hot loop, it just overwrites the oldest slot.
 */

export type ParticleKind = "spark" | "debris" | "smoke" | "flash" | "ash" | "ring" | "thruster";

export interface Particle {
  active: boolean;
  x: number;
  y: number;
  vx: number;
  vy: number;
  life: number;
  maxLife: number;
  size: number;
  color: string;
  kind: ParticleKind;
  rot: number;
  vrot: number;
  drag: number;
  gravity: number;
}

export interface ParticlePool {
  items: Particle[];
  cursor: number;
}

const POOL_SIZE = 400;

function blankParticle(): Particle {
  return {
    active: false,
    x: 0,
    y: 0,
    vx: 0,
    vy: 0,
    life: 0,
    maxLife: 1,
    size: 1,
    color: "#ffffff",
    kind: "spark",
    rot: 0,
    vrot: 0,
    drag: 0,
    gravity: 0,
  };
}

export function createParticlePool(size = POOL_SIZE): ParticlePool {
  const items: Particle[] = [];
  for (let i = 0; i < size; i++) items.push(blankParticle());
  return { items, cursor: 0 };
}

/** Grab the next ring slot and stamp it with new values. O(1), no allocation. */
function nextSlot(pool: ParticlePool): Particle {
  const p = pool.items[pool.cursor];
  pool.cursor = (pool.cursor + 1) % pool.items.length;
  return p;
}

export function spawnParticle(
  pool: ParticlePool,
  init: Partial<Particle> & { x: number; y: number },
): void {
  const p = nextSlot(pool);
  p.active = true;
  p.x = init.x;
  p.y = init.y;
  p.vx = init.vx ?? 0;
  p.vy = init.vy ?? 0;
  p.life = init.life ?? 1;
  p.maxLife = init.maxLife ?? p.life;
  p.size = init.size ?? 2;
  p.color = init.color ?? "#ffffff";
  p.kind = init.kind ?? "spark";
  p.rot = init.rot ?? 0;
  p.vrot = init.vrot ?? 0;
  p.drag = init.drag ?? 0.02;
  p.gravity = init.gravity ?? 0;
}

export function updateParticles(pool: ParticlePool, dt: number): void {
  for (const p of pool.items) {
    if (!p.active) continue;
    p.life -= dt;
    if (p.life <= 0) {
      p.active = false;
      continue;
    }
    p.vx *= 1 - p.drag;
    p.vy *= 1 - p.drag;
    p.vy += p.gravity * dt;
    p.x += p.vx * dt;
    p.y += p.vy * dt;
    p.rot += p.vrot * dt;
  }
}

export function drawParticles(ctx: CanvasRenderingContext2D, pool: ParticlePool): void {
  for (const p of pool.items) {
    if (!p.active) continue;
    const t = clamp01(p.life / p.maxLife);
    ctx.save();
    ctx.translate(p.x, p.y);
    ctx.rotate(p.rot);
    ctx.globalAlpha = clamp01(t);
    switch (p.kind) {
      case "spark": {
        ctx.strokeStyle = p.color;
        ctx.lineWidth = Math.max(0.6, p.size * 0.4);
        ctx.beginPath();
        ctx.moveTo(0, 0);
        ctx.lineTo(-p.vx * 0.025, -p.vy * 0.025);
        ctx.stroke();
        break;
      }
      case "debris": {
        ctx.fillStyle = p.color;
        const s = p.size * (0.4 + t * 0.6);
        ctx.fillRect(-s / 2, -s / 2, s, s);
        break;
      }
      case "smoke": {
        const grad = ctx.createRadialGradient(0, 0, 0, 0, 0, p.size * (1.4 - t * 0.4));
        grad.addColorStop(0, colorAlpha(p.color, 0.35 * t));
        grad.addColorStop(1, colorAlpha(p.color, 0));
        ctx.fillStyle = grad;
        ctx.beginPath();
        ctx.arc(0, 0, p.size * (1.4 - t * 0.4), 0, Math.PI * 2);
        ctx.fill();
        break;
      }
      case "flash": {
        const grad = ctx.createRadialGradient(0, 0, 0, 0, 0, p.size);
        grad.addColorStop(0, colorAlpha("#ffffff", 0.9 * t));
        grad.addColorStop(0.4, colorAlpha(p.color, 0.6 * t));
        grad.addColorStop(1, colorAlpha(p.color, 0));
        ctx.fillStyle = grad;
        ctx.beginPath();
        ctx.arc(0, 0, p.size, 0, Math.PI * 2);
        ctx.fill();
        break;
      }
      case "ring": {
        ctx.strokeStyle = colorAlpha(p.color, t);
        ctx.lineWidth = Math.max(1, p.size * 0.12);
        ctx.beginPath();
        ctx.arc(0, 0, p.size * (1 - t) * 3 + p.size * 0.2, 0, Math.PI * 2);
        ctx.stroke();
        break;
      }
      case "thruster": {
        ctx.fillStyle = colorAlpha(p.color, 0.5 * t);
        ctx.beginPath();
        ctx.ellipse(0, 0, p.size * 0.5, p.size * 1.4, 0, 0, Math.PI * 2);
        ctx.fill();
        break;
      }
      case "ash": {
        ctx.fillStyle = colorAlpha(p.color, 0.4 * t);
        ctx.fillRect(-p.size / 2, -p.size / 2, p.size, p.size);
        break;
      }
    }
    ctx.restore();
  }
}

function clamp01(v: number): number {
  return v < 0 ? 0 : v > 1 ? 1 : v;
}

function colorAlpha(hex: string, alpha: number): string {
  const m = /^#([0-9a-f]{6})$/i.exec(hex);
  if (!m) return hex;
  const n = parseInt(m[1], 16);
  const r = (n >> 16) & 255;
  const g = (n >> 8) & 255;
  const b = n & 255;
  return `rgba(${r},${g},${b},${clamp01(alpha)})`;
}

/* ------------------------------------------------------------ convenience spawners */

export function spawnMuzzleFlash(pool: ParticlePool, x: number, y: number): void {
  spawnParticle(pool, {
    x, y, kind: "flash", life: 0.14, size: 34, color: "#4ef5a7", drag: 0,
  });
  for (let i = 0; i < 6; i++) {
    const a = Math.random() * Math.PI * 2;
    const spd = 60 + Math.random() * 120;
    spawnParticle(pool, {
      x, y, kind: "spark", life: 0.2 + Math.random() * 0.1,
      vx: Math.cos(a) * spd, vy: Math.sin(a) * spd,
      size: 3, color: "#c9ffe6", drag: 0.08,
    });
  }
}

export function spawnHitBurst(pool: ParticlePool, x: number, y: number, scale: number, color: string): void {
  const n = 10;
  for (let i = 0; i < n; i++) {
    const a = Math.random() * Math.PI * 2;
    const spd = 40 + Math.random() * 160;
    spawnParticle(pool, {
      x, y, kind: Math.random() < 0.5 ? "spark" : "debris",
      life: 0.25 + Math.random() * 0.3,
      vx: Math.cos(a) * spd, vy: Math.sin(a) * spd - 30,
      size: (1.5 + Math.random() * 2.5) * Math.max(0.4, scale),
      color, drag: 0.05, gravity: 140,
    });
  }
  spawnParticle(pool, { x, y, kind: "flash", life: 0.12, size: 18 * Math.max(0.5, scale), color });
}

export function spawnExplosion(pool: ParticlePool, x: number, y: number, scale: number): void {
  const s = Math.max(0.5, scale);
  spawnParticle(pool, { x, y, kind: "flash", life: 0.22, size: 70 * s, color: "#ffe0a0" });
  spawnParticle(pool, { x, y, kind: "ring", life: 0.5, size: 46 * s, color: "#ffb43d" });
  spawnParticle(pool, { x, y, kind: "ring", life: 0.7, size: 30 * s, color: "#ff3b4e" });
  const debrisN = 16;
  for (let i = 0; i < debrisN; i++) {
    const a = Math.random() * Math.PI * 2;
    const spd = 60 + Math.random() * 220;
    spawnParticle(pool, {
      x, y, kind: "debris", life: 0.5 + Math.random() * 0.6,
      vx: Math.cos(a) * spd, vy: Math.sin(a) * spd - 60,
      size: (2 + Math.random() * 3.5) * s, color: Math.random() < 0.5 ? "#3a3a3a" : "#ffb43d",
      drag: 0.06, gravity: 220, vrot: (Math.random() - 0.5) * 10,
    });
  }
  const smokeN = 10;
  for (let i = 0; i < smokeN; i++) {
    const a = Math.random() * Math.PI * 2;
    const spd = 10 + Math.random() * 40;
    spawnParticle(pool, {
      x, y, kind: "smoke", life: 0.9 + Math.random() * 0.8,
      vx: Math.cos(a) * spd, vy: Math.sin(a) * spd - 40,
      size: (20 + Math.random() * 20) * s, color: "#2a2f33", drag: 0.03, gravity: -20,
    });
  }
}

export function spawnAsh(pool: ParticlePool, width: number, height: number): void {
  spawnParticle(pool, {
    x: Math.random() * width,
    y: height * 0.3 + Math.random() * height * 0.5,
    kind: "ash",
    life: 4 + Math.random() * 3,
    vx: -10 + Math.random() * 20,
    vy: 6 + Math.random() * 10,
    size: 1 + Math.random() * 1.5,
    color: "#3b5555",
    drag: 0,
  });
}

export function spawnThrusterWash(pool: ParticlePool, x: number, y: number): void {
  spawnParticle(pool, {
    x, y, kind: "thruster", life: 0.3 + Math.random() * 0.2,
    vx: (Math.random() - 0.5) * 20, vy: 30 + Math.random() * 20,
    size: 6, color: "#4ef5a7", drag: 0.04,
  });
}
