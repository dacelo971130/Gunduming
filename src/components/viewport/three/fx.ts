/**
 * Weapon and damage FX. Pooled projectiles (rifle tracers, cannon shells,
 * missiles on bezier arcs), the charged beam, blade slash, incoming enemy
 * fire, hit sparks, explosions with debris + scorch marks, and wreck smoke.
 * Everything is pre-allocated; per-frame work only touches scratch vectors.
 */
import * as THREE from "three";
import type { WeaponId } from "@/game/types";
import { DebrisPool, FireballPool, ParticlePool } from "./particles";
import { clamp, terrainHeight } from "./math";

type ProjKind = "TRACER" | "SHELL" | "MISSILE" | "INCOMING" | "STREAK" | "LOB";

interface FirePool {
  mesh: THREE.Mesh;
  life: number;
  scale: number;
}

interface Projectile {
  active: boolean;
  kind: ProjKind;
  mesh: THREE.Mesh;
  start: THREE.Vector3;
  ctrl: THREE.Vector3;
  end: THREE.Vector3;
  t: number;
  duration: number;
  targetId: string | null;
  onArrive: (() => void) | null;
  smoke: number;
}

interface Scorch {
  mesh: THREE.Mesh;
  life: number;
}

const _a = new THREE.Vector3();
const _b = new THREE.Vector3();
const _c = new THREE.Vector3();

export class FxSystem {
  readonly group = new THREE.Group();
  readonly sparks: ParticlePool;
  readonly smoke: ParticlePool;
  readonly debris: DebrisPool;
  readonly fireballs: FireballPool;
  private readonly projectiles: Projectile[] = [];
  private readonly scorches: Scorch[] = [];
  private scorchCursor = 0;
  private readonly flash: THREE.PointLight;
  private flashLife = 0;
  private readonly muzzleFlash: THREE.Mesh;
  private muzzleLife = 0;
  private readonly muzzleLight: THREE.PointLight;

  /* beam */
  private readonly beamCore: THREE.Mesh;
  private readonly beamGlow: THREE.Mesh;
  private beamT = -1;
  private readonly beamFrom = new THREE.Vector3();
  private readonly beamTo = new THREE.Vector3();

  /* slash */
  private readonly slashArc: THREE.Mesh;
  private slashT = -1;
  private readonly slashHit: THREE.Mesh;
  private slashHitT = -1;

  /* fire pools (incendiary) */
  private readonly firePools: FirePool[] = [];
  private firePoolCursor = 0;

  /* nuke */
  private nukeT = -1;
  private readonly nukePos = new THREE.Vector3();
  private nukeFloor = 0;
  private readonly shockRing: THREE.Mesh;
  /** 0..1 sky/glass overexposure the scene reads each frame. */
  nukeGlow = 0;

  private readonly disposables: Array<{ dispose(): void }> = [];

