/**
 * Per-enemy view: clones a kind template (geometry shared, materials cloned
 * so each unit can fade in / darken), places it from polar store data and
 * animates it — walk bob, approach lean, shoulder lag, wind-up freeze before
 * a shot, spawn fade / ace descent, and the tipped-over smoking wreck.
 */
import * as THREE from "three";
import type { Enemy, EnemyKind } from "@/game/types";
import { buildAce, buildGrunt, type MechRig } from "./mechs";
import { cloneWithMaterials, disposeTree } from "./parts";
import { DEG, clamp, damp, easeOutCubic, polarToWorld, terrainHeight } from "./math";

/** Visual scale on top of the rig's metre sizes — sells the mass of an 18–25 m machine at compressed range. */
export const ENEMY_SCALE = 1.8;
/** Enemies hold a fixed bearing and pause this long before a shot lands (mirrors enemyAI cooldowns). */
const WINDUP_AFTER_MS = 1900;
const ACE_DESCENT_S = 1.7;

interface Nodes {
  hips: THREE.Group;
  torso: THREE.Group;
  shoulders: THREE.Group;
  head: THREE.Group;
  eye: THREE.Mesh;
  eyeMat: THREE.MeshStandardMaterial;
  legL: THREE.Group;
  legR: THREE.Group;
  kneeL: THREE.Group;
  kneeR: THREE.Group;
  armL: THREE.Group;
  armR: THREE.Group;
  muzzle: THREE.Object3D;
  thrusterMat: THREE.MeshStandardMaterial | null;
  wake: THREE.Mesh[];
}

function findNodes(root: THREE.Object3D): Nodes {
  const byName = (name: string): THREE.Object3D[] => {
    const out: THREE.Object3D[] = [];
    root.traverse((o) => {
      if (o.name === name) out.push(o);
    });
    return out;
  };
  const hips = byName("hip").sort((a, b) => a.position.x - b.position.x);
  const knees = byName("knee");
  const arms = byName("arm").sort((a, b) => a.position.x - b.position.x);
  const eye = byName("eye")[0] as THREE.Mesh;
  const thruster = byName("thruster")[0] as THREE.Mesh | undefined;
  const kneeOf = (hip: THREE.Object3D) => knees.find((k) => k.parent === hip) as THREE.Group;
  return {
    hips: byName("hips")[0] as THREE.Group,
    torso: byName("torso")[0] as THREE.Group,
    shoulders: byName("shoulders")[0] as THREE.Group,
    head: byName("head")[0] as THREE.Group,
    eye,
    eyeMat: eye.material as THREE.MeshStandardMaterial,
    legL: hips[0] as THREE.Group,
    legR: hips[1] as THREE.Group,
    kneeL: kneeOf(hips[0]),
    kneeR: kneeOf(hips[1]),
    armL: arms[0] as THREE.Group,
    armR: arms[1] as THREE.Group,
    muzzle: byName("muzzle")[0],
    thrusterMat: thruster ? (thruster.material as THREE.MeshStandardMaterial) : null,
    wake: byName("wake") as THREE.Mesh[],
  };
}

export class EnemyTemplates {
  readonly grunt: MechRig;
  readonly ace: MechRig;
  constructor() {
    this.grunt = buildGrunt();
    this.ace = buildAce();
  }
  dispose(): void {
    for (const rig of [this.grunt, this.ace]) {
      disposeTree(rig.root, false);
      rig.materials.forEach((m) => m.dispose());
      rig.textures.forEach((t) => t.dispose());
    }
  }
}

const _v = new THREE.Vector3();

export class EnemyView {
  readonly id: string;
  readonly kind: EnemyKind;
  readonly root: THREE.Object3D;
  readonly height: number;
  readonly u: number;
  private readonly n: Nodes;
  private readonly materials: THREE.Material[] = [];
  private readonly fadeMaterials: THREE.Material[];
  private readonly baseEmissive: number;

  readonly pos = new THREE.Vector3();
  private readonly target = new THREE.Vector3();
  private readonly prev = new THREE.Vector3();
  private readonly vel = new THREE.Vector3();
  private first = true;
  private walkPhase = 0;
  private walkAmp = 0;
  private lean = 0;
  private shoulderLag = 0;
  private prevYaw = 0;
  private aim = 0;
  private spawnT = 0;
  private wreckT = -1;
  private wreckAxis = 0;
  private darkened = false;
  private time = Math.random() * 10;
  /** Set by the FX layer to delay the wreck until a projectile arrives. */
  wreckDelay = 0;
  /** True while the unit is telegraphing a shot. */
  winding = false;
  /** Set by FX when the unit's muzzle should flash (incoming shot). */
  recoil = 0;
  /** True while `enemy.burningUntil` is in the future — body glows and flickers. */
  burning = false;
  private readonly bodyMats: THREE.MeshStandardMaterial[] = [];
  private hurlVel: THREE.Vector3 | null = null;
  private readonly hurlSpin = new THREE.Vector3();

