/**
 * Procedural CanvasTextures. Nothing here is loaded from disk — every map is
 * painted once at init with seeded noise so the demo stays 100% asset-free.
 */
import * as THREE from "three";
import { fbm, seeded } from "./math";

function makeCanvas(size: number): { canvas: HTMLCanvasElement; ctx: CanvasRenderingContext2D } {
  const canvas = document.createElement("canvas");
  canvas.width = size;
  canvas.height = size;
  const ctx = canvas.getContext("2d");
  if (!ctx) throw new Error("2d context unavailable for procedural texture");
  return { canvas, ctx };
}

function finish(canvas: HTMLCanvasElement, color: boolean, repeat = 1): THREE.CanvasTexture {
  const tex = new THREE.CanvasTexture(canvas);
  tex.wrapS = THREE.RepeatWrapping;
  tex.wrapT = THREE.RepeatWrapping;
  tex.repeat.set(repeat, repeat);
  tex.anisotropy = 4;
  if (color) tex.colorSpace = THREE.SRGBColorSpace;
  tex.needsUpdate = true;
  return tex;
}

/** Grey regolith grain — used as colour map (tinted) and bump map. */
export function regolithTexture(size = 512): { map: THREE.CanvasTexture; bump: THREE.CanvasTexture } {
  const { canvas, ctx } = makeCanvas(size);
  const img = ctx.createImageData(size, size);
  const rnd = seeded(11);
  for (let y = 0; y < size; y++) {
    for (let x = 0; x < size; x++) {
      const n = fbm(x / 48, y / 48, 4);
      const fine = fbm(x / 6 + 40, y / 6 + 9, 2);
      let v = 118 + (n - 0.5) * 70 + (fine - 0.5) * 38 + (rnd() - 0.5) * 22;
      if (rnd() < 0.004) v -= 60; // dark pebble
      v = Math.max(28, Math.min(225, v));
      const i = (y * size + x) * 4;
      img.data[i] = v;
      img.data[i + 1] = v * 0.985;
      img.data[i + 2] = v * 0.95;
      img.data[i + 3] = 255;
    }
  }
  ctx.putImageData(img, 0, 0);
  const map = finish(canvas, true, 40);
  const bump = finish(canvas, false, 40);
  return { map, bump };
}

/** Yellow/black hazard chevrons (colour map). */
export function hazardTexture(size = 128): THREE.CanvasTexture {
  const { canvas, ctx } = makeCanvas(size);
  ctx.fillStyle = "#c9a227";
  ctx.fillRect(0, 0, size, size);
  ctx.fillStyle = "#151412";
  const w = size / 4;
  for (let i = -1; i < 5; i++) {
    ctx.beginPath();
    ctx.moveTo(i * w, 0);
    ctx.lineTo(i * w + w / 2, 0);
    ctx.lineTo(i * w + w / 2 + size, size);
    ctx.lineTo(i * w + size, size);
    ctx.closePath();
    ctx.fill();
  }
  // grime
  const rnd = seeded(5);
  for (let i = 0; i < 400; i++) {
    ctx.fillStyle = `rgba(20,18,15,${rnd() * 0.35})`;
    ctx.fillRect(rnd() * size, rnd() * size, 1 + rnd() * 3, 1 + rnd() * 2);
  }
  return finish(canvas, true, 3);
}

/**
 * Painted armour: base colour with chipped edges, scratches, rust specks and
 * a couple of stencilled markings. Box UVs put one tile per face so the wear
 * reads on every slab.
 */