  constructor(scene: THREE.Scene, private readonly camera: THREE.Camera) {
    scene.add(this.group);
    this.sparks = new ParticlePool(1400, true);
    this.smoke = new ParticlePool(1100, false);
    this.debris = new DebrisPool(36);
    this.fireballs = new FireballPool(8);
    this.group.add(this.sparks.points, this.smoke.points, this.debris.group, this.fireballs.group);

    // Projectile meshes.
    const tracerGeo = new THREE.CylinderGeometry(0.12, 0.2, 7, 6);
    tracerGeo.rotateX(Math.PI / 2);
    const tracerMat = new THREE.MeshBasicMaterial({ color: 0xbfe9ff, transparent: true, opacity: 0.95, blending: THREE.AdditiveBlending, depthWrite: false });
    const shellGeo = new THREE.SphereGeometry(0.55, 10, 8);
    const shellMat = new THREE.MeshBasicMaterial({ color: 0xffc070, transparent: true, opacity: 1, blending: THREE.AdditiveBlending, depthWrite: false });
    const missileGeo = new THREE.CylinderGeometry(0.16, 0.22, 1.6, 6);
    missileGeo.rotateX(Math.PI / 2);
    const missileMat = new THREE.MeshStandardMaterial({ color: 0xd8d8d0, roughness: 0.5, metalness: 0.4, emissive: 0xff8030, emissiveIntensity: 1.5 });
    const incomingMat = new THREE.MeshBasicMaterial({ color: 0xff9a6a, transparent: true, opacity: 0.95, blending: THREE.AdditiveBlending, depthWrite: false });
    this.disposables.push(tracerGeo, tracerMat, shellGeo, shellMat, missileGeo, missileMat, incomingMat);
    const make = (kind: ProjKind, geo: THREE.BufferGeometry, mat: THREE.Material, n: number) => {
      for (let i = 0; i < n; i++) {
        const mesh = new THREE.Mesh(geo, mat);
        mesh.visible = false;
        mesh.renderOrder = 21;
        this.group.add(mesh);
        this.projectiles.push({
          active: false, kind, mesh, start: new THREE.Vector3(), ctrl: new THREE.Vector3(), end: new THREE.Vector3(),
          t: 0, duration: 1, targetId: null, onArrive: null, smoke: 0,
        });
      }
    };
    make("TRACER", tracerGeo, tracerMat, 10);
    make("SHELL", shellGeo, shellMat, 4);
    make("MISSILE", missileGeo, missileMat, 12);
    make("INCOMING", tracerGeo, incomingMat, 8);
    const lobGeo = new THREE.SphereGeometry(0.4, 12, 8);
    const lobMat = new THREE.MeshBasicMaterial({ color: 0xff8a3a, transparent: true, opacity: 1, blending: THREE.AdditiveBlending, depthWrite: false });
    const streakGeo = new THREE.CylinderGeometry(0.5, 1.4, 90, 8);
    streakGeo.rotateX(Math.PI / 2);
    const streakMat = new THREE.MeshBasicMaterial({ color: 0xdff2ff, transparent: true, opacity: 0.9, blending: THREE.AdditiveBlending, depthWrite: false });
    this.disposables.push(lobGeo, lobMat, streakGeo, streakMat);
    make("LOB", lobGeo, lobMat, 6);
    make("STREAK", streakGeo, streakMat, 4);

    // Fire pools: flat additive discs that flicker on the ground.
    const poolGeo = new THREE.CircleGeometry(1, 32);
    poolGeo.rotateX(-Math.PI / 2);
    this.disposables.push(poolGeo);
    for (let i = 0; i < 8; i++) {
      const mat = new THREE.MeshBasicMaterial({ color: 0xff7a20, transparent: true, opacity: 0, blending: THREE.AdditiveBlending, depthWrite: false });
      const mesh = new THREE.Mesh(poolGeo, mat);
      mesh.visible = false;
      mesh.renderOrder = 19;
      this.group.add(mesh);
      this.firePools.push({ mesh, life: 0, scale: 1 });
      this.disposables.push(mat);
    }

    // Nuke ground shockwave ring.
    const ringGeo = new THREE.RingGeometry(0.9, 1, 96, 1);
    ringGeo.rotateX(-Math.PI / 2);
    const ringMat = new THREE.MeshBasicMaterial({ color: 0xffe0b0, transparent: true, opacity: 0, blending: THREE.AdditiveBlending, depthWrite: false, side: THREE.DoubleSide });
    this.shockRing = new THREE.Mesh(ringGeo, ringMat);
    this.shockRing.visible = false;
    this.shockRing.renderOrder = 20;
    this.group.add(this.shockRing);
    this.disposables.push(ringGeo, ringMat);

    // Lights: one reusable impact flash, one muzzle light.
    this.flash = new THREE.PointLight(0xffb070, 0, 120, 2);
    this.muzzleLight = new THREE.PointLight(0xcfe8ff, 0, 40, 2);
    this.group.add(this.flash, this.muzzleLight);
    const mfGeo = new THREE.SphereGeometry(1, 10, 8);
    const mfMat = new THREE.MeshBasicMaterial({ color: 0xe8f4ff, transparent: true, opacity: 0.9, blending: THREE.AdditiveBlending, depthWrite: false });
    this.muzzleFlash = new THREE.Mesh(mfGeo, mfMat);
    this.muzzleFlash.visible = false;
    this.muzzleFlash.renderOrder = 22;
    this.group.add(this.muzzleFlash);
    this.disposables.push(mfGeo, mfMat);

    // Charged beam.
    const beamGeo = new THREE.CylinderGeometry(1, 1, 1, 12, 1, true);
    beamGeo.translate(0, 0.5, 0);
    beamGeo.rotateX(Math.PI / 2); // along +z, from 0 to 1
    const coreMat = new THREE.MeshBasicMaterial({ color: 0xf4fbff, transparent: true, opacity: 0.95, blending: THREE.AdditiveBlending, depthWrite: false });
    const glowMat = new THREE.MeshBasicMaterial({ color: 0x5fd0ff, transparent: true, opacity: 0.45, blending: THREE.AdditiveBlending, depthWrite: false, side: THREE.DoubleSide });
    this.beamCore = new THREE.Mesh(beamGeo, coreMat);
    this.beamGlow = new THREE.Mesh(beamGeo, glowMat);
    this.beamCore.visible = false;
    this.beamGlow.visible = false;
    this.beamCore.renderOrder = 23;
    this.beamGlow.renderOrder = 23;
    this.group.add(this.beamCore, this.beamGlow);
    this.disposables.push(beamGeo, coreMat, glowMat);

    // Blade slash arc (camera-parented ring segment) + far hit flash.
    const arcGeo = new THREE.RingGeometry(3.2, 4.6, 40, 1, 0, Math.PI * 0.62);
    const arcMat = new THREE.MeshBasicMaterial({ color: 0x9fe6ff, transparent: true, opacity: 0, blending: THREE.AdditiveBlending, depthWrite: false, side: THREE.DoubleSide });
    this.slashArc = new THREE.Mesh(arcGeo, arcMat);
    this.slashArc.position.set(0.6, -1.2, -9);
    this.slashArc.visible = false;
    this.slashArc.renderOrder = 24;
    camera.add(this.slashArc);
    const hitGeo = new THREE.PlaneGeometry(1, 1);
    const hitMat = new THREE.MeshBasicMaterial({ color: 0xbff3ff, transparent: true, opacity: 0, blending: THREE.AdditiveBlending, depthWrite: false, side: THREE.DoubleSide });
    this.slashHit = new THREE.Mesh(hitGeo, hitMat);
    this.slashHit.visible = false;
    this.slashHit.renderOrder = 24;
    this.group.add(this.slashHit);
    this.disposables.push(arcGeo, arcMat, hitGeo, hitMat);

    // Scorch decals.
    const scorchGeo = new THREE.CircleGeometry(1, 20);
    scorchGeo.rotateX(-Math.PI / 2);
    this.disposables.push(scorchGeo);
    for (let i = 0; i < 10; i++) {
      const mat = new THREE.MeshStandardMaterial({ color: 0x0a0a0a, roughness: 1, transparent: true, opacity: 0, polygonOffset: true, polygonOffsetFactor: -2, polygonOffsetUnits: -2, depthWrite: false });
      const mesh = new THREE.Mesh(scorchGeo, mat);
      mesh.visible = false;
      mesh.receiveShadow = true;
      this.group.add(mesh);
      this.scorches.push({ mesh, life: 0 });
      this.disposables.push(mat);
    }
  }