  constructor(enemy: Enemy, templates: EnemyTemplates) {
    this.id = enemy.id;
    this.kind = enemy.kind;
    const rig = enemy.kind === "CRIMSON" ? templates.ace : templates.grunt;
    this.height = rig.height;
    this.u = rig.height / 20;
    this.root = cloneWithMaterials(rig.root);
    this.root.scale.setScalar(ENEMY_SCALE);
    this.n = findNodes(this.root);
    this.root.traverse((o) => {
      const mesh = o as THREE.Mesh;
      if (mesh.isMesh) {
        const m = mesh.material;
        if (Array.isArray(m)) this.materials.push(...m);
        else this.materials.push(m);
      }
    });
    this.baseEmissive = this.n.eyeMat.emissiveIntensity;
    const wakeMats = new Set<THREE.Material>(this.n.wake.map((w) => w.material as THREE.Material));
    this.fadeMaterials = this.materials.filter((m) => !wakeMats.has(m));
    this.root.traverse((o) => {
      const mesh = o as THREE.Mesh;
      if (mesh.isMesh && (mesh.name === "armour" || mesh.name === "limb" || mesh.name === "dark")) {
        this.bodyMats.push(mesh.material as THREE.MeshStandardMaterial);
      }
    });
    this.prevYaw = 0;
  }

  /** Where the store says the unit is (render space), including terrain height. */
  private computeTarget(enemy: Enemy, playerBearing: number): void {
    const o = { x: 0, z: 0 };
    polarToWorld(playerBearing + enemy.bearing, enemy.distance, o);
    const ground = terrainHeight(o.x, o.z);
    const hover = this.kind === "CRIMSON" ? 2.2 + Math.sin(this.time * 1.7) * 0.6 : 0;
    this.target.set(o.x, ground + enemy.altitude * 1.8 + hover, o.z);
  }

