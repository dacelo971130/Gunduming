/**
 * Pooled GPU particles (one THREE.Points per pool, CPU-simulated, zero
 * per-frame allocation) plus a small rigid debris pool and fireball pool.
 */
import * as THREE from "three";
import { softDotTexture } from "./textures";

const VERT = /* glsl */ `
attribute float size;
attribute float alpha;
attribute vec3 tint;
varying float vAlpha;
varying vec3 vTint;
uniform float pixelScale;
void main() {
  vAlpha = alpha;
  vTint = tint;
  vec4 mv = modelViewMatrix * vec4(position, 1.0);
  gl_PointSize = size * pixelScale / max(0.5, -mv.z);
  gl_Position = projectionMatrix * mv;
}`;

const FRAG = /* glsl */ `
uniform sampler2D map;
varying float vAlpha;
varying vec3 vTint;
void main() {
  vec4 t = texture2D(map, gl_PointCoord);
  if (t.a * vAlpha < 0.004) discard;
  gl_FragColor = vec4(vTint, t.a * vAlpha);
}`;

export interface SpawnOpts {
  life: number;
  size: number;
  r: number;
  g: number;
  b: number;
  /** Velocity damping per second (0 = none). */
  drag?: number;
  gravity?: number;
  /** Size multiplier over lifetime (1 = constant, 2 = doubles). */
  grow?: number;
  /** Alpha at birth. */
  alpha?: number;
}

export class ParticlePool {
  readonly points: THREE.Points;
  private readonly max: number;
  private readonly pos: Float32Array;
  private readonly vel: Float32Array;
  private readonly life: Float32Array;
  private readonly maxLife: Float32Array;
  private readonly size0: Float32Array;
  private readonly grow: Float32Array;
  private readonly drag: Float32Array;
  private readonly grav: Float32Array;
  private readonly alpha0: Float32Array;
  private readonly sizeAttr: THREE.BufferAttribute;
  private readonly alphaAttr: THREE.BufferAttribute;
  private readonly posAttr: THREE.BufferAttribute;
  private readonly tintAttr: THREE.BufferAttribute;
  private cursor = 0;
  private readonly material: THREE.ShaderMaterial;
  private readonly texture: THREE.Texture;

  constructor(max: number, additive: boolean) {
    this.max = max;
    this.pos = new Float32Array(max * 3);
    this.vel = new Float32Array(max * 3);
    this.life = new Float32Array(max);
    this.maxLife = new Float32Array(max);
    this.size0 = new Float32Array(max);
    this.grow = new Float32Array(max);
    this.drag = new Float32Array(max);
    this.grav = new Float32Array(max);
    this.alpha0 = new Float32Array(max);
    const geo = new THREE.BufferGeometry();
    this.posAttr = new THREE.BufferAttribute(this.pos, 3);
    this.sizeAttr = new THREE.BufferAttribute(new Float32Array(max), 1);
    this.alphaAttr = new THREE.BufferAttribute(new Float32Array(max), 1);
    this.tintAttr = new THREE.BufferAttribute(new Float32Array(max * 3), 3);
    this.posAttr.setUsage(THREE.DynamicDrawUsage);
    this.sizeAttr.setUsage(THREE.DynamicDrawUsage);
    this.alphaAttr.setUsage(THREE.DynamicDrawUsage);
    this.tintAttr.setUsage(THREE.DynamicDrawUsage);
    geo.setAttribute("position", this.posAttr);
    geo.setAttribute("size", this.sizeAttr);
    geo.setAttribute("alpha", this.alphaAttr);
    geo.setAttribute("tint", this.tintAttr);
    this.texture = softDotTexture();
    this.material = new THREE.ShaderMaterial({
      uniforms: { map: { value: this.texture }, pixelScale: { value: 600 } },
      vertexShader: VERT,
      fragmentShader: FRAG,
      transparent: true,
      depthWrite: false,
      depthTest: true,
      blending: additive ? THREE.AdditiveBlending : THREE.NormalBlending,
    });
    this.points = new THREE.Points(geo, this.material);
    this.points.frustumCulled = false;
    this.points.renderOrder = additive ? 20 : 19;
  }

