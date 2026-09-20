/**
 * ECHO-01 — the round green companion robot resting in a padded cradle on the
 * lower-right console shelf, inside the canopy glass and closer than any frame
 * geometry so nothing can occlude it. Smooth high-tessellation shell, two big
 * friendly eyes (white core, iris ring, highlight), a curved mouth slot that
 * lights when speaking, rounded hinged ear flaps, stubby arms/legs that pop
 * out when excited. It bounces lazily, rolls to one side now and then, looks
 * at the pilot and occasionally glances at the locked target.
 */
import * as THREE from "three";
import { RoundedBoxGeometry } from "three/examples/jsm/geometries/RoundedBoxGeometry.js";
import type { AiStatus } from "@/game/types";
import type { CameraRig } from "./camera";
import { PartBuilder, disposeTree } from "./parts";
import { clamp, damp } from "./math";

/** View depth — closer than the canopy glass/frame (FRAME_DEPTH 1.25) so nothing can sit in front of it. */
export const ECHO_DEPTH = 1.05;
/** Screen position: ~4 o'clock, 70% of the aperture radius out. */
const ECHO_ANGLE_DEG = -34;
const ECHO_RADIUS_FRAC = 0.66;

const _camWorld = new THREE.Vector3();

export class Echo01 {
  readonly group = new THREE.Group();
  private readonly body = new THREE.Group();
  private readonly earL = new THREE.Group();
  private readonly earR = new THREE.Group();
  private readonly eyeGroups: THREE.Group[] = [];
  private readonly eyeCoreMat: THREE.MeshStandardMaterial;
  private readonly irisMat: THREE.MeshStandardMaterial;
  private readonly mouthMat: THREE.MeshStandardMaterial;
  private readonly armL = new THREE.Group();
  private readonly armR = new THREE.Group();
  private readonly legs: THREE.Group[] = [];
  private readonly disposables: Array<{ dispose(): void }> = [];
  private readonly r: number;

  private time = 0;
  private phase = 0;
  private earOpen = 0;
  private eyeLevel = 1;
  private eyeNarrow = 1;
  private excite = 0;
  private tumble = 0;
  private tumbleDir = 1;
  private jump = 0;
  private spin = 0;
  private redFlash = 0;
  private bossHold = 0;
  private nextBlink = 3;
  private blinkT = -1;
  private lazyRoll = 0;
  private lazyRollTarget = 0;
  private nextLazyRoll = 5;
  private squash = 0;
  private glanceYaw = 0;
  private glanceTarget = 0;
  private nextGlance = 6;
  private glanceUntil = 0;
  /** Relative bearing (deg) of the locked target, or null. Set by the scene. */
  targetBearing: number | null = null;