  setPixelScale(focalPx: number, dpr: number): void {
    this.sparks.setPixelScale(focalPx, dpr);
    this.smoke.setPixelScale(focalPx, dpr);
  }

  /* ------------------------------------------------------- projectiles */

  private take(kind: ProjKind): Projectile | null {
    let oldest: Projectile | null = null;
    for (const p of this.projectiles) {
      if (p.kind !== kind) continue;
      if (!p.active) return p;
      if (!oldest || p.t / p.duration > oldest.t / oldest.duration) oldest = p;
    }
    return oldest;
  }

  private launch(kind: ProjKind, from: THREE.Vector3, to: THREE.Vector3, speed: number, targetId: string | null, onArrive: (() => void) | null, curve = 0, lob = 0): number {
    const p = this.take(kind);
    if (!p) return 0;
    p.active = true;
    p.start.copy(from);
    p.end.copy(to);
    p.t = 0;
    p.targetId = targetId;
    p.onArrive = onArrive;
    const dist = from.distanceTo(to);
    p.duration = Math.max(0.08, dist / speed);
    // Control point: offset sideways/up for curved missile paths.
    p.ctrl.lerpVectors(from, to, 0.45);
    if (curve) {
      _a.subVectors(to, from).normalize();
      _b.set(-_a.z, 0, _a.x); // perpendicular on the ground plane
      p.ctrl.addScaledVector(_b, (Math.random() - 0.5) * 2 * curve).add(_c.set(0, curve * (0.5 + Math.random() * 0.8), 0));
    }
    if (lob) p.ctrl.y += lob;
    p.mesh.visible = true;
    p.mesh.position.copy(from);
    p.mesh.lookAt(to);
    return p.duration;
  }

  /** Returns the flight time so callers can delay hit visuals until arrival. */
  fire(weapon: WeaponId, from: THREE.Vector3, targets: Array<{ id: string; pos: THREE.Vector3 }>, fallback: THREE.Vector3): number {
    this.muzzle(from, weapon === "CANNON" ? 0.7 : weapon === "MISSILE" ? 0.3 : 0.32, weapon === "CANNON" ? 0xffc890 : 0xd8ecff);
    const aim = targets[0]?.pos ?? fallback;
    switch (weapon) {
      case "RIFLE": {
        _a.copy(aim).add(_b.set((Math.random() - 0.5) * 1.5, (Math.random() - 0.5) * 1.5, 0));
        const dur = this.launch("TRACER", from, _a, 620, targets[0]?.id ?? null, null);
        // a second round a hair later reads as a burst
        _c.copy(from).add(_b.set(0.2, -0.1, 0.5));
        this.launch("TRACER", _c, aim, 560, null, null);
        return dur;
      }
      case "CANNON": {
        const p = this.take("SHELL");
        const dur = this.launch("SHELL", from, aim, 300, targets[0]?.id ?? null, null);
        if (p) p.smoke = 1;
        for (let i = 0; i < 26; i++) {
          this.smoke.spawn(from.x, from.y, from.z, (Math.random() - 0.5) * 9, 2 + Math.random() * 6, -6 - Math.random() * 14, { life: 1.2 + Math.random(), size: 1.2 + Math.random() * 1.6, r: 0.36, g: 0.35, b: 0.34, drag: 2.5, grow: 2.4, alpha: 0.35 });
        }
        return dur;
      }
      case "MISSILE": {
        let maxDur = 0;
        for (let i = 0; i < 6; i++) {
          const tgt = targets.length ? targets[i % targets.length] : null;
          _a.copy(tgt ? tgt.pos : fallback).add(_b.set((Math.random() - 0.5) * 6, (Math.random() - 0.5) * 4, (Math.random() - 0.5) * 6));
          _c.copy(from).add(_b.set((i % 3) * 0.6 - 0.6, Math.floor(i / 3) * 0.7, 0));
          const p = this.take("MISSILE");
          const dur = this.launch("MISSILE", _c, _a, 190 + i * 12, tgt?.id ?? null, null, 55);
          if (p) {
            p.smoke = 1;
            p.t = -i * 0.07 * p.duration; // stagger launches
          }
          maxDur = Math.max(maxDur, dur + i * 0.07);
        }
        return maxDur;
      }
      case "INCENDIARY": {
        // Three lobbed shells that spread across the cone and light fire pools where they land.
        let maxDur = 0;
        for (let i = 0; i < 3; i++) {
          const tgt = targets.length ? targets[i % targets.length] : null;
          _a.copy(tgt ? tgt.pos : fallback).add(_b.set((i - 1) * 9 + (Math.random() - 0.5) * 6, 0, (Math.random() - 0.5) * 8));
          _a.y = terrainHeight(_a.x, _a.z) + 0.4;
          const end = _a.clone();
          const p = this.take("LOB");
          const dur = this.launch("LOB", from, _a, 120, tgt?.id ?? null, () => this.ignite(end, 1), 0, 45);
          if (p) {
            p.smoke = 1;
            p.t = -i * 0.12;
          }
          maxDur = Math.max(maxDur, dur + i * 0.12);
        }
        return maxDur;
      }
      case "NUKE":
      case "FLEET_CANNON":
        // Their visuals arrive through fx:nuke / fx:fleetCall — only the launch kick here.
        return 0;
      case "BLADE": {
        this.slashT = 0;
        this.slashArc.visible = true;
        this.slashArc.rotation.z = 0.9;
        if (targets[0]) {
          this.slashHitT = 0;
          this.slashHit.visible = true;
          this.slashHit.position.copy(targets[0].pos);
          this.slashHit.lookAt(this.camera.position);
          this.slashHit.rotation.z = -0.7;
          this.burst(targets[0].pos, 1.4, 0x9fe6ff);
        }
        return 0.18;
      }
      default:
        return 0;
    }
  }