  setPixelScale(focalPx: number, dpr: number): void {
    this.material.uniforms.pixelScale.value = focalPx * dpr;
  }

  spawn(x: number, y: number, z: number, vx: number, vy: number, vz: number, o: SpawnOpts): void {
    const i = this.cursor;
    this.cursor = (this.cursor + 1) % this.max;
    this.pos[i * 3] = x;
    this.pos[i * 3 + 1] = y;
    this.pos[i * 3 + 2] = z;
    this.vel[i * 3] = vx;
    this.vel[i * 3 + 1] = vy;
    this.vel[i * 3 + 2] = vz;
    this.life[i] = o.life;
    this.maxLife[i] = o.life;
    this.size0[i] = o.size;
    this.grow[i] = o.grow ?? 1;
    this.drag[i] = o.drag ?? 0;
    this.grav[i] = o.gravity ?? 0;
    this.alpha0[i] = o.alpha ?? 1;
    const tint = this.tintAttr.array as Float32Array;
    tint[i * 3] = o.r;
    tint[i * 3 + 1] = o.g;
    tint[i * 3 + 2] = o.b;
  }

  update(dt: number): void {
    const size = this.sizeAttr.array as Float32Array;
    const alpha = this.alphaAttr.array as Float32Array;
    for (let i = 0; i < this.max; i++) {
      if (this.life[i] <= 0) {
        size[i] = 0;
        continue;
      }
      this.life[i] -= dt;
      if (this.life[i] <= 0) {
        size[i] = 0;
        continue;
      }
      const t = 1 - this.life[i] / this.maxLife[i];
      const d = this.drag[i] ? Math.exp(-this.drag[i] * dt) : 1;
      this.vel[i * 3] *= d;
      this.vel[i * 3 + 1] = this.vel[i * 3 + 1] * d - this.grav[i] * dt;
      this.vel[i * 3 + 2] *= d;
      this.pos[i * 3] += this.vel[i * 3] * dt;
      this.pos[i * 3 + 1] += this.vel[i * 3 + 1] * dt;
      this.pos[i * 3 + 2] += this.vel[i * 3 + 2] * dt;
      size[i] = this.size0[i] * (1 + (this.grow[i] - 1) * t);
      alpha[i] = this.alpha0[i] * (1 - t) * (1 - t * 0.3);
    }
    this.posAttr.needsUpdate = true;
    this.sizeAttr.needsUpdate = true;
    this.alphaAttr.needsUpdate = true;
    this.tintAttr.needsUpdate = true;
  }

  dispose(): void {
    this.points.geometry.dispose();
    this.material.dispose();
    this.texture.dispose();
  }
}

/* --------------------------------------------------------------- debris */

export class DebrisPool {
  readonly group = new THREE.Group();
  private readonly meshes: THREE.Mesh[] = [];
  private readonly vel: THREE.Vector3[] = [];
  private readonly spin: THREE.Vector3[] = [];
  private readonly life: Float32Array;
  private readonly floorY: Float32Array;
  private cursor = 0;
  private readonly geo: THREE.BoxGeometry;
  private readonly mat: THREE.MeshStandardMaterial;

  constructor(max = 36) {
    this.geo = new THREE.BoxGeometry(1, 0.6, 1.4);
    this.mat = new THREE.MeshStandardMaterial({ color: 0x3a3d38, roughness: 0.7, metalness: 0.6, emissive: 0xff5a1f, emissiveIntensity: 0 });
    this.life = new Float32Array(max);
    this.floorY = new Float32Array(max);
    for (let i = 0; i < max; i++) {
      const m = new THREE.Mesh(this.geo, this.mat);
      m.visible = false;
      m.castShadow = true;
      this.group.add(m);
      this.meshes.push(m);
      this.vel.push(new THREE.Vector3());
      this.spin.push(new THREE.Vector3());
    }
  }