  update(enemy: Enemy, playerBearing: number, dt: number, now: number, camPos: THREE.Vector3): void {
    this.time += dt;
    const n = this.n;
    const u = this.u;
    this.computeTarget(enemy, playerBearing);

    if (this.first) {
      this.first = false;
      this.pos.copy(this.target);
      this.prev.copy(this.pos);
      if (this.kind === "CRIMSON") this.pos.y += 70;
    }

    /* ---- movement ---- */
    const destroyed = enemy.state === "DESTROYED";
    if (!destroyed) {
      const k = 1 - Math.exp(-dt * 5);
      this.pos.x += (this.target.x - this.pos.x) * k;
      this.pos.z += (this.target.z - this.pos.z) * k;
      // Ace descends from orbit on spawn.
      if (this.kind === "CRIMSON" && this.spawnT < 1) {
        const t = easeOutCubic(this.spawnT);
        this.pos.y = this.target.y + (1 - t) * 70;
      } else {
        this.pos.y += (this.target.y - this.pos.y) * k;
      }
    }
    if (dt > 0) {
      this.vel.subVectors(this.pos, this.prev).multiplyScalar(1 / dt);
      this.prev.copy(this.pos);
    }
    const speed = Math.hypot(this.vel.x, this.vel.z);

    this.root.position.copy(this.pos);

    // Face the pilot (that is who they are fighting), lean into their own motion.
    const yaw = Math.atan2(camPos.x - this.pos.x, camPos.z - this.pos.z);
    if (!destroyed) this.root.rotation.y = yaw;
    let yawRate = yaw - this.prevYaw;
    if (yawRate > Math.PI) yawRate -= Math.PI * 2;
    if (yawRate < -Math.PI) yawRate += Math.PI * 2;
    this.prevYaw = yaw;

    /* ---- wind-up telegraph ---- */
    const attacking = enemy.state === "ATTACK" || enemy.state === "FLANK";
    this.winding = !destroyed && attacking && now - enemy.lastFireAt > WINDUP_AFTER_MS;
    this.aim = damp(this.aim, this.winding ? 1 : 0, this.winding ? 9 : 4, dt);
    this.recoil = Math.max(0, this.recoil - dt * 6);

    /* ---- walk cycle ---- */
    const moving = speed > 0.6 && !this.winding && !destroyed;
    this.walkAmp = damp(this.walkAmp, moving ? clamp(speed / 6, 0.3, 1) : 0, 6, dt);
    if (this.kind === "CRIMSON") {
      // The ace glides; legs trail slightly, no footfalls.
      n.legL.rotation.x = damp(n.legL.rotation.x, 0.18 + this.walkAmp * 0.2, 4, dt);
      n.legR.rotation.x = damp(n.legR.rotation.x, 0.1 + this.walkAmp * 0.15, 4, dt);
      n.kneeL.rotation.x = -0.35;
      n.kneeR.rotation.x = -0.25;
      n.hips.position.y = this.hipsBase() + Math.sin(this.time * 1.7) * 0.25;
    } else {
      if (moving) this.walkPhase += dt * (2.6 + speed * 0.35);
      const s = Math.sin(this.walkPhase) * 0.55 * this.walkAmp;
      n.legL.rotation.x = s;
      n.legR.rotation.x = -s;
      n.kneeL.rotation.x = -Math.max(0, -Math.sin(this.walkPhase)) * 0.9 * this.walkAmp - 0.08;
      n.kneeR.rotation.x = -Math.max(0, Math.sin(this.walkPhase)) * 0.9 * this.walkAmp - 0.08;
      const bob = Math.abs(Math.cos(this.walkPhase)) * 0.35 * u * this.walkAmp;
      n.hips.position.y = this.hipsBase() - bob + (1 - this.walkAmp) * 0;
    }

    /* ---- lean + shoulder lag ---- */
    const towardCam = -(this.vel.x * Math.sin(yaw) + this.vel.z * Math.cos(yaw));
    const leanTarget = destroyed ? 0 : clamp(towardCam * 0.02, -0.12, 0.2) + this.aim * 0.06;
    this.lean = damp(this.lean, leanTarget, 4, dt);
    n.torso.rotation.x = this.lean;
    this.shoulderLag = damp(this.shoulderLag + yawRate * 0.6, 0, 5, dt);
    n.shoulders.rotation.y = this.shoulderLag + Math.sin(this.time * 0.9) * 0.02;
    n.head.rotation.y = -this.shoulderLag * 0.5 + Math.sin(this.time * 0.6) * 0.05;

    /* ---- arms: raise the gun on wind-up, recoil on shot ---- */
    const aimX = -0.75 * this.aim + this.recoil * 0.25;
    n.armR.rotation.x = damp(n.armR.rotation.x, aimX, 10, dt);
    n.armR.rotation.y = damp(n.armR.rotation.y, -0.18 * this.aim, 8, dt);
    n.armL.rotation.x = damp(n.armL.rotation.x, -0.15 - this.aim * 0.2 + this.walkAmp * Math.sin(this.walkPhase) * 0.25, 6, dt);

    /* ---- eye + thrusters ---- */
    const scan = Math.sin(this.time * 0.8) * 0.45 * u;
    n.eye.position.x = this.winding ? 0 : scan;
    const pulse = 0.85 + Math.sin(this.time * 6) * 0.15;
    n.eyeMat.emissiveIntensity = destroyed ? 0 : this.baseEmissive * pulse * (1 + this.aim * 1.2);
    if (n.thrusterMat) {
      const flick = 0.8 + Math.random() * 0.4;
      n.thrusterMat.emissiveIntensity = destroyed ? 0 : (this.kind === "CRIMSON" ? 3.4 : 1.4) * flick * (1 + speed * 0.05);
    }
    for (let i = 0; i < n.wake.length; i++) {
      const m = n.wake[i];
      const mat = m.material as THREE.MeshBasicMaterial;
      const len = 0.6 + clamp(speed / 10, 0, 1.6);
      m.scale.set(1, len, 1);
      mat.opacity = destroyed ? 0 : (0.18 + clamp(speed / 20, 0, 0.35)) * (0.75 + Math.random() * 0.25);
    }

    /* ---- spawn fade ---- */
    if (this.spawnT < 1) {
      const dur = this.kind === "CRIMSON" ? ACE_DESCENT_S : 0.6;
      this.spawnT = Math.min(1, this.spawnT + dt / dur);
      const a = this.kind === "CRIMSON" ? 1 : 0.15 + 0.85 * this.spawnT;
      for (const m of this.fadeMaterials) {
        m.transparent = this.spawnT < 1;
        m.opacity = a;
      }
    }

    /* ---- burning: orange emissive flicker on the body ---- */
    for (const m of this.bodyMats) {
      if (this.burning && !destroyed) {
        m.emissive.setHex(0xff5a1a);
        m.emissiveIntensity = 0.25 + Math.random() * 0.45;
      } else if (m.emissiveIntensity > 0) {
        m.emissiveIntensity = 0;
      }
    }

    /* ---- hurled by a blast: ballistic tumble, then lie as a wreck ---- */
    if (this.hurlVel) {
      this.hurlVel.y -= 18 * dt;
      this.pos.addScaledVector(this.hurlVel, dt);
      this.root.position.copy(this.pos);
      this.root.rotation.x += this.hurlSpin.x * dt;
      this.root.rotation.z += this.hurlSpin.z * dt;
      const ground = terrainHeight(this.pos.x, this.pos.z);
      if (this.pos.y <= ground && this.hurlVel.y < 0) {
        this.pos.y = ground;
        this.hurlVel = null;
        this.wreckT = 1;
        this.root.rotation.x = -0.35;
        this.root.rotation.z = this.wreckAxis * 1.4;
        this.root.position.y = ground - 1.2 * u * ENEMY_SCALE;
      }
      if (!this.darkened) this.darkenNow();
      return;
    }

    /* ---- wreck ---- */
    if (destroyed) {
      if (this.wreckDelay > 0) {
        this.wreckDelay -= dt;
      } else {
        if (this.wreckT < 0) {
          this.wreckT = 0;
          this.wreckAxis = Math.random() < 0.5 ? 1 : -1;
        }
        this.wreckT = Math.min(1, this.wreckT + dt / 0.75);
        const t = this.wreckT * this.wreckT;
        this.root.rotation.z = this.wreckAxis * t * 1.35;
        this.root.rotation.x = -t * 0.35;
        this.root.position.y = this.pos.y - t * 1.2 * u * ENEMY_SCALE;
        if (!this.darkened) this.darkenNow();
      }
    }
  }