  /** Light a fire pool at `at` (ground). */
  ignite(at: THREE.Vector3, scale: number): void {
    this.burst(at, 0.9 * scale, 0xff9a40);
    const fp = this.firePools[this.firePoolCursor];
    this.firePoolCursor = (this.firePoolCursor + 1) % this.firePools.length;
    fp.mesh.visible = true;
    fp.mesh.position.set(at.x, terrainHeight(at.x, at.z) + 0.3, at.z);
    fp.scale = 9 * scale;
    fp.life = 6.5;
    // scorch under the pool
    const s = this.scorches[this.scorchCursor];
    this.scorchCursor = (this.scorchCursor + 1) % this.scorches.length;
    s.mesh.visible = true;
    s.mesh.position.set(at.x, terrainHeight(at.x, at.z) + 0.2, at.z);
    s.mesh.scale.setScalar(10 * scale);
    s.life = 30;
    (s.mesh.material as THREE.MeshStandardMaterial).opacity = 0.7;
  }

  /** Flames licking up a burning unit. Called every frame while `burningUntil` is in the future. */
  burn(at: THREE.Vector3, dt: number, scale: number): void {
    const n = Math.min(6, Math.round(dt * 90));
    for (let i = 0; i < n; i++) {
      const ox = (Math.random() - 0.5) * 5 * scale;
      const oy = (Math.random() - 0.7) * 8 * scale;
      const oz = (Math.random() - 0.5) * 4 * scale;
      this.sparks.spawn(at.x + ox, at.y + oy, at.z + oz, (Math.random() - 0.5) * 3, 6 + Math.random() * 8, (Math.random() - 0.5) * 3, { life: 0.35 + Math.random() * 0.35, size: (1.6 + Math.random() * 2.2) * scale, r: 1, g: 0.45 + Math.random() * 0.35, b: 0.12, drag: 1.5, grow: 0.4, alpha: 0.9 });
    }
    if (Math.random() < dt * 18) {
      this.smoke.spawn(at.x, at.y + 4 * scale, at.z, (Math.random() - 0.5) * 2, 7 + Math.random() * 5, (Math.random() - 0.5) * 2, { life: 2.2 + Math.random() * 1.5, size: (2 + Math.random() * 2) * scale, r: 0.1, g: 0.1, b: 0.1, drag: 0.6, grow: 2.6, alpha: 0.5 });
    }
  }

  /* -------------------------------------------------------------- nuke */

  nuke(at: THREE.Vector3): void {
    this.nukePos.copy(at);
    this.nukeFloor = terrainHeight(at.x, at.z);
    this.nukePos.y = this.nukeFloor;
    this.nukeT = 0;
    this.nukeGlow = 1;
    this.fireballs.spawn(at.x, this.nukeFloor + 12, at.z, 60, 2.6, 0xfff2d0);
    this.fireballs.spawn(at.x, this.nukeFloor + 6, at.z, 40, 1.8, 0xffb060);
    this.pulseFlash(at, 40000, 0xfff0e0);
    this.shockRing.visible = true;
    this.shockRing.position.set(at.x, this.nukeFloor + 1, at.z);
    this.shockRing.scale.setScalar(1);
    (this.shockRing.material as THREE.MeshBasicMaterial).opacity = 0.9;
    this.debris.burst(at.x, this.nukeFloor + 6, at.z, 30, 2.2, this.nukeFloor);
    // scorch: a huge crater floor
    const s = this.scorches[this.scorchCursor];
    this.scorchCursor = (this.scorchCursor + 1) % this.scorches.length;
    s.mesh.visible = true;
    s.mesh.position.set(at.x, this.nukeFloor + 0.3, at.z);
    s.mesh.scale.setScalar(70);
    s.life = 120;
    (s.mesh.material as THREE.MeshStandardMaterial).opacity = 0.9;
  }