  burst(x: number, y: number, z: number, count: number, scale: number, floorY: number): void {
    for (let n = 0; n < count; n++) {
      const i = this.cursor;
      this.cursor = (this.cursor + 1) % this.meshes.length;
      const m = this.meshes[i];
      m.visible = true;
      m.position.set(x + (Math.random() - 0.5) * scale, y + (Math.random() - 0.5) * scale, z + (Math.random() - 0.5) * scale);
      m.scale.setScalar(scale * (0.6 + Math.random() * 1.2));
      m.rotation.set(Math.random() * 6, Math.random() * 6, Math.random() * 6);
      this.vel[i].set((Math.random() - 0.5) * 26, 12 + Math.random() * 22, (Math.random() - 0.5) * 26);
      this.spin[i].set((Math.random() - 0.5) * 8, (Math.random() - 0.5) * 8, (Math.random() - 0.5) * 8);
      this.life[i] = 4 + Math.random() * 2;
      this.floorY[i] = floorY;
    }
  }

  update(dt: number): void {
    for (let i = 0; i < this.meshes.length; i++) {
      if (this.life[i] <= 0) continue;
      this.life[i] -= dt;
      const m = this.meshes[i];
      if (this.life[i] <= 0) {
        m.visible = false;
        continue;
      }
      const v = this.vel[i];
      v.y -= 16 * dt; // lunar-ish but snappy enough to read
      m.position.addScaledVector(v, dt);
      const floor = this.floorY[i] + m.scale.y * 0.3;
      if (m.position.y < floor) {
        m.position.y = floor;
        v.y *= -0.25;
        v.x *= 0.6;
        v.z *= 0.6;
        this.spin[i].multiplyScalar(0.5);
      }
      m.rotation.x += this.spin[i].x * dt;
      m.rotation.y += this.spin[i].y * dt;
      m.rotation.z += this.spin[i].z * dt;
    }
  }

  dispose(): void {
    this.geo.dispose();
    this.mat.dispose();
  }
}

/* ------------------------------------------------------------- fireballs */

export class FireballPool {
  readonly group = new THREE.Group();
  private readonly meshes: THREE.Mesh[] = [];
  private readonly mats: THREE.MeshBasicMaterial[] = [];
  private readonly life: Float32Array;
  private readonly maxLife: Float32Array;
  private readonly size: Float32Array;
  private cursor = 0;
  private readonly geo: THREE.SphereGeometry;

  constructor(max = 8) {
    this.geo = new THREE.SphereGeometry(1, 18, 12);
    this.life = new Float32Array(max);
    this.maxLife = new Float32Array(max);
    this.size = new Float32Array(max);
    for (let i = 0; i < max; i++) {
      const mat = new THREE.MeshBasicMaterial({ color: 0xffa040, transparent: true, opacity: 0, depthWrite: false, blending: THREE.AdditiveBlending });
      const m = new THREE.Mesh(this.geo, mat);
      m.visible = false;
      m.renderOrder = 21;
      this.group.add(m);
      this.meshes.push(m);
      this.mats.push(mat);
    }
  }

  spawn(x: number, y: number, z: number, size: number, life = 0.55, color = 0xffa040): void {
    const i = this.cursor;
    this.cursor = (this.cursor + 1) % this.meshes.length;
    const m = this.meshes[i];
    m.visible = true;
    m.position.set(x, y, z);
    m.scale.setScalar(size * 0.2);
    this.mats[i].color.setHex(color);
    this.mats[i].opacity = 1;
    this.life[i] = life;
    this.maxLife[i] = life;
    this.size[i] = size;
  }

  update(dt: number): void {
    for (let i = 0; i < this.meshes.length; i++) {
      if (this.life[i] <= 0) continue;
      this.life[i] -= dt;
      const m = this.meshes[i];
      if (this.life[i] <= 0) {
        m.visible = false;
        continue;
      }
      const t = 1 - this.life[i] / this.maxLife[i];
      const s = this.size[i] * (0.25 + 0.75 * (1 - Math.pow(1 - t, 3)));
      m.scale.setScalar(s);
      this.mats[i].opacity = (1 - t) * (1 - t) * 0.9;
    }
  }

  dispose(): void {
    this.geo.dispose();
    for (const m of this.mats) m.dispose();
  }
}
