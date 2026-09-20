/**
 * The round cockpit interior, parented to the camera: canopy frame ring with
 * its inner lip exactly on the aperture circle, bolts, latches, dirty glass,
 * console deck with indicator lamps, seat pads — plus the AETHER FRAME's own
 * forearms and the selected weapon at the bottom of the view.
 *
 * All sizes hang off `CameraRig.apertureRadiusAt(depth)` = depth·tan(35°),
 * so nothing here needs rebuilding on resize.
 */
import * as THREE from "three";
import type { WeaponId } from "@/game/types";
import type { CameraRig } from "./camera";
import { PartBuilder, disposeTree } from "./parts";
import { buildBeamRifle, buildHeroForearm, heroMaterials, type MatSet } from "./mechs";
import { cockpitMetalTexture, glassDirtTexture } from "./textures";
import { clamp, damp } from "./math";

/** View depth of the canopy frame lip. */
export const FRAME_DEPTH = 1.25;
/** Pilot's-eye forearm placement (camera space). */
const ARM_SCALE = 0.62;
const ARM_X = 2.6;
const ARM_Y = -2.9;
const ARM_Z = -6.4;
/** Far end (hand + weapon) pitched down so the pilot looks onto the decorated top plates. */
const ARM_TILT = -0.42;
const RIGHT_HAND: WeaponId[] = ["RIFLE", "INCENDIARY", "BLADE"];
const LEFT_HAND: WeaponId[] = ["MISSILE", "FLEET_CANNON"];

interface Lamp {
  mat: THREE.MeshStandardMaterial;
  period: number;
  phase: number;
  duty: number;
}

export class CockpitRig {
  readonly group = new THREE.Group();
  private readonly lamps: Lamp[] = [];
  private readonly disposables: Array<{ dispose(): void }> = [];
  private readonly heroMats: MatSet;

  /* arms + weapons */
  private readonly arms = new THREE.Group();
  private readonly armR = new THREE.Group();
  private readonly armL = new THREE.Group();
  private readonly weapons: Record<WeaponId, THREE.Group>;
  private readonly muzzles: Record<WeaponId, THREE.Object3D>;
  private bladeCore: THREE.Mesh | null = null;
  private bladeGlow: THREE.Mesh | null = null;
  private current: WeaponId = "RIFLE";
  private swapT = 1;
  private ignite = 0;
  private recoilR = 0;
  private recoilL = 0;
  private recoilCannon = 0;
  private recoilNuke = 0;
  private slash = 0;
  private time = 0;
  private nukeLamp: THREE.MeshStandardMaterial | null = null;
  private designatorLamp: THREE.MeshStandardMaterial | null = null;

  constructor(private readonly rig: CameraRig) {
    const R = rig.apertureRadiusAt(FRAME_DEPTH);
    this.buildFrame(R);
    this.buildGlass(R);
    this.buildConsoles(R);
    this.buildLights();

    const hm = heroMaterials();
    this.heroMats = hm.mats;
    this.disposables.push(...hm.textures, ...Object.values(hm.mats));
    this.weapons = {
      RIFLE: new THREE.Group(), CANNON: new THREE.Group(), MISSILE: new THREE.Group(), BLADE: new THREE.Group(),
      INCENDIARY: new THREE.Group(), NUKE: new THREE.Group(), FLEET_CANNON: new THREE.Group(),
    };
    this.muzzles = {
      RIFLE: new THREE.Object3D(), CANNON: new THREE.Object3D(), MISSILE: new THREE.Object3D(), BLADE: new THREE.Object3D(),
      INCENDIARY: new THREE.Object3D(), NUKE: new THREE.Object3D(), FLEET_CANNON: new THREE.Object3D(),
    };
    this.buildArms();
    this.group.add(this.arms);
    rig.camera.add(this.group);
  }

  /* ------------------------------------------------------------ frame */