  private updateNuke(dt: number): void {
    if (this.nukeT < 0) return;
    this.nukeT += dt;
    const t = this.nukeT;
    const at = this.nukePos;
    // glass overexposure: full for 0.3 s, fading over 2 s
    this.nukeGlow = t < 0.3 ? 1 : clamp(1 - (t - 0.3) / 2, 0, 1);
    // rising stem + mushroom cap for ~3 s
    if (t < 3.2) {
      const rise = t * 28;
      if (Math.random() < dt * 12) this.fireballs.spawn(at.x + (Math.random() - 0.5) * 10, at.y + rise * 0.6 + 8, at.z + (Math.random() - 0.5) * 10, 18 + t * 4, 1.2, t < 1 ? 0xffc080 : 0xff7a30);
      const n = Math.min(14, Math.round(dt * 260));
      for (let i = 0; i < n; i++) {
        const cap = Math.random() < 0.6;
        const ang = Math.random() * Math.PI * 2;
        const rad = cap ? 10 + t * 14 * Math.random() : Math.random() * 7;
        const y = cap ? at.y + rise + 14 + Math.random() * 10 : at.y + Math.random() * rise;
        this.smoke.spawn(at.x + Math.cos(ang) * rad, y, at.z + Math.sin(ang) * rad, Math.cos(ang) * (cap ? 8 : 1), cap ? 6 + Math.random() * 6 : 14 + Math.random() * 10, Math.sin(ang) * (cap ? 8 : 1), { life: 5 + Math.random() * 4, size: 12 + Math.random() * 14, r: 0.28 + (t < 1 ? 0.3 : 0), g: 0.22 + (t < 1 ? 0.12 : 0), b: 0.18, drag: 0.5, grow: 2.2, alpha: 0.8 });
      }
      for (let i = 0; i < 4; i++) {
        this.sparks.spawn(at.x + (Math.random() - 0.5) * 20, at.y + Math.random() * rise, at.z + (Math.random() - 0.5) * 20, (Math.random() - 0.5) * 10, 10 + Math.random() * 20, (Math.random() - 0.5) * 10, { life: 0.8 + Math.random(), size: 2 + Math.random() * 3, r: 1, g: 0.5, b: 0.15, gravity: 10, alpha: 1 });
      }
    }
    // ground shockwave sweeping outward (toward the camera) with a dust wall on the ring
    if (t < 3.5) {
      const radius = 4 + t * 110;
      this.shockRing.scale.setScalar(radius);
      (this.shockRing.material as THREE.MeshBasicMaterial).opacity = 0.9 * (1 - t / 3.5);
      const n = Math.min(10, Math.round(dt * 160));
      for (let i = 0; i < n; i++) {
        const ang = Math.random() * Math.PI * 2;
        const x = at.x + Math.cos(ang) * radius;
        const z = at.z + Math.sin(ang) * radius;
        this.smoke.spawn(x, terrainHeight(x, z) + 1, z, Math.cos(ang) * 30, 6 + Math.random() * 10, Math.sin(ang) * 30, { life: 2.5 + Math.random() * 2, size: 8 + Math.random() * 8, r: 0.5, g: 0.46, b: 0.42, drag: 1.2, grow: 2.5, alpha: 0.55 });
      }
    } else {
      this.shockRing.visible = false;
    }
    if (t > 6) this.nukeT = -1;
  }

  /* ------------------------------------------------------------- fleet */

  /**
   * Three orbital shells arriving from high above/behind the camera; each lands
   * around `at` after ~1 s. Returns flight time so kills can be delayed to match.
   */
  fleetStreaks(at: THREE.Vector3): number {
    const cam = this.camera.position;
    let maxDur = 0;
    for (let i = 0; i < 3; i++) {
      _a.copy(at).add(_b.set((i - 1) * 22 + (Math.random() - 0.5) * 10, 0, (Math.random() - 0.5) * 16));
      _a.y = terrainHeight(_a.x, _a.z);
      const end = _a.clone();
      _c.set(cam.x + (i - 1) * 60, cam.y + 900, cam.z + 500);
      const p = this.take("STREAK");
      const dur = this.launch("STREAK", _c, _a, 1000, null, () => this.fleetImpact(end), 0, 0);
      if (p) p.t = -i * 0.15;
      maxDur = Math.max(maxDur, dur + i * 0.15);
    }
    return maxDur;
  }