export function armourTexture(base: string, chip: string, seed: number, size = 256, wear = 1): THREE.CanvasTexture {
  const { canvas, ctx } = makeCanvas(size);
  const rnd = seeded(seed);
  ctx.fillStyle = base;
  ctx.fillRect(0, 0, size, size);
  // tonal variation
  for (let i = 0; i < 1400 * wear; i++) {
    const a = (0.03 + rnd() * 0.08) * wear;
    ctx.fillStyle = rnd() < 0.5 ? `rgba(0,0,0,${a})` : `rgba(255,255,255,${a * 0.5})`;
    const r = 2 + rnd() * 18;
    ctx.beginPath();
    ctx.ellipse(rnd() * size, rnd() * size, r, r * (0.4 + rnd()), rnd() * 3, 0, Math.PI * 2);
    ctx.fill();
  }
  // edge chipping: bare metal along the border
  ctx.strokeStyle = chip;
  for (let i = 0; i < 90 * wear; i++) {
    const side = Math.floor(rnd() * 4);
    const t = rnd() * size;
    const len = 2 + rnd() * 9;
    const depth = 1 + rnd() * 4;
    ctx.lineWidth = 1 + rnd() * 1.5;
    ctx.beginPath();
    if (side === 0) { ctx.moveTo(t, 0); ctx.lineTo(t + len * (rnd() - 0.5), depth); }
    else if (side === 1) { ctx.moveTo(t, size); ctx.lineTo(t + len * (rnd() - 0.5), size - depth); }
    else if (side === 2) { ctx.moveTo(0, t); ctx.lineTo(depth, t + len * (rnd() - 0.5)); }
    else { ctx.moveTo(size, t); ctx.lineTo(size - depth, t + len * (rnd() - 0.5)); }
    ctx.stroke();
  }
  // scratches
  for (let i = 0; i < 40 * wear; i++) {
    ctx.strokeStyle = rnd() < 0.6 ? `rgba(200,200,190,${(0.2 + rnd() * 0.4) * wear})` : `rgba(0,0,0,${(0.3 + rnd() * 0.3) * wear})`;
    ctx.lineWidth = 0.6 + rnd();
    const x = rnd() * size;
    const y = rnd() * size;
    ctx.beginPath();
    ctx.moveTo(x, y);
    ctx.lineTo(x + (rnd() - 0.5) * 60, y + (rnd() - 0.5) * 60);
    ctx.stroke();
  }
  // rust specks
  for (let i = 0; i < 160 * wear; i++) {
    ctx.fillStyle = `rgba(110,60,30,${0.25 + rnd() * 0.5})`;
    ctx.fillRect(rnd() * size, rnd() * size, 1 + rnd() * 2, 1 + rnd() * 2);
  }
  // stencil
  ctx.fillStyle = "rgba(230,225,210,0.55)";
  ctx.font = `bold ${Math.floor(size / 11)}px monospace`;
  ctx.fillText(seed % 2 ? "07-K" : "VF-3", size * 0.12, size * 0.9);
  ctx.fillRect(size * 0.6, size * 0.86, size * 0.28, size / 40);
  return finish(canvas, true, 1);
}

/** Canopy glass dirt: alpha = where grime/scratches sit (white = dirty). */
export function glassDirtTexture(size = 512): THREE.CanvasTexture {
  const { canvas, ctx } = makeCanvas(size);
  const rnd = seeded(99);
  ctx.fillStyle = "#000";
  ctx.fillRect(0, 0, size, size);
  for (let i = 0; i < 160; i++) {
    const a = 0.04 + rnd() * 0.12;
    ctx.fillStyle = `rgba(255,255,255,${a})`;
    const r = 6 + rnd() * 60;
    ctx.beginPath();
    ctx.ellipse(rnd() * size, rnd() * size, r, r * (0.3 + rnd() * 0.7), rnd() * 3, 0, Math.PI * 2);
    ctx.fill();
  }
  for (let i = 0; i < 70; i++) {
    ctx.strokeStyle = `rgba(255,255,255,${0.15 + rnd() * 0.45})`;
    ctx.lineWidth = 0.5 + rnd() * 1.2;
    const x = rnd() * size;
    const y = rnd() * size;
    ctx.beginPath();
    ctx.moveTo(x, y);
    ctx.lineTo(x + (rnd() - 0.5) * 220, y + (rnd() - 0.5) * 120);
    ctx.stroke();
  }
  for (let i = 0; i < 900; i++) {
    ctx.fillStyle = `rgba(255,255,255,${0.2 + rnd() * 0.6})`;
    ctx.fillRect(rnd() * size, rnd() * size, 1, 1);
  }
  const tex = finish(canvas, false, 1);
  tex.wrapS = THREE.ClampToEdgeWrapping;
  tex.wrapT = THREE.ClampToEdgeWrapping;
  return tex;
}

/**
 * Earth as a lit sphere baked into a billboard: day side (oceans/continents/
 * clouds) with a hard terminator, thin night side with faint city glow, and
 * an atmosphere rim. `lightDir` is in billboard space (x right, y up, z toward viewer).
 */