  private buildFrame(R: number): void {
    const { map, rough } = cockpitMetalTexture();
    this.disposables.push(map, rough);
    const metal = new THREE.MeshStandardMaterial({ color: 0x7c8087, map, roughnessMap: rough, roughness: 0.55, metalness: 0.7 });
    const body = new THREE.MeshStandardMaterial({ color: 0x0c0d0f, roughness: 0.95, metalness: 0.2 });
    const rubber = new THREE.MeshStandardMaterial({ color: 0x151617, roughness: 1, metalness: 0 });
    const steel = new THREE.MeshStandardMaterial({ color: 0x8d9298, roughness: 0.35, metalness: 0.95 });
    this.disposables.push(metal, body, rubber, steel);

    // Lathe profile in (radius, toward-camera) — inner lip at (1, 0).
    const profile = [
      [1.0, 0.0], [1.0, 0.02], [1.02, 0.045], [1.06, 0.07], [1.12, 0.085], [1.22, 0.09],
      [1.32, 0.08], [1.4, 0.06], [1.46, 0.03], [1.5, 0.0], [1.5, -0.02],
    ].map(([r, y]) => new THREE.Vector2(r * R, y * R));
    const lathe = new THREE.LatheGeometry(profile, 112);
    const ring = new THREE.Mesh(lathe, metal);
    ring.rotation.x = Math.PI / 2;
    ring.position.z = -FRAME_DEPTH;
    ring.castShadow = false;
    ring.receiveShadow = true;
    this.group.add(ring);

    // Rubber seal just inside the lip (very thin torus) so the glass edge reads.
    const seal = new THREE.Mesh(new THREE.TorusGeometry(R * 1.005, R * 0.012, 6, 112), rubber);
    seal.position.z = -FRAME_DEPTH + R * 0.01;
    this.group.add(seal);

    // Dark cockpit body: a huge annulus from the frame outward — everything outside the circle.
    const annulus = new THREE.Mesh(new THREE.RingGeometry(R * 1.49, R * 14, 96, 1), body);
    annulus.position.z = -FRAME_DEPTH + R * 0.02;
    this.group.add(annulus);

    // Bolts + latches around the rim.
    const b = new PartBuilder();
    for (let i = 0; i < 28; i++) {
      const a = (i / 28) * Math.PI * 2 + 0.05;
      const r = R * 1.27;
      b.cyl(R * 0.02, R * 0.02, R * 0.02, 6, Math.cos(a) * r, Math.sin(a) * r, -FRAME_DEPTH + R * 0.1, "steel", [Math.PI / 2, 0, 0]);
    }
    for (const a of [Math.PI * 0.5, Math.PI * 1.17, Math.PI * 1.83]) {
      // canopy latch: a block spanning the lip, slightly proud of the glass
      const r = R * 1.06;
      b.box(R * 0.12, R * 0.14, R * 0.1, Math.cos(a) * r, Math.sin(a) * r, -FRAME_DEPTH + R * 0.05, "metal", [0, 0, a]);
      b.box(R * 0.05, R * 0.03, R * 0.06, Math.cos(a) * r * 0.985, Math.sin(a) * r * 0.985, -FRAME_DEPTH + R * 0.09, "steel", [0, 0, a]);
    }
    this.group.add(b.build({ metal, steel }, false));
  }

  private buildGlass(R: number): void {
    const glass = new THREE.MeshPhysicalMaterial({
      color: 0xb9c6d2,
      roughness: 0.06,
      metalness: 0,
      transparent: true,
      opacity: 0.06,
      clearcoat: 1,
      clearcoatRoughness: 0.08,
      envMapIntensity: 0.7,
      depthWrite: false,
      side: THREE.DoubleSide,
    });
    const dirtTex = glassDirtTexture();
    const dirt = new THREE.MeshBasicMaterial({
      color: 0x7d8489,
      alphaMap: dirtTex,
      transparent: true,
      opacity: 0.2,
      depthWrite: false,
    });
    this.disposables.push(glass, dirt, dirtTex);
    // A very shallow dome so reflections slide across it as the camera sways.
    const dome = new THREE.SphereGeometry(R * 2.6, 64, 24, 0, Math.PI * 2, 0, 0.395);
    const glassMesh = new THREE.Mesh(dome, glass);
    glassMesh.rotation.x = -Math.PI / 2;
    glassMesh.position.z = -FRAME_DEPTH + R * 2.6 - R * 0.02;
    glassMesh.renderOrder = 30;
    this.group.add(glassMesh);
    const dirtMesh = new THREE.Mesh(new THREE.CircleGeometry(R * 1.0, 72), dirt);
    dirtMesh.position.z = -FRAME_DEPTH + R * 0.005;
    dirtMesh.renderOrder = 31;
    this.group.add(dirtMesh);
  }