  private fleetImpact(at: THREE.Vector3): void {
    this.fireballs.spawn(at.x, at.y + 6, at.z, 22, 0.9, 0xfff0d0);
    this.explode(at, 1.9, at.y);
    // tall dust column
    for (let i = 0; i < 70; i++) {
      this.smoke.spawn(at.x + (Math.random() - 0.5) * 8, at.y + Math.random() * 6, at.z + (Math.random() - 0.5) * 8, (Math.random() - 0.5) * 6, 18 + Math.random() * 26, (Math.random() - 0.5) * 6, { life: 3.5 + Math.random() * 2.5, size: 6 + Math.random() * 8, r: 0.5, g: 0.47, b: 0.43, drag: 0.9, grow: 2.8, alpha: 0.7 });
    }
  }

  /** Enemy shot toward the pilot: muzzle flash at the unit + a tracer that passes the canopy. */
  incoming(from: THREE.Vector3): void {
    const cam = this.camera.position;
    _a.set(cam.x + (Math.random() - 0.5) * 6, cam.y - 1 + (Math.random() - 0.5) * 3, cam.z + 6);
    this.launch("INCOMING", from, _a, 520, null, null);
    for (let i = 0; i < 10; i++) {
      this.sparks.spawn(from.x, from.y, from.z, (Math.random() - 0.5) * 12, (Math.random() - 0.5) * 12, (Math.random() - 0.5) * 12, { life: 0.12 + Math.random() * 0.1, size: 3 + Math.random() * 3, r: 1, g: 0.75, b: 0.45, alpha: 0.9 });
    }
  }

  private muzzle(at: THREE.Vector3, size: number, color: number): void {
    this.muzzleFlash.visible = true;
    this.muzzleFlash.position.copy(at);
    this.muzzleFlash.scale.setScalar(size);
    (this.muzzleFlash.material as THREE.MeshBasicMaterial).color.setHex(color);
    this.muzzleLife = 1;
    this.muzzleLight.position.copy(at);
    this.muzzleLight.color.setHex(color);
    this.muzzleLight.intensity = 14 * size;
    for (let i = 0; i < 14; i++) {
      this.sparks.spawn(at.x, at.y, at.z, (Math.random() - 0.5) * 16, (Math.random() - 0.5) * 16, -10 - Math.random() * 30, { life: 0.1 + Math.random() * 0.12, size: 2 + Math.random() * 3, r: 1, g: 0.9, b: 0.7, alpha: 1 });
    }
  }

  /* -------------------------------------------------------------- hits */

  burst(at: THREE.Vector3, scale: number, color = 0xffd9a0): void {
    const c = new THREE.Color(color);
    for (let i = 0; i < 40; i++) {
      this.sparks.spawn(at.x, at.y, at.z, (Math.random() - 0.5) * 40 * scale, (Math.random() - 0.2) * 40 * scale, (Math.random() - 0.5) * 40 * scale, { life: 0.25 + Math.random() * 0.45, size: (1.2 + Math.random() * 1.6) * scale, r: c.r, g: c.g, b: c.b, drag: 2, gravity: 20, alpha: 1 });
    }
    for (let i = 0; i < 10; i++) {
      this.smoke.spawn(at.x, at.y, at.z, (Math.random() - 0.5) * 8, 3 + Math.random() * 5, (Math.random() - 0.5) * 8, { life: 0.8 + Math.random() * 0.8, size: 2 + Math.random() * 3 * scale, r: 0.2, g: 0.19, b: 0.18, drag: 1.5, grow: 2.5, alpha: 0.5 });
    }
    this.fireballs.spawn(at.x, at.y, at.z, 2.2 * scale, 0.3, 0xffc890);
    this.pulseFlash(at, 220 * scale, 0xffc080);
  }

  explode(at: THREE.Vector3, scale: number, floorY: number): void {
    this.fireballs.spawn(at.x, at.y, at.z, 9 * scale, 0.7, 0xffa040);
    this.fireballs.spawn(at.x + 2 * scale, at.y + 3 * scale, at.z, 5 * scale, 0.55, 0xfff0c0);
    for (let i = 0; i < 160; i++) {
      const sp = 20 + Math.random() * 45;
      const th = Math.random() * Math.PI * 2;
      const ph = Math.random() * Math.PI;
      this.sparks.spawn(at.x, at.y, at.z, Math.sin(ph) * Math.cos(th) * sp * scale, Math.abs(Math.cos(ph)) * sp * scale + 8, Math.sin(ph) * Math.sin(th) * sp * scale, { life: 0.5 + Math.random() * 1.2, size: (1.5 + Math.random() * 2.5) * scale, r: 1, g: 0.55 + Math.random() * 0.3, b: 0.2, drag: 1.4, gravity: 22, alpha: 1 });
    }
    for (let i = 0; i < 90; i++) {
      this.smoke.spawn(at.x + (Math.random() - 0.5) * 4, at.y + (Math.random() - 0.5) * 4, at.z + (Math.random() - 0.5) * 4, (Math.random() - 0.5) * 14, 6 + Math.random() * 16, (Math.random() - 0.5) * 14, { life: 2.5 + Math.random() * 3, size: (4 + Math.random() * 6) * scale, r: 0.16, g: 0.15, b: 0.14, drag: 1.2, grow: 3.2, alpha: 0.7 });
    }
    this.debris.burst(at.x, at.y, at.z, 14, 1.1 * scale, floorY);
    this.pulseFlash(at, 900 * scale, 0xffa060);
    // scorch on the ground below
    const s = this.scorches[this.scorchCursor];
    this.scorchCursor = (this.scorchCursor + 1) % this.scorches.length;
    s.mesh.visible = true;
    s.mesh.position.set(at.x, terrainHeight(at.x, at.z) + 0.25, at.z);
    s.mesh.scale.setScalar(9 * scale);
    s.mesh.rotation.y = Math.random() * 6;
    s.life = 40;
    (s.mesh.material as THREE.MeshStandardMaterial).opacity = 0.85;
  }