export function earthBillboard(size = 512, lightDir: [number, number, number] = [0.8, 0.3, 0.12]): THREE.CanvasTexture {
  const { canvas, ctx } = makeCanvas(size);
  const img = ctx.createImageData(size, size);
  const len = Math.hypot(...lightDir);
  const lx = lightDir[0] / len;
  const ly = lightDir[1] / len;
  const lz = lightDir[2] / len;
  const R = size * 0.42;
  const cx = size / 2;
  const cy = size / 2;
  for (let y = 0; y < size; y++) {
    for (let x = 0; x < size; x++) {
      const dx = (x - cx) / R;
      const dy = -(y - cy) / R;
      const d2 = dx * dx + dy * dy;
      const i = (y * size + x) * 4;
      if (d2 > 1.18 * 1.18) continue;
      if (d2 > 1) {
        // atmosphere halo
        const t = (Math.sqrt(d2) - 1) / 0.18;
        const lit = Math.max(0, dx * lx + dy * ly + 0.35);
        const a = (1 - t) * (1 - t) * 0.55 * Math.min(1, lit + 0.15);
        img.data[i] = 110;
        img.data[i + 1] = 160;
        img.data[i + 2] = 255;
        img.data[i + 3] = a * 255;
        continue;
      }
      const dz = Math.sqrt(1 - d2);
      const ndotl = dx * lx + dy * ly + dz * lz;
      // surface: continents from noise
      const lon = Math.atan2(dx, dz) * 1.4;
      const lat = Math.asin(Math.max(-1, Math.min(1, dy))) * 1.4;
      const land = fbm(lon * 1.6 + 3.1, lat * 1.6 + 1.7, 4);
      const cloud = fbm(lon * 3 + 9.2, lat * 2.4 + 4.4, 3);
      const ice = Math.abs(dy) > 0.82;
      let r: number, g: number, b: number;
      if (ice) { r = 225; g = 232; b = 240; }
      else if (land > 0.56) { const k = (land - 0.56) * 6; r = 96 + k * 40; g = 92 + k * 20; b = 58; }
      else { r = 18; g = 52; b = 118; }
      if (cloud > 0.58) { const k = Math.min(1, (cloud - 0.58) * 5); r += (245 - r) * k; g += (245 - g) * k; b += (250 - b) * k; }
      const diffuse = Math.max(0, ndotl);
      const term = Math.pow(diffuse, 0.7);
      const rim = Math.pow(1 - dz, 3) * 0.6 * Math.max(0, ndotl + 0.4);
      let R_ = r * term + 90 * rim;
      let G_ = g * term + 140 * rim;
      let B_ = b * term + 255 * rim;
      // night side: faint city lights on land
      if (ndotl < 0.02 && !ice && land > 0.6 && fbm(lon * 20, lat * 20, 2) > 0.62) { R_ += 70; G_ += 55; B_ += 25; }
      R_ += 4; G_ += 6; B_ += 12; // earthshine-lit night floor
      img.data[i] = Math.min(255, R_);
      img.data[i + 1] = Math.min(255, G_);
      img.data[i + 2] = Math.min(255, B_);
      img.data[i + 3] = 255;
    }
  }
  ctx.putImageData(img, 0, 0);
  const tex = finish(canvas, true, 1);
  tex.wrapS = THREE.ClampToEdgeWrapping;
  tex.wrapT = THREE.ClampToEdgeWrapping;
  return tex;
}

/** Soft round particle sprite (alpha). */
export function softDotTexture(size = 64): THREE.CanvasTexture {
  const { canvas, ctx } = makeCanvas(size);
  const g = ctx.createRadialGradient(size / 2, size / 2, 0, size / 2, size / 2, size / 2);
  g.addColorStop(0, "rgba(255,255,255,1)");
  g.addColorStop(0.35, "rgba(255,255,255,0.7)");
  g.addColorStop(1, "rgba(255,255,255,0)");
  ctx.fillStyle = g;
  ctx.fillRect(0, 0, size, size);
  const tex = finish(canvas, false, 1);
  tex.wrapS = THREE.ClampToEdgeWrapping;
  tex.wrapT = THREE.ClampToEdgeWrapping;
  return tex;
}

/** Brushed dark cockpit metal with panel lines. */
export function cockpitMetalTexture(size = 256): { map: THREE.CanvasTexture; rough: THREE.CanvasTexture } {
  const { canvas, ctx } = makeCanvas(size);
  const rnd = seeded(77);
  ctx.fillStyle = "#2a2c2e";
  ctx.fillRect(0, 0, size, size);
  for (let i = 0; i < 2600; i++) {
    ctx.fillStyle = rnd() < 0.5 ? `rgba(0,0,0,${rnd() * 0.25})` : `rgba(255,255,255,${rnd() * 0.06})`;
    ctx.fillRect(rnd() * size, rnd() * size, 1 + rnd() * 40, 1);
  }
  ctx.strokeStyle = "rgba(0,0,0,0.6)";
  ctx.lineWidth = 2;
  ctx.strokeRect(6, 6, size - 12, size - 12);
  for (let i = 0; i < 6; i++) {
    ctx.fillStyle = "#1a1b1c";
    ctx.beginPath();
    ctx.arc(14 + (i % 2) * (size - 28), 14 + Math.floor(i / 2) * ((size - 28) / 2), 3, 0, Math.PI * 2);
    ctx.fill();
  }
  const map = finish(canvas, true, 1);
  const rough = finish(canvas, false, 1);
  return { map, rough };
}