  private buildConsoles(R: number): void {
    const dark = new THREE.MeshStandardMaterial({ color: 0x1b1d20, roughness: 0.85, metalness: 0.4 });
    const pad = new THREE.MeshStandardMaterial({ color: 0x2a2724, roughness: 1, metalness: 0 });
    const screen = new THREE.MeshStandardMaterial({ color: 0x06100c, emissive: 0x1f6f4a, emissiveIntensity: 0.35, roughness: 0.3 });
    this.disposables.push(dark, pad, screen);
    const b = new PartBuilder();
    const d = -FRAME_DEPTH + R * 0.28; // closer than the lip so it sits inside the circle
    // Dash deck across the bottom of the circle.
    b.box(R * 1.6, R * 0.16, R * 0.5, 0, -R * 0.86, d, "dark", [0.55, 0, 0]);
    b.box(R * 0.42, R * 0.02, R * 0.26, -R * 0.45, -R * 0.78, d + R * 0.02, "screen", [0.55, 0, 0]);
    b.box(R * 0.42, R * 0.02, R * 0.26, R * 0.45, -R * 0.78, d + R * 0.02, "screen", [0.55, 0, 0]);
    // Seat/side pads at the lower left and right.
    b.box(R * 0.22, R * 0.6, R * 0.5, -R * 0.94, -R * 0.42, d - R * 0.1, "pad", [0, 0, 0.5]);
    b.box(R * 0.22, R * 0.6, R * 0.5, R * 0.94, -R * 0.42, d - R * 0.1, "pad", [0, 0, -0.5]);
    this.group.add(b.build({ dark, pad, screen }, false));

    // Indicator lamps along the dash.
    const geo = new THREE.BoxGeometry(R * 0.028, R * 0.014, R * 0.01);
    const colors = [0x39ff7a, 0x39ff7a, 0xffb43d, 0x39ff7a, 0xff3a2a, 0x39ff7a, 0xffb43d, 0x39ff7a];
    colors.forEach((c, i) => {
      const mat = new THREE.MeshStandardMaterial({ color: 0x050505, emissive: c, emissiveIntensity: 1.5 });
      const m = new THREE.Mesh(geo, mat);
      m.position.set(-R * 0.16 + i * R * 0.046, -R * 0.72, d + R * 0.13);
      m.rotation.x = 0.55;
      this.group.add(m);
      this.lamps.push({ mat, period: 0.6 + (i % 3) * 0.7, phase: i * 0.37, duty: i === 4 ? 0.5 : 0.85 });
      this.disposables.push(mat);
    });
    this.disposables.push(geo);
  }

  private buildLights(): void {
    // Warm console glow from below, cool instrument spill from above.
    const warm = new THREE.PointLight(0xffc9a0, 0.25, 5, 2);
    warm.position.set(0, -0.8, -0.9);
    const cool = new THREE.PointLight(0x8fb4ff, 0.15, 5, 2);
    cool.position.set(0.4, 0.8, -0.7);
    this.group.add(warm, cool);
  }

  /* ------------------------------------------------------------- arms */