  constructor(private readonly rig: CameraRig) {
    const r = 0.077 * ECHO_DEPTH * 1.15 * 1.2;
    this.r = r;
    const shell = new THREE.MeshPhysicalMaterial({
      color: 0x38a84a, roughness: 0.24, metalness: 0.02, clearcoat: 1, clearcoatRoughness: 0.1,
      sheen: 0.35, sheenColor: new THREE.Color(0x9bffb0), sheenRoughness: 0.5,
    });
    const darkGreen = new THREE.MeshStandardMaterial({ color: 0x1b5a27, roughness: 0.55, metalness: 0.15 });
    const grey = new THREE.MeshStandardMaterial({ color: 0x4c5056, roughness: 0.5, metalness: 0.75 });
    const fabric = new THREE.MeshStandardMaterial({ color: 0x3a3330, roughness: 1, metalness: 0 });
    const seam = new THREE.MeshStandardMaterial({ color: 0x6a5f58, roughness: 1, metalness: 0 });
    const cable = new THREE.MeshStandardMaterial({ color: 0x141416, roughness: 0.9, metalness: 0.1 });
    // Eye whites glow only faintly (kept under the bloom threshold); the dark ring + pupil carry the read.
    this.eyeCoreMat = new THREE.MeshStandardMaterial({ color: 0xf4f1e6, emissive: 0xfff2d0, emissiveIntensity: 0.35, roughness: 0.3 });
    this.irisMat = new THREE.MeshStandardMaterial({ color: 0x0b1a10, emissive: 0x1f7a3f, emissiveIntensity: 0.25, roughness: 0.35 });
    const pupil = new THREE.MeshStandardMaterial({ color: 0x050505, roughness: 0.4 });
    this.disposables.push(pupil);
    this.mouthMat = new THREE.MeshStandardMaterial({ color: 0x0a0505, emissive: 0xff6a5a, emissiveIntensity: 0.12, roughness: 0.4 });
    const highlight = new THREE.MeshBasicMaterial({ color: 0xffffff });
    this.disposables.push(shell, darkGreen, grey, fabric, seam, cable, this.eyeCoreMat, this.irisMat, this.mouthMat, highlight);

    /* ---- shell ---- */
    const shellGeo = new THREE.SphereGeometry(r, 72, 54);
    const shellMesh = new THREE.Mesh(shellGeo, shell);
    shellMesh.castShadow = false;
    this.body.add(shellMesh);
    this.disposables.push(shellGeo);
    const b = new PartBuilder();
    b.torus(r * 1.0, r * 0.01, 8, 96, 0, 0, 0, "dark", [Math.PI / 2, 0, 0]); // equatorial seam
    b.torus(r * 0.2, r * 0.008, 8, 40, -r * 0.94, -r * 0.02, r * 0.2, "dark", [0, Math.PI / 2, 0]); // arm hatches
    b.torus(r * 0.2, r * 0.008, 8, 40, r * 0.94, -r * 0.02, r * 0.2, "dark", [0, Math.PI / 2, 0]);
    this.body.add(b.build({ dark: darkGreen }, false));

    /* ---- eyes: socket, white core, iris ring, highlight ---- */
    const eyeR = r * 0.22; // each eye ~22% of the diameter
    const socketGeo = new THREE.CylinderGeometry(eyeR * 1.12, eyeR * 1.12, r * 0.06, 48);
    socketGeo.rotateX(Math.PI / 2);
    const coreGeo = new THREE.SphereGeometry(eyeR, 48, 32);
    coreGeo.scale(1, 1, 0.55);
    const irisGeo = new THREE.TorusGeometry(eyeR * 0.6, eyeR * 0.11, 12, 48); // dark iris ring
    const pupilGeo = new THREE.SphereGeometry(eyeR * 0.36, 24, 16);
    pupilGeo.scale(1, 1, 0.5);
    const dotGeo = new THREE.SphereGeometry(eyeR * 0.14, 16, 12);
    this.disposables.push(socketGeo, coreGeo, irisGeo, pupilGeo, dotGeo);
    for (const s of [-1, 1]) {
      const g = new THREE.Group();
      const dir = new THREE.Vector3(s * 0.42, 0.2, 0.86).normalize();
      g.position.copy(dir).multiplyScalar(r * 0.94);
      g.lookAt(dir.clone().multiplyScalar(r * 3));
      const socket = new THREE.Mesh(socketGeo, darkGreen);
      const core = new THREE.Mesh(coreGeo, this.eyeCoreMat);
      core.position.z = r * 0.05;
      const iris = new THREE.Mesh(irisGeo, this.irisMat);
      iris.position.z = r * 0.1;
      const pup = new THREE.Mesh(pupilGeo, pupil);
      pup.position.z = r * 0.11;
      const dot = new THREE.Mesh(dotGeo, highlight);
      dot.position.set(-eyeR * 0.3, eyeR * 0.3, r * 0.15);
      g.add(socket, core, iris, pup, dot);
      this.body.add(g);
      this.eyeGroups.push(g);
    }

    /* ---- curved mouth slot ---- */
    const mouthGeo = new THREE.TorusGeometry(r * 0.3, r * 0.022, 10, 40, Math.PI * 0.55);
    const mouth = new THREE.Mesh(mouthGeo, this.mouthMat);
    mouth.position.set(0, -r * 0.16, r * 0.9);
    mouth.rotation.set(0.25, 0, Math.PI + Math.PI * 0.225); // arc opens upward = gentle smile
    this.body.add(mouth);
    this.disposables.push(mouthGeo);

    /* ---- rounded ear flaps with visible hinges ---- */
    const earGeo = new RoundedBoxGeometry(r * 0.78, r * 0.14, r * 0.62, 3, r * 0.06);
    earGeo.translate(r * 0.42, 0, 0); // hinge at the inner edge
    const earInner = new RoundedBoxGeometry(r * 0.58, r * 0.03, r * 0.44, 2, r * 0.012);
    earInner.translate(r * 0.42, -r * 0.08, 0);
    const hingeGeo = new THREE.CylinderGeometry(r * 0.07, r * 0.07, r * 0.72, 24);
    hingeGeo.rotateX(Math.PI / 2);
    this.disposables.push(earGeo, earInner, hingeGeo);
    for (const s of [-1, 1]) {
      const g = s < 0 ? this.earL : this.earR;
      const flap = new THREE.Mesh(earGeo, shell);
      flap.add(new THREE.Mesh(earInner, darkGreen));
      g.add(flap, new THREE.Mesh(hingeGeo, grey));
      g.position.set(s * r * 0.28, r * 0.93, 0);
      g.scale.x = s;
      this.body.add(g);
    }

    /* ---- stubby arms + legs (retracted when idle) ---- */
    const armGeo = new THREE.CylinderGeometry(r * 0.1, r * 0.12, r * 0.5, 24);
    armGeo.rotateZ(Math.PI / 2);
    armGeo.translate(r * 0.25, 0, 0);
    const handGeo = new THREE.SphereGeometry(r * 0.15, 24, 16);
    handGeo.translate(r * 0.5, 0, 0);
    for (const s of [-1, 1]) {
      const g = s < 0 ? this.armL : this.armR;
      g.add(new THREE.Mesh(armGeo, grey), new THREE.Mesh(handGeo, darkGreen));
      g.position.set(s * r * 0.75, -r * 0.02, r * 0.2);
      g.scale.x = s;
      this.body.add(g);
    }
    const legGeo = new THREE.CylinderGeometry(r * 0.12, r * 0.15, r * 0.34, 24);
    legGeo.translate(0, -r * 0.17, 0);
    const footGeo = new RoundedBoxGeometry(r * 0.3, r * 0.08, r * 0.4, 2, r * 0.03);
    footGeo.translate(0, -r * 0.38, r * 0.05);
    for (const s of [-1, 1]) {
      const g = new THREE.Group();
      g.add(new THREE.Mesh(legGeo, grey), new THREE.Mesh(footGeo, darkGreen));
      g.position.set(s * r * 0.35, -r * 0.8, 0);
      this.body.add(g);
      this.legs.push(g);
    }
    this.disposables.push(armGeo, handGeo, legGeo, footGeo);

    /* ---- cradle: recessed cushion (ball sinks ~15%), shelf, bumpers, charging lead ---- */
    const cb = new PartBuilder();
    cb.torus(r * 0.82, r * 0.3, 20, 64, 0, -r * 0.72, 0, "fabric", [Math.PI / 2, 0, 0]);
    cb.torus(r * 1.12, r * 0.012, 8, 64, 0, -r * 0.6, 0, "seam", [Math.PI / 2, 0, 0]); // stitched seam
    cb.torus(r * 0.55, r * 0.012, 8, 64, 0, -r * 0.44, 0, "seam", [Math.PI / 2, 0, 0]);
    cb.cyl(r * 0.9, r * 1.0, r * 0.14, 48, 0, -r * 1.06, 0, "grey"); // cradle base
    cb.raw(new RoundedBoxGeometry(r * 3.0, r * 0.12, r * 2.3, 2, r * 0.04), 0, -r * 1.18, 0, "grey"); // shelf
    cb.cyl(r * 0.16, r * 0.16, r * 0.5, 24, -r * 1.3, -r * 0.9, r * 0.4, "fabric"); // soft bumpers
    cb.cyl(r * 0.16, r * 0.16, r * 0.5, 24, r * 1.3, -r * 0.9, r * 0.4, "fabric");
    const lead = new THREE.CatmullRomCurve3([
      new THREE.Vector3(0.2 * r, -r * 0.7, -r * 0.6),
      new THREE.Vector3(0.6 * r, -r * 1.0, -r * 0.95),
      new THREE.Vector3(1.2 * r, -r * 1.1, -r * 1.0),
    ]);
    cb.raw(new THREE.TubeGeometry(lead, 16, r * 0.028, 10, false), 0, 0, 0, "cable");
    cb.cyl(r * 0.05, r * 0.05, r * 0.12, 16, 0.2 * r, -r * 0.7, -r * 0.6, "grey", [Math.PI / 2, 0, 0]); // plug
    this.group.add(cb.build({ fabric, seam, grey, cable }, false));

    /* ---- one small white key light (candela scale — tiny values at this distance) ---- */
    const key = new THREE.PointLight(0xfff4e6, 0.012, 1.2, 2);
    key.position.set(r * 1.6, r * 2.4, r * 3.4);
    this.group.add(key);

    this.group.add(this.body);
    const ang = ECHO_ANGLE_DEG * (Math.PI / 180);
    rig.atScreen(Math.cos(ang) * ECHO_RADIUS_FRAC, Math.sin(ang) * ECHO_RADIUS_FRAC, ECHO_DEPTH, this.group.position);
    rig.camera.add(this.group);
  }