  private darkenNow(): void {
    this.darkened = true;
    for (const m of this.materials) {
      const sm = m as THREE.MeshStandardMaterial;
      if (sm.color) sm.color.multiplyScalar(0.42);
      if (sm.emissive) sm.emissiveIntensity = 0;
    }
  }

  /** Blast launch: thrown away from `from`, tumbling, then lies where it lands. */
  hurl(from: THREE.Vector3): void {
    const dx = this.pos.x - from.x;
    const dz = this.pos.z - from.z;
    const d = Math.max(1, Math.hypot(dx, dz));
    const speed = 30 + Math.random() * 25;
    this.hurlVel = new THREE.Vector3((dx / d) * speed, 26 + Math.random() * 14, (dz / d) * speed);
    this.hurlSpin.set((Math.random() - 0.5) * 6, 0, (Math.random() - 0.5) * 6);
    this.wreckAxis = Math.random() < 0.5 ? 1 : -1;
    this.wreckT = 0;
  }

  private hipsBase(): number {
    const u = this.u;
    const ls = this.kind === "CRIMSON" ? 1.2 : 1;
    return 1.1 * u + (4.4 + 4.6) * u * ls;
  }

  get isWreck(): boolean {
    return this.wreckT >= 0;
  }
  get wreckProgress(): number {
    return Math.max(0, this.wreckT);
  }

  /* ---- anchors for FX / overlay (world space) ---- */
  chestWorld(out: THREE.Vector3): THREE.Vector3 {
    return this.n.torso.getWorldPosition(out).add(_v.set(0, 3.2 * this.u * ENEMY_SCALE, 0));
  }
  headTopWorld(out: THREE.Vector3): THREE.Vector3 {
    return this.n.head.getWorldPosition(out).add(_v.set(0, 3.8 * this.u * ENEMY_SCALE, 0));
  }
  /** Scale factor for FX sized to the unit (metres × visual scale). */
  get fxScale(): number {
    return this.u * ENEMY_SCALE;
  }
  feetWorld(out: THREE.Vector3): THREE.Vector3 {
    return out.copy(this.pos);
  }
  muzzleWorld(out: THREE.Vector3): THREE.Vector3 {
    return this.n.muzzle.getWorldPosition(out);
  }
  /** Half-width in metres for lock brackets. */
  get halfWidth(): number {
    return 6.4 * this.u * ENEMY_SCALE;
  }

  dispose(): void {
    // Geometry is shared with the template; only the cloned materials go.
    for (const m of this.materials) m.dispose();
    this.root.removeFromParent();
  }
}

/** Relative bearing (deg) of an enemy as seen through the canopy — handy for edge arrows. */
export function relativeBearing(enemy: Enemy): number {
  return ((enemy.bearing + 540) % 360) - 180;
}

export { DEG };