  private buildArms(): void {
    const m = this.heroMats;
    // Forearms as the pilot sees them: rising from the lower corners, reaching forward.
    this.armR.scale.setScalar(ARM_SCALE);
    this.armL.scale.setScalar(ARM_SCALE);
    this.armR.position.set(ARM_X, ARM_Y, ARM_Z);
    this.armR.rotation.set(ARM_TILT, -0.16, 0.12);
    this.armL.position.set(-ARM_X, ARM_Y, ARM_Z);
    this.armL.rotation.set(ARM_TILT, 0.16, -0.12);
    this.armR.add(buildHeroForearm(1, m));
    this.armL.add(buildHeroForearm(-1, m));
    this.arms.add(this.armR, this.armL);

    // RIFLE: beam rifle in the right fist.
    const rifle = buildBeamRifle(m);
    rifle.position.set(0, -0.1, -5.1);
    this.weapons.RIFLE.add(rifle);
    this.muzzles.RIFLE.position.set(0, 0.3, -9.3);
    rifle.add(this.muzzles.RIFLE);
    this.armR.add(this.weapons.RIFLE);

    // CANNON: long-barrel heavy cannon over the right shoulder.
    {
      const b = new PartBuilder();
      b.box(1.4, 1.6, 4.2, 0, 0, 0, "white");
      b.box(1.5, 0.5, 4.4, 0, 0.9, 0, "blue");
      b.cyl(0.42, 0.5, 11, 12, 0, 0.1, -7.5, "frame", [Math.PI / 2, 0, 0]);
      b.cyl(0.62, 0.62, 1.4, 12, 0, 0.1, -13.2, "dark", [Math.PI / 2, 0, 0]);
      b.box(0.3, 0.4, 3, 0, 0.7, -8, "red");
      b.box(0.9, 0.9, 1.2, 0, -0.3, 2.6, "frame"); // breech
      b.cyl(0.5, 0.5, 2.2, 8, 0, -1.2, 0.4, "frame", [0, 0, Math.PI / 2]); // mount trunnion
      const cannon = b.build(m, false);
      cannon.scale.setScalar(0.55);
      cannon.position.set(3.0, 2.7, -7.4);
      cannon.rotation.set(0.06, -0.12, 0);
      this.weapons.CANNON.add(cannon);
      this.muzzles.CANNON.position.set(0, 0.1, -14);
      cannon.add(this.muzzles.CANNON);
      this.group.add(this.weapons.CANNON);
    }

    // MISSILE: six-tube pod mounted on the left forearm shield.
    {
      const b = new PartBuilder();
      b.box(2.2, 1.8, 3.2, 0, 0, 0, "white");
      b.box(2.3, 0.3, 3.3, 0, 1.0, 0, "red");
      for (let i = 0; i < 6; i++) {
        const x = -0.6 + (i % 3) * 0.6;
        const y = -0.35 + Math.floor(i / 3) * 0.7;
        b.cyl(0.24, 0.24, 0.6, 10, x, y, -1.5, "dark", [Math.PI / 2, 0, 0]);
      }
      const pod = b.build(m, false);
      pod.position.set(-1.9, 2.3, -3.2);
      pod.rotation.set(-0.05, 0.05, 0);
      this.weapons.MISSILE.add(pod);
      this.muzzles.MISSILE.position.set(0, 0, -1.8);
      pod.add(this.muzzles.MISSILE);
      this.armL.add(this.weapons.MISSILE);
    }

    // BLADE: saber hilt in the right fist + igniting plasma blade.
    {
      const b = new PartBuilder();
      b.cyl(0.32, 0.36, 2.4, 10, 0, 0, -0.6, "white", [Math.PI / 2, 0, 0]);
      b.cyl(0.4, 0.4, 0.3, 10, 0, 0, -1.9, "dark", [Math.PI / 2, 0, 0]);
      b.box(0.2, 0.5, 0.6, 0, 0.3, -0.2, "red");
      const hilt = b.build(m, false);
      hilt.position.set(0, 0.2, -5.0);
      this.weapons.BLADE.add(hilt);
      const coreMat = new THREE.MeshBasicMaterial({ color: 0xf2fbff, transparent: true, opacity: 0.95, blending: THREE.AdditiveBlending, depthWrite: false, side: THREE.DoubleSide });
      const glowMat = new THREE.MeshBasicMaterial({ color: 0x5ad8ff, transparent: true, opacity: 0.45, blending: THREE.AdditiveBlending, depthWrite: false, side: THREE.DoubleSide });
      this.disposables.push(coreMat, glowMat);
      const coreGeo = new THREE.CylinderGeometry(0.16, 0.22, 8.5, 8);
      coreGeo.translate(0, 4.25, 0);
      coreGeo.rotateX(-Math.PI / 2);
      const glowGeo = new THREE.CylinderGeometry(0.42, 0.55, 8.9, 10);
      glowGeo.translate(0, 4.45, 0);
      glowGeo.rotateX(-Math.PI / 2);
      this.bladeCore = new THREE.Mesh(coreGeo, coreMat);
      this.bladeGlow = new THREE.Mesh(glowGeo, glowMat);
      this.bladeCore.position.set(0, 0, -2.0);
      this.bladeGlow.position.set(0, 0, -2.0);
      this.bladeCore.renderOrder = 22;
      this.bladeGlow.renderOrder = 22;
      hilt.add(this.bladeCore, this.bladeGlow);
      this.muzzles.BLADE.position.set(0, 0, -6);
      hilt.add(this.muzzles.BLADE);
      this.armR.add(this.weapons.BLADE);
    }

    // INCENDIARY: stubby shoulder-fed grenade launcher with a drum and a red-orange band (right hand).
    {
      const b = new PartBuilder();
      b.box(1.1, 1.2, 3.2, 0, 0.1, -1.4, "white");
      b.cyl(0.42, 0.42, 1.8, 24, 0, 0.3, -3.6, "frame", [Math.PI / 2, 0, 0]); // fat barrel
      b.cyl(0.5, 0.5, 0.35, 24, 0, 0.3, -4.2, "orange", [Math.PI / 2, 0, 0]); // red-orange band
      b.cyl(0.85, 0.85, 0.9, 32, 0, -0.9, -1.2, "frame", [0, 0, Math.PI / 2]); // drum magazine
      b.box(0.5, 0.9, 0.5, 0, -0.8, 0.5, "frame"); // grip
      b.box(0.9, 0.5, 2.4, 0, 0.95, -1.6, "blue"); // shoulder-feed chute
      b.box(0.3, 0.3, 1.2, 0, 1.3, -0.4, "orange");
      const gl = b.build(m, false);
      gl.position.set(0, -0.1, -5.1);
      this.weapons.INCENDIARY.add(gl);
      this.muzzles.INCENDIARY.position.set(0, 0.3, -4.5);
      gl.add(this.muzzles.INCENDIARY);
      this.armR.add(this.weapons.INCENDIARY);
    }

    // NUKE: large over-the-left-shoulder launcher; warhead visible in the open tube, blinking arming lamp.
    {
      const b = new PartBuilder();
      b.cyl(1.05, 1.05, 7.5, 32, 0, 0, -3.5, "white", [Math.PI / 2, 0, 0]); // tube
      b.cyl(1.15, 1.15, 0.5, 32, 0, 0, -7.2, "frame", [Math.PI / 2, 0, 0]); // muzzle collar
      b.box(1.6, 1.4, 2.4, 0, -0.9, 0.6, "frame"); // breech / mount
      b.cyl(0.6, 0.6, 2.4, 24, 0, -1.6, 0.4, "frame", [0, 0, Math.PI / 2]); // trunnion
      b.box(0.5, 0.4, 3, 0, 1.2, -3, "hazard");
      // warhead sitting in the tube: hazard-banded body, black cone tip
      b.cyl(0.72, 0.72, 3.2, 32, 0, 0, -5.4, "hazard", [Math.PI / 2, 0, 0]);
      b.cyl(0.02, 0.72, 1.4, 32, 0, 0, -7.7, "dark", [Math.PI / 2, 0, 0]);
      const launcher = b.build(m, false);
      launcher.scale.setScalar(0.55);
      launcher.position.set(-3.0, 2.7, -7.4);
      launcher.rotation.set(0.06, 0.12, 0);
      this.weapons.NUKE.add(launcher);
      this.nukeLamp = new THREE.MeshStandardMaterial({ color: 0x220000, emissive: 0xff2020, emissiveIntensity: 2 });
      this.disposables.push(this.nukeLamp);
      const lamp = new THREE.Mesh(new THREE.SphereGeometry(0.22, 16, 12), this.nukeLamp);
      lamp.position.set(0, 1.25, -0.2);
      launcher.add(lamp);
      this.disposables.push(lamp.geometry);
      this.muzzles.NUKE.position.set(0, 0, -8.6);
      launcher.add(this.muzzles.NUKE);
      this.group.add(this.weapons.NUKE);
    }

    // FLEET_CANNON: no held weapon — a radio/targeting designator raised in the left hand.
    {
      const b = new PartBuilder();
      b.box(0.55, 1.0, 0.5, 0, 0, 0, "dark");
      b.box(0.5, 0.35, 0.1, 0, 0.15, 0.3, "frame"); // display bezel
      b.cyl(0.03, 0.03, 1.6, 12, 0.18, 1.2, -0.1, "steel"); // antenna
      b.sphere(0.06, 12, 0.18, 2.0, -0.1, "steel");
      b.cyl(0.14, 0.18, 0.3, 24, 0, 0.55, -0.35, "frame", [Math.PI / 2, 0, 0]); // optic
      const des = b.build(m, false);
      des.position.set(0.2, 1.0, -5.0);
      des.rotation.set(-0.5, 0.3, 0);
      this.weapons.FLEET_CANNON.add(des);
      this.designatorLamp = new THREE.MeshStandardMaterial({ color: 0x002200, emissive: 0x39ff7a, emissiveIntensity: 2 });
      this.disposables.push(this.designatorLamp);
      const lamp = new THREE.Mesh(new THREE.SphereGeometry(0.06, 12, 8), this.designatorLamp);
      lamp.position.set(-0.18, 0.45, 0.28);
      des.add(lamp);
      this.disposables.push(lamp.geometry);
      this.muzzles.FLEET_CANNON.position.set(0, 0.6, -0.5);
      des.add(this.muzzles.FLEET_CANNON);
      this.armL.add(this.weapons.FLEET_CANNON);
    }

    for (const id of Object.keys(this.weapons) as WeaponId[]) this.weapons[id].visible = id === this.current;
  }

