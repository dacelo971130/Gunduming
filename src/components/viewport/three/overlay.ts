/**
 * Screen-space overlay drawn on a 2D canvas above the WebGL frame: enemy
 * tags (codename, HP bar, distance), target-lock brackets, weak-point marker,
 * aperture-rim edge arrows for off-FOV contacts, the pilot's reticle, canopy
 * crack decals and the red damage flash. Everything is clipped to the
 * aperture circle so it reads as projected onto the glass.
 */
import type { Aperture } from "@/components/cockpit/layout";
import { clamp } from "./math";

export const MANTIS_COLOR = "#ffb43d";
export const CRIMSON_COLOR = "#ff3b4e";
const FONT = "600 11px ui-monospace, SFMono-Regular, Menlo, monospace";
const FONT_SMALL = "500 9px ui-monospace, SFMono-Regular, Menlo, monospace";

export interface Tag {
  x: number;
  y: number;
  /** Half-width/height in px for brackets. */
  hw: number;
  hh: number;
  codename: string;
  hpPct: number;
  distance: number;
  color: string;
  alpha: number;
  locked: boolean;
  lockAge: number;
  weakPoint: boolean;
  winding: boolean;
}

export interface FleetMark {
  x: number;
  y: number;
  /** Seconds until the shells land (negative = landed). */
  eta: number;
}

export interface EdgeArrow {
  /** Screen angle (rad) around the aperture centre where the contact left the circle. */
  angle: number;
  label: string;
  color: string;
}

interface Crack {
  x: number;
  y: number;
  life: number;
  seed: number;
}

export class Overlay {
  readonly canvas: HTMLCanvasElement;
  private readonly ctx: CanvasRenderingContext2D;
  private width = 1;
  private height = 1;
  private dpr = 1;
  private aperture: Aperture = { cx: 0, cy: 0, r: 1 };
  private readonly cracks: Crack[] = [];
  private flash = 0;
  private lastCrackAt = -10;
  private bossPulse = 0;
  /** 0..1 white overexposure (nuke) — set by the scene each frame. */
  whiteout = 0;
  reticleOpen = 0;
  time = 0;

  constructor() {
    this.canvas = document.createElement("canvas");
    this.canvas.style.cssText = "position:absolute;inset:0;width:100%;height:100%;pointer-events:none;";
    const ctx = this.canvas.getContext("2d");
    if (!ctx) throw new Error("overlay 2d context unavailable");
    this.ctx = ctx;
  }

  resize(width: number, height: number, dpr: number, aperture: Aperture): void {
    this.width = width;
    this.height = height;
    this.dpr = dpr;
    this.aperture = aperture;
    this.canvas.width = Math.floor(width * dpr);
    this.canvas.height = Math.floor(height * dpr);
  }

  crack(fromBearing: number, amount: number): void {
    this.flash = 1;
    // Only solid hits leave a mark, and never more than one every ~1.5 s.
    if (amount < 4 || this.time - this.lastCrackAt < 1.5) return;
    this.lastCrackAt = this.time;
    const { cx, cy, r } = this.aperture;
    const side = clamp(fromBearing / 35, -1, 1);
    this.cracks.push({
      x: cx + side * r * 0.55 + (Math.random() - 0.5) * r * 0.5,
      y: cy + (Math.random() - 0.6) * r * 0.9,
      life: 4,
      seed: Math.random() * 1000,
    });
    if (this.cracks.length > 3) this.cracks.shift();
  }

  bossIntro(): void {
    this.bossPulse = 3;
  }

  draw(dt: number, tags: Tag[], arrows: EdgeArrow[], shake: number, fleet: FleetMark | null = null): void {
    this.time += dt;
    this.flash = Math.max(0, this.flash - dt / 0.3);
    this.bossPulse = Math.max(0, this.bossPulse - dt);
    this.reticleOpen = Math.max(0, this.reticleOpen - dt / 0.3);
    const ctx = this.ctx;
    ctx.setTransform(this.dpr, 0, 0, this.dpr, 0, 0);
    ctx.clearRect(0, 0, this.width, this.height);
    const { cx, cy, r } = this.aperture;

    ctx.save();
    ctx.beginPath();
    ctx.arc(cx, cy, r, 0, Math.PI * 2);
    ctx.clip();

    const sx = shake ? (Math.random() - 0.5) * 4 * shake : 0;
    const sy = shake ? (Math.random() - 0.5) * 4 * shake : 0;
    ctx.translate(sx, sy);

    for (const t of tags) this.drawTag(t);
    if (fleet) this.drawFleetMark(fleet);
    ctx.translate(-sx, -sy);
    for (const a of arrows) this.drawArrow(a);
    this.drawReticle();

    if (this.whiteout > 0.005) {
      ctx.fillStyle = `rgba(255,250,240,${clamp(this.whiteout, 0, 1)})`;
      ctx.fillRect(0, 0, this.width, this.height);
    }
    // Red damage flash + boss pulse
    if (this.flash > 0) {
      ctx.fillStyle = `rgba(255,40,40,${this.flash * this.flash * 0.1})`;
      ctx.fillRect(0, 0, this.width, this.height);
    }
    if (this.bossPulse > 0) {
      const p = (Math.sin(this.time * 7) * 0.5 + 0.5) * Math.min(1, this.bossPulse);
      const g = ctx.createRadialGradient(cx, cy, r * 0.5, cx, cy, r);
      g.addColorStop(0, "rgba(255,40,60,0)");
      g.addColorStop(1, `rgba(255,40,60,${0.22 * p})`);
      ctx.fillStyle = g;
      ctx.fillRect(0, 0, this.width, this.height);
    }
    for (let i = this.cracks.length - 1; i >= 0; i--) {
      const c = this.cracks[i];
      c.life -= dt;
      if (c.life <= 0) {
        this.cracks.splice(i, 1);
        continue;
      }
      this.drawCrack(c);
    }
    ctx.restore();
  }