  /** Continuous smoke from a wreck. Called every frame while the wreck exists. */
  wreckSmoke(at: THREE.Vector3, dt: number, scale: number): void {
    if (Math.random() < dt * 30) {
      this.smoke.spawn(at.x + (Math.random() - 0.5) * 3 * scale, at.y, at.z + (Math.random() - 0.5) * 3 * scale, (Math.random() - 0.5) * 3, 6 + Math.random() * 6, (Math.random() - 0.5) * 3, { life: 2.5 + Math.random() * 2, size: (3 + Math.random() * 3) * scale, r: 0.12, g: 0.12, b: 0.12, drag: 0.8, grow: 3, alpha: 0.55 });
    }
    if (Math.random() < dt * 8) {
      this.sparks.spawn(at.x, at.y, at.z, (Math.random() - 0.5) * 6, 4 + Math.random() * 8, (Math.random() - 0.5) * 6, { life: 0.4 + Math.random() * 0.5, size: 1 + Math.random(), r: 1, g: 0.5, b: 0.15, gravity: 15, alpha: 1 });
    }
  }

  private pulseFlash(at: THREE.Vector3, intensity: number, color: number): void {
    this.flash.position.copy(at);
    this.flash.color.setHex(color);
    this.flash.intensity = intensity;
    this.flashLife = 1;
  }

  /* -------------------------------------------------------------- beam */

  beam(from: THREE.Vector3, to: THREE.Vector3): void {
    this.beamFrom.copy(from);
    this.beamTo.copy(to);
    this.beamT = 0;
  }

  /* ------------------------------------------------------------ update */