  onPlayerHit(): void {
    this.tumble = 1;
    this.tumbleDir = Math.random() < 0.5 ? -1 : 1;
    this.redFlash = 1;
  }
  onKill(): void {
    this.jump = 1;
    this.spin = 1;
    this.excite = 1;
  }
  onBossIntro(): void {
    this.bossHold = 3.2;
    this.excite = 0;
  }

  update(dt: number, status: AiStatus, hpFrac: number): void {
    this.time += dt;
    const t = this.time;
    const r = this.r;
    const nervous = hpFrac < 0.4;
    this.bossHold = Math.max(0, this.bossHold - dt);
    this.tumble = Math.max(0, this.tumble - dt / 0.7);
    this.jump = Math.max(0, this.jump - dt / 0.6);
    this.spin = Math.max(0, this.spin - dt / 0.7);
    this.redFlash = Math.max(0, this.redFlash - dt / 0.5);
    this.excite = Math.max(0, this.excite - dt / 1.8);
    const boss = this.bossHold > 0;
    const happy = this.excite > 0.2 || status === "LISTENING";

    /* ---- face the pilot; glance at the target now and then ---- */
    this.rig.camera.getWorldPosition(_camWorld);
    this.group.lookAt(_camWorld);
    if (t > this.nextGlance && this.targetBearing !== null && !boss) {
      this.glanceTarget = clamp(this.targetBearing / 35, -1, 1) * 0.55 - 0.15;
      this.glanceUntil = t + 1.3;
      this.nextGlance = t + 4 + Math.random() * 4;
    }
    if (t > this.glanceUntil) this.glanceTarget = 0;
    this.glanceYaw = damp(this.glanceYaw, this.glanceTarget, 5, dt);

    /* ---- relaxed bounce ---- */
    let freq = 0.85;
    let amp = r * 0.07;
    if (status === "LISTENING") { freq = 0.7; amp = r * 0.05; }
    if (status === "THINKING") { freq = 1.8; amp = r * 0.12; }
    if (status === "SPEAKING") { freq = 2.2; amp = r * 0.16; }
    if (nervous) { freq = 3.2; amp = r * 0.18; }
    if (boss) { freq = 0.5; amp = r * 0.03; }
    this.phase += dt * freq;
    const hop = Math.abs(Math.sin(this.phase * Math.PI));
    const landing = 1 - hop;
    const jumpY = Math.sin(this.jump * Math.PI) * r * 0.9;
    const jitter = nervous ? (Math.random() - 0.5) * r * 0.03 : 0;
    this.body.position.y = hop * amp + jumpY + jitter;
    this.body.position.x = jitter * 0.5 + Math.sin(this.tumble * Math.PI) * r * 0.4 * this.tumbleDir;
    this.squash = damp(this.squash, landing * landing * 0.05 * (amp / (r * 0.16)), 12, dt);
    this.body.scale.set(1 + this.squash * 0.5, 1 - this.squash, 1 + this.squash * 0.5);

    /* ---- lazy roll / tumble / spin ---- */
    if (t > this.nextLazyRoll && !boss && this.tumble === 0) {
      this.lazyRollTarget = (Math.random() < 0.5 ? -1 : 1) * (0.18 + Math.random() * 0.14);
      this.nextLazyRoll = t + 5 + Math.random() * 5;
      setTimeout(() => (this.lazyRollTarget = 0), 1400);
    }
    this.lazyRoll = damp(this.lazyRoll, this.lazyRollTarget, 2.5, dt);
    const tumbleAngle = Math.sin(this.tumble * Math.PI) * 0.9 * this.tumbleDir;
    this.body.rotation.z = tumbleAngle + this.lazyRoll;
    const spinAngle = this.spin > 0 ? (1 - this.spin) * Math.PI * 2 : 0;
    this.body.rotation.y = spinAngle + this.glanceYaw + Math.sin(t * 0.6) * 0.04;
    this.body.rotation.x = Math.sin(this.tumble * Math.PI * 2) * 0.3 - this.lazyRoll * 0.2;

    /* ---- ears: droop at rest, open ~70° when happy, flutter/flap ---- */
    let earTarget = 0;
    if (status === "LISTENING") earTarget = 1;
    if (status === "THINKING") earTarget = 0.5 + Math.sin(t * 14) * 0.45;
    if (status === "SPEAKING") earTarget = 0.35 + Math.abs(Math.sin(t * 9)) * 0.6;
    if (happy) earTarget = Math.max(earTarget, 0.95);
    if (boss) earTarget = -0.3;
    this.earOpen = damp(this.earOpen, earTarget, status === "THINKING" || status === "SPEAKING" ? 30 : 8, dt);
    // at rest the flaps sit ~25° up off the shell (they read as flaps, not antennae); open = ~70° more.
    const earAngle = 0.45 + this.earOpen * 1.2;
    this.earL.rotation.z = earAngle;
    this.earR.rotation.z = -earAngle;

    /* ---- eyes ---- */
    let level = 0.35;
    if (status === "LISTENING") level = 0.7;
    if (status === "THINKING") level = 0.45;
    if (status === "SPEAKING") level = 0.55 + Math.sin(t * 11) * 0.15;
    if (status === "OFFLINE") level = 0.05;
    this.eyeLevel = damp(this.eyeLevel, level, 8, dt);
    if (t > this.nextBlink) {
      this.blinkT = 0;
      this.nextBlink = t + 3 + Math.random() * 3 + (status === "THINKING" ? -1.5 : 0);
    }
    let blinkNarrow = 1;
    if (this.blinkT >= 0) {
      this.blinkT += dt;
      blinkNarrow = 1 - Math.sin(clamp(this.blinkT / 0.16, 0, 1) * Math.PI) * 0.95;
      if (this.blinkT > 0.16) this.blinkT = -1;
    }
    const narrowTarget = boss ? 0.3 : blinkNarrow;
    this.eyeNarrow = damp(this.eyeNarrow, narrowTarget, 40, dt);
    for (const g of this.eyeGroups) g.scale.set(1, this.eyeNarrow, 1);
    if (this.redFlash > 0) {
      this.eyeCoreMat.emissive.setHex(0xff3a2a);
      this.eyeCoreMat.emissiveIntensity = 3 * this.redFlash + 0.8;
      this.irisMat.emissive.setHex(0xff7060);
    } else {
      this.eyeCoreMat.emissive.setHex(boss ? 0xffd0a0 : 0xfff6dc);
      this.eyeCoreMat.emissiveIntensity = this.eyeLevel;
      this.irisMat.emissive.setHex(0x7fe0a8);
      this.irisMat.emissiveIntensity = 0.5 + this.eyeLevel * 0.25;
    }

    /* ---- mouth ---- */
    this.mouthMat.emissiveIntensity = status === "SPEAKING" ? 0.5 + Math.max(0, Math.sin(t * 18)) * 0.6 : 0.08;

    /* ---- arms + legs pop out when excited ---- */
    const pop = clamp(this.excite * 1.5, 0, 1);
    const armOut = 0.75 + pop * 0.5;
    this.armL.position.x = -r * armOut;
    this.armR.position.x = r * armOut;
    this.armL.scale.set(-pop, pop, pop);
    this.armR.scale.set(pop, pop, pop);
    this.armL.rotation.z = Math.sin(t * 12) * 0.5 * pop;
    this.armR.rotation.z = -Math.sin(t * 12 + 1) * 0.5 * pop;
    for (const l of this.legs) {
      l.scale.setScalar(Math.max(0.001, pop));
      l.position.y = -r * (0.8 + pop * 0.3);
    }
  }

  dispose(): void {
    disposeTree(this.group, false);
    for (const d of this.disposables) d.dispose();
    this.group.removeFromParent();
  }
}