  private drawTag(t: Tag): void {
    const ctx = this.ctx;
    ctx.globalAlpha = t.alpha;
    const bw = 58;
    const top = t.y - t.hh - 30;
    // leader
    ctx.strokeStyle = t.color;
    ctx.lineWidth = 1;
    ctx.beginPath();
    ctx.moveTo(t.x, t.y - t.hh);
    ctx.lineTo(t.x, top + 16);
    ctx.stroke();
    // backing + text
    ctx.font = FONT;
    ctx.textBaseline = "top";
    const label = t.codename;
    const w = Math.max(bw, ctx.measureText(label).width) + 10;
    ctx.fillStyle = "rgba(3,6,8,0.62)";
    ctx.fillRect(t.x - w / 2, top - 4, w, 20);
    ctx.fillStyle = t.color;
    ctx.textAlign = "center";
    ctx.fillText(label, t.x, top - 2);
    // HP bar
    ctx.fillStyle = "rgba(255,255,255,0.14)";
    ctx.fillRect(t.x - bw / 2, top + 11, bw, 3);
    ctx.fillStyle = t.hpPct > 50 ? t.color : t.hpPct > 25 ? "#ffb43d" : "#ff3b4e";
    ctx.fillRect(t.x - bw / 2, top + 11, (bw * clamp(t.hpPct, 0, 100)) / 100, 3);
    // distance
    ctx.font = FONT_SMALL;
    ctx.fillStyle = "rgba(230,236,240,0.85)";
    ctx.fillText(`${Math.round(t.distance)}M${t.winding ? "  FIRING" : ""}`, t.x, t.y + t.hh + 4);

    if (t.locked) {
      const grow = 1 + Math.max(0, 0.6 - t.lockAge) * 2.2;
      const hw = (t.hw + 10) * grow;
      const hh = (t.hh + 10) * grow;
      const L = Math.min(hw, hh) * 0.35;
      ctx.strokeStyle = "#39ff7a";
      ctx.lineWidth = 1.5;
      ctx.beginPath();
      for (const [sxn, syn] of [[-1, -1], [1, -1], [1, 1], [-1, 1]] as Array<[number, number]>) {
        const x = t.x + sxn * hw;
        const y = t.y + syn * hh;
        ctx.moveTo(x, y + syn * -L);
        ctx.lineTo(x, y);
        ctx.lineTo(x + sxn * -L, y);
      }
      ctx.stroke();
      if (t.lockAge > 0.5) {
        ctx.font = FONT_SMALL;
        ctx.fillStyle = "#39ff7a";
        ctx.textAlign = "left";
        ctx.fillText("LOCK", t.x + hw + 4, t.y - hh);
      }
    }
    if (t.weakPoint) {
      const p = Math.sin(this.time * 9) * 0.5 + 0.5;
      const s = 7 + p * 4;
      ctx.strokeStyle = "#ffb43d";
      ctx.lineWidth = 1.5;
      ctx.beginPath();
      ctx.moveTo(t.x, t.y - s);
      ctx.lineTo(t.x + s, t.y);
      ctx.lineTo(t.x, t.y + s);
      ctx.lineTo(t.x - s, t.y);
      ctx.closePath();
      ctx.stroke();
      ctx.font = FONT_SMALL;
      ctx.fillStyle = "#ffb43d";
      ctx.textAlign = "left";
      ctx.fillText("WEAK PT", t.x + s + 4, t.y - 4);
    }
    ctx.globalAlpha = 1;
    ctx.textAlign = "left";
  }