  update(dt: number): void {
    this.sparks.update(dt);
    this.smoke.update(dt);
    this.debris.update(dt);
    this.fireballs.update(dt);

    if (this.flashLife > 0) {
      this.flashLife = Math.max(0, this.flashLife - dt / 0.35);
      this.flash.intensity *= Math.exp(-dt * 9);
      if (this.flashLife === 0) this.flash.intensity = 0;
    }
    if (this.muzzleLife > 0) {
      this.muzzleLife = Math.max(0, this.muzzleLife - dt / 0.09);
      this.muzzleFlash.visible = this.muzzleLife > 0;
      this.muzzleFlash.scale.multiplyScalar(1 + dt * 3);
      this.muzzleLight.intensity *= Math.exp(-dt * 20);
      if (this.muzzleLife === 0) this.muzzleLight.intensity = 0;
    }

    for (const p of this.projectiles) {
      if (!p.active) continue;
      p.t += dt;
      if (p.t < 0) {
        p.mesh.visible = false;
        continue;
      }
      p.mesh.visible = true;
      const k = clamp(p.t / p.duration, 0, 1);
      // quadratic bezier
      const u = 1 - k;
      _a.copy(p.start).multiplyScalar(u * u).addScaledVector(p.ctrl, 2 * u * k).addScaledVector(p.end, k * k);
      _b.copy(p.mesh.position);
      p.mesh.position.copy(_a);
      if (_a.distanceToSquared(_b) > 1e-6) p.mesh.lookAt(_c.copy(_a).add(_a.clone().sub(_b)));
      if (p.smoke > 0) {
        const n = p.kind === "MISSILE" ? 2 : 1;
        for (let i = 0; i < n; i++) {
          this.smoke.spawn(_a.x, _a.y, _a.z, (Math.random() - 0.5) * 2, 0.5 + Math.random(), (Math.random() - 0.5) * 2, { life: 1.0 + Math.random() * 0.6, size: p.kind === "MISSILE" ? 0.9 : 1.4, r: 0.32, g: 0.32, b: 0.33, grow: 2.2, alpha: 0.28 });
        }
        if (p.kind === "MISSILE") this.sparks.spawn(_a.x, _a.y, _a.z, 0, 0, 0, { life: 0.08, size: 2.4, r: 1, g: 0.6, b: 0.3, alpha: 1 });
      }
      if (p.kind === "STREAK") {
        // streaks brighten as they come in; a trail of hot air behind
        if (Math.random() < dt * 40) this.sparks.spawn(_a.x, _a.y, _a.z, 0, 0, 0, { life: 0.25, size: 6, r: 0.8, g: 0.9, b: 1, alpha: 0.8, grow: 2 });
      }
      if (k >= 1) {
        p.active = false;
        p.mesh.visible = false;
        p.smoke = 0;
        if (p.kind === "MISSILE") this.burst(p.end, 0.9, 0xffc080);
        if (p.kind === "SHELL") this.burst(p.end, 1.8, 0xffd0a0);
        if (p.onArrive) p.onArrive();
      }
    }

    for (const fp of this.firePools) {
      if (fp.life <= 0) continue;
      fp.life -= dt;
      if (fp.life <= 0) {
        fp.mesh.visible = false;
        continue;
      }
      const fade = clamp(fp.life / 2, 0, 1);
      const flick = 0.75 + Math.random() * 0.35;
      fp.mesh.scale.setScalar(fp.scale * (0.85 + Math.sin(fp.life * 7) * 0.08) * (0.6 + 0.4 * fade));
      (fp.mesh.material as THREE.MeshBasicMaterial).opacity = 0.55 * fade * flick;
      const at = fp.mesh.position;
      const n = Math.min(5, Math.round(dt * 70 * fade));
      for (let i = 0; i < n; i++) {
        const ang = Math.random() * Math.PI * 2;
        const rad = Math.random() * fp.scale * 0.8;
        this.sparks.spawn(at.x + Math.cos(ang) * rad, at.y + 0.5, at.z + Math.sin(ang) * rad, (Math.random() - 0.5) * 2, 5 + Math.random() * 7, (Math.random() - 0.5) * 2, { life: 0.4 + Math.random() * 0.5, size: 1.5 + Math.random() * 2.5, r: 1, g: 0.5 + Math.random() * 0.3, b: 0.12, drag: 1.2, grow: 0.3, alpha: 0.9 });
      }
      if (Math.random() < dt * 10) this.smoke.spawn(at.x, at.y + 2, at.z, 0, 5, 0, { life: 2.5, size: 4, r: 0.12, g: 0.12, b: 0.12, grow: 2.5, alpha: 0.4 });
    }

    this.updateNuke(dt);

    // Beam: 0.35 s charge, 0.6 s hold, 0.3 s fade.
    if (this.beamT >= 0) {
      this.beamT += dt;
      const t = this.beamT;
      const charge = clamp(t / 0.35, 0, 1);
      const hold = t > 0.35 && t < 0.95;
      const fade = t >= 0.95 ? clamp(1 - (t - 0.95) / 0.3, 0, 1) : 1;
      if (t > 1.25) {
        this.beamT = -1;
        this.beamCore.visible = false;
        this.beamGlow.visible = false;
      } else {
        const len = this.beamFrom.distanceTo(this.beamTo);
        const shown = charge < 1 ? 0 : 1;
        for (const m of [this.beamCore, this.beamGlow]) {
          m.visible = shown === 1;
          m.position.copy(this.beamFrom);
          m.lookAt(this.beamTo);
        }
        const flick = 0.85 + Math.random() * 0.3;
        this.beamCore.scale.set(1.3 * fade * flick, 1.3 * fade * flick, len);
        this.beamGlow.scale.set(3.4 * fade, 3.4 * fade, len);
        (this.beamGlow.material as THREE.MeshBasicMaterial).opacity = 0.45 * fade;
        if (charge < 1) {
          // charge glow at the muzzle
          for (let i = 0; i < 6; i++) {
            this.sparks.spawn(this.beamFrom.x + (Math.random() - 0.5) * 4, this.beamFrom.y + (Math.random() - 0.5) * 4, this.beamFrom.z + (Math.random() - 0.5) * 4, 0, 0, 0, { life: 0.2, size: 2 + charge * 4, r: 0.5, g: 0.85, b: 1, alpha: 0.9 });
          }
        }
        if (hold && Math.random() < dt * 60) {
          this.burst(this.beamTo, 0.6, 0x9fe6ff);
        }
        if (hold) this.pulseFlash(this.beamTo, 500, 0x8fd8ff);
      }
    }

    // Blade slash sweep.
    if (this.slashT >= 0) {
      this.slashT += dt;
      const k = this.slashT / 0.32;
      if (k >= 1) {
        this.slashT = -1;
        this.slashArc.visible = false;
      } else {
        this.slashArc.rotation.z = 0.9 - k * 2.4;
        (this.slashArc.material as THREE.MeshBasicMaterial).opacity = Math.sin(k * Math.PI) * 0.85;
        this.slashArc.scale.setScalar(0.8 + k * 0.5);
      }
    }
    if (this.slashHitT >= 0) {
      this.slashHitT += dt;
      const k = this.slashHitT / 0.28;
      if (k >= 1) {
        this.slashHitT = -1;
        this.slashHit.visible = false;
      } else {
        this.slashHit.scale.set(28 * (0.4 + k), 2.2 * (1 - k * 0.5), 1);
        (this.slashHit.material as THREE.MeshBasicMaterial).opacity = (1 - k) * 0.9;
      }
    }

    for (const s of this.scorches) {
      if (s.life <= 0) continue;
      s.life -= dt;
      if (s.life <= 0) s.mesh.visible = false;
      else if (s.life < 8) (s.mesh.material as THREE.MeshStandardMaterial).opacity = 0.85 * (s.life / 8);
    }
  }

  dispose(): void {
    this.sparks.dispose();
    this.smoke.dispose();
    this.debris.dispose();
    this.fireballs.dispose();
    for (const d of this.disposables) d.dispose();
    this.slashArc.removeFromParent();
    this.group.removeFromParent();
  }
}