  /** Called on `weapon:changed` and when the store disagrees with the shown weapon. */
  setWeapon(weapon: WeaponId): void {
    if (weapon === this.current) return;
    this.current = weapon;
    this.swapT = 0;
    this.ignite = 0;
    for (const id of Object.keys(this.weapons) as WeaponId[]) this.weapons[id].visible = id === weapon;
  }

  get weapon(): WeaponId {
    return this.current;
  }

  /** Recoil kick for the weapon that just fired. */
  fire(weapon: WeaponId): void {
    if (weapon === "CANNON") this.recoilCannon = 1;
    else if (weapon === "NUKE") this.recoilNuke = 1;
    else if (weapon === "MISSILE") this.recoilL = 1;
    else if (weapon === "BLADE") this.slash = 1;
    else if (weapon === "FLEET_CANNON") this.recoilL = 0.3;
    else this.recoilR = 1;
  }

  /** World position of the selected weapon's muzzle (or the given weapon's). */
  muzzleWorld(out: THREE.Vector3, weapon: WeaponId = this.current): THREE.Vector3 {
    return this.muzzles[weapon].getWorldPosition(out);
  }

  update(dt: number): void {
    this.time += dt;
    for (const l of this.lamps) {
      const t = (this.time + l.phase) % l.period;
      l.mat.emissiveIntensity = t < l.period * l.duty ? 1.6 : 0.15;
    }

    this.swapT = Math.min(1, this.swapT + dt / 0.4);
    const swap = 1 - Math.pow(1 - this.swapT, 3);
    this.recoilR = Math.max(0, this.recoilR - dt / 0.22);
    this.recoilL = Math.max(0, this.recoilL - dt / 0.3);
    this.recoilCannon = Math.max(0, this.recoilCannon - dt / 0.5);
    this.recoilNuke = Math.max(0, this.recoilNuke - dt / 0.8);
    this.slash = Math.max(0, this.slash - dt / 0.42);
    if (this.nukeLamp) this.nukeLamp.emissiveIntensity = (this.time * 2) % 1 < 0.5 ? 3 : 0.2;
    if (this.designatorLamp) this.designatorLamp.emissiveIntensity = (this.time * 4) % 1 < 0.3 ? 3 : 0.3;

    // Breathing / sway of the arms relative to the cockpit (the frame is a walking machine).
    const swayY = Math.sin(this.time * 1.25) * 0.08;
    const swayX = Math.sin(this.time * 0.7) * 0.05;
    const drop = (1 - swap) * 2.2; // new weapon rises into view

    const rightHeld = RIGHT_HAND.includes(this.current);
    const leftHeld = LEFT_HAND.includes(this.current);
    const rR = this.recoilR * this.recoilR;
    this.armR.position.set(ARM_X + swayX, ARM_Y + swayY - drop * (rightHeld ? 1 : 0), ARM_Z + rR * 0.7);
    this.armR.rotation.set(ARM_TILT + rR * 0.12, -0.16, 0.12);
    const rL = this.recoilL * this.recoilL;
    // The designator is held up toward the canopy; the pod/shield arm stays low.
    const raise = this.current === "FLEET_CANNON" ? swap * 0.55 : 0;
    this.armL.position.set(-ARM_X + swayX, ARM_Y + swayY - drop * (leftHeld ? 1 : 0) + raise * 1.6, ARM_Z + rL * 0.4 + raise * 1.2);
    this.armL.rotation.set(ARM_TILT + rL * 0.06 - raise * 0.5, 0.16 + raise * 0.25, -0.12);

    const rn = this.recoilNuke * this.recoilNuke;
    const nuke = this.weapons.NUKE.children[0];
    if (nuke) {
      nuke.position.set(-3.0, 2.7 + swayY * 0.4 - drop * 0.8, -7.4 + rn * 2.4);
      nuke.rotation.set(0.06 - rn * 0.25, 0.12, 0);
    }

    // Cannon: heavy kick straight back + a nose-up flip.
    const rc = this.recoilCannon * this.recoilCannon;
    const cannon = this.weapons.CANNON.children[0];
    if (cannon) {
      cannon.position.set(3.0, 2.7 + swayY * 0.4 - drop * 0.8, -7.4 + rc * 1.6);
      cannon.rotation.set(0.06 - rc * 0.18, -0.12, 0);
    }

    // Blade: ignition ramp when selected, swing on fire.
    if (this.bladeCore && this.bladeGlow) {
      const lit = this.current === "BLADE";
      this.ignite = damp(this.ignite, lit && this.swapT > 0.35 ? 1 : 0, lit ? 7 : 14, dt);
      const flick = 0.92 + Math.random() * 0.16;
      const len = this.ignite * flick;
      this.bladeCore.scale.set(1, 1, Math.max(0.001, len));
      this.bladeGlow.scale.set(1 + (1 - this.ignite) * 0.5, 1 + (1 - this.ignite) * 0.5, Math.max(0.001, len));
      (this.bladeGlow.material as THREE.MeshBasicMaterial).opacity = 0.4 * this.ignite * flick;
      const s = this.slash;
      const swing = Math.sin(s * Math.PI) * 1.0;
      this.armR.rotation.x += swing * 0.35;
      this.armR.rotation.z = -swing * 0.9;
      this.armR.position.x -= swing * 2.4;
      this.armR.position.y += swing * 1.4;
    }
  }

  get recoilAmount(): number {
    return clamp(this.recoilR + this.recoilCannon * 1.6 + this.recoilNuke * 2 + this.recoilL * 0.4, 0, 2);
  }

  dispose(): void {
    disposeTree(this.group, false);
    for (const d of this.disposables) d.dispose();
    this.group.removeFromParent();
  }
}