  private drawFleetMark(f: FleetMark): void {
    const ctx = this.ctx;
    const p = Math.sin(this.time * 6) * 0.5 + 0.5;
    const R = 22 + p * 6;
    ctx.strokeStyle = "rgba(160,220,255,0.95)";
    ctx.lineWidth = 1.5;
    ctx.beginPath();
    ctx.arc(f.x, f.y, R, 0, Math.PI * 2);
    ctx.stroke();
    ctx.beginPath();
    for (const [dx, dy] of [[1, 0], [-1, 0], [0, 1], [0, -1]]) {
      ctx.moveTo(f.x + dx * (R - 8), f.y + dy * (R - 8));
      ctx.lineTo(f.x + dx * (R + 10), f.y + dy * (R + 10));
    }
    ctx.stroke();
    ctx.font = FONT_SMALL;
    ctx.fillStyle = "rgba(160,220,255,0.95)";
    ctx.textAlign = "left";
    ctx.textBaseline = "top";
    ctx.fillText(f.eta > 0 ? `FLEET  T-${f.eta.toFixed(1)}` : "FLEET  IMPACT", f.x + R + 6, f.y - 6);
  }

  private drawArrow(a: EdgeArrow): void {
    const ctx = this.ctx;
    const { cx, cy, r } = this.aperture;
    const rr = r - 26;
    const x = cx + Math.cos(a.angle) * rr;
    const y = cy + Math.sin(a.angle) * rr;
    const blink = Math.sin(this.time * 8) > -0.2;
    ctx.save();
    ctx.translate(x, y);
    ctx.rotate(a.angle);
    ctx.fillStyle = a.color;
    ctx.globalAlpha = blink ? 1 : 0.45;
    ctx.beginPath();
    ctx.moveTo(12, 0);
    ctx.lineTo(-4, -8);
    ctx.lineTo(-4, 8);
    ctx.closePath();
    ctx.fill();
    ctx.restore();
    ctx.font = FONT_SMALL;
    ctx.fillStyle = a.color;
    ctx.textAlign = Math.cos(a.angle) > 0 ? "right" : "left";
    ctx.textBaseline = "middle";
    ctx.fillText(a.label, x - Math.cos(a.angle) * 18, y - Math.sin(a.angle) * 18 + 10);
    ctx.textAlign = "left";
    ctx.textBaseline = "top";
  }

  private drawReticle(): void {
    const ctx = this.ctx;
    const { cx, cy } = this.aperture;
    const open = 10 + this.reticleOpen * 10;
    ctx.strokeStyle = "rgba(120,255,170,0.7)";
    ctx.lineWidth = 1;
    ctx.beginPath();
    ctx.arc(cx, cy, 3, 0, Math.PI * 2);
    ctx.stroke();
    ctx.beginPath();
    for (const [dx, dy] of [[1, 0], [-1, 0], [0, 1], [0, -1]]) {
      ctx.moveTo(cx + dx * open, cy + dy * open);
      ctx.lineTo(cx + dx * (open + 9), cy + dy * (open + 9));
    }
    ctx.stroke();
  }

  private drawCrack(c: Crack): void {
    const ctx = this.ctx;
    const a = clamp(c.life / 2.5, 0, 1) * 0.42;
    const rnd = mulberry(c.seed);
    const branches = 5 + Math.floor(rnd() * 3);
    ctx.lineCap = "round";
    for (let pass = 0; pass < 2; pass++) {
      ctx.strokeStyle = pass === 0 ? `rgba(0,0,0,${a * 0.6})` : `rgba(235,242,248,${a})`;
      ctx.lineWidth = pass === 0 ? 2.4 : 1;
      ctx.beginPath();
      for (let i = 0; i < branches; i++) {
        const ang = (i / branches) * Math.PI * 2 + rnd() * 0.6;
        let x = c.x;
        let y = c.y;
        ctx.moveTo(x, y);
        const segs = 3 + Math.floor(rnd() * 3);
        let len = 8 + rnd() * 16;
        for (let s = 0; s < segs; s++) {
          const j = ang + (rnd() - 0.5) * 0.9;
          x += Math.cos(j) * len;
          y += Math.sin(j) * len;
          ctx.lineTo(x, y);
          len *= 0.6;
        }
      }
      // connecting web
      for (let i = 0; i < 2; i++) {
        const rad = 5 + i * 7 + rnd() * 3;
        ctx.moveTo(c.x + rad, c.y);
        for (let k = 1; k <= 8; k++) {
          const ang = (k / 8) * Math.PI * 2;
          const rr = rad * (0.8 + rnd() * 0.4);
          ctx.lineTo(c.x + Math.cos(ang) * rr, c.y + Math.sin(ang) * rr);
        }
      }
      ctx.stroke();
    }
    // impact star
    const g = ctx.createRadialGradient(c.x, c.y, 0, c.x, c.y, 7);
    g.addColorStop(0, `rgba(255,255,255,${a * 0.7})`);
    g.addColorStop(1, "rgba(255,255,255,0)");
    ctx.fillStyle = g;
    ctx.fillRect(c.x - 7, c.y - 7, 14, 14);
  }
}

function mulberry(seed: number): () => number {
  let a = Math.floor(seed * 1000) >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}
