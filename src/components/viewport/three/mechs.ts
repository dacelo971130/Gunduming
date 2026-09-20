/**
 * Procedural mecha. Everything is primitives merged per material (see
 * PartBuilder). Three builders:
 *
 *  - buildGrunt()  MANTIS-01: rounded helmet, pink monoeye in a visor slit,
 *                  spiked right pauldron, slab shield on the left shoulder,
 *                  cable bundles at waist and calves, drum-magazine machine
 *                  gun, heat-hawk on the hip. Dull olive PBR, darker limbs.
 *  - buildAce()    CRIMSON-01: same lineage, sleeker, crimson with dark trim,
 *                  commander fin, left shield only, longer legs, brighter
 *                  thrusters. ~1.3x presence.
 *  - buildHero()   AETHER FRAME: white/blue/red hero frame, yellow V-fin,
 *                  twin green camera eyes, backpack with twin saber hilts,
 *                  beam rifle right hand, slab shield left forearm. Used by
 *                  MechReveal; its forearm builder is shared with the cockpit.
 *
 * All rigs share one node layout so a single animator drives both enemies.
 */
import * as THREE from "three";
import { PartBuilder, disposeTree } from "./parts";
import { armourTexture, hazardTexture } from "./textures";

export type MatSet = Record<string, THREE.Material>;

export interface MechRig {
  root: THREE.Group;
  /** Total height in metres (feet at y=0). */
  height: number;
  hips: THREE.Group;
  torso: THREE.Group;
  shoulders: THREE.Group;
  head: THREE.Group;
  /** Monoeye / camera eyes — emissive material to pulse. */
  eyeMat: THREE.MeshStandardMaterial;
  eye: THREE.Object3D;
  legL: THREE.Group;
  legR: THREE.Group;
  kneeL: THREE.Group;
  kneeR: THREE.Group;
  armL: THREE.Group;
  armR: THREE.Group;
  /** Weapon muzzle in armR local space. */
  muzzle: THREE.Object3D;
  thrusterMat: THREE.MeshStandardMaterial;
  /** Energy wake planes (ace only). */
  wake: THREE.Mesh[];
  materials: THREE.Material[];
  textures: THREE.Texture[];
}

/* ------------------------------------------------------------ palettes */

function gruntMaterials(): { mats: MatSet; textures: THREE.Texture[] } {
  const armourTex = armourTexture("#4f6238", "#8b8d82", 3);
  const limbTex = armourTexture("#34422b", "#7d7f75", 8);
  const hazard = hazardTexture();
  const mats: MatSet = {
    armour: new THREE.MeshStandardMaterial({ map: armourTex, roughness: 0.82, metalness: 0.28 }),
    limb: new THREE.MeshStandardMaterial({ map: limbTex, roughness: 0.86, metalness: 0.25 }),
    dark: new THREE.MeshStandardMaterial({ color: 0x25272a, roughness: 0.62, metalness: 0.72 }),
    cable: new THREE.MeshStandardMaterial({ color: 0x1c1d1f, roughness: 0.95, metalness: 0.1 }),
    steel: new THREE.MeshStandardMaterial({ color: 0x9aa0a6, roughness: 0.38, metalness: 0.92 }),
    hazard: new THREE.MeshStandardMaterial({ map: hazard, roughness: 0.8, metalness: 0.2 }),
    eye: new THREE.MeshStandardMaterial({ color: 0x220a14, emissive: 0xff4fa0, emissiveIntensity: 3.2, roughness: 0.2 }),
    thruster: new THREE.MeshStandardMaterial({ color: 0x1a1008, emissive: 0xff6a24, emissiveIntensity: 1.6, roughness: 0.4 }),
  };
  return { mats, textures: [armourTex, limbTex, hazard] };
}

function aceMaterials(): { mats: MatSet; textures: THREE.Texture[] } {
  const armourTex = armourTexture("#8f1d27", "#b9b3a8", 5);
  const limbTex = armourTexture("#5e1620", "#a09a90", 12);
  const hazard = hazardTexture();
  const mats: MatSet = {
    armour: new THREE.MeshPhysicalMaterial({ map: armourTex, roughness: 0.42, metalness: 0.35, clearcoat: 0.55, clearcoatRoughness: 0.25 }),
    limb: new THREE.MeshPhysicalMaterial({ map: limbTex, roughness: 0.5, metalness: 0.35, clearcoat: 0.35 }),
    dark: new THREE.MeshStandardMaterial({ color: 0x33363a, roughness: 0.55, metalness: 0.7 }),
    cable: new THREE.MeshStandardMaterial({ color: 0x1c1d1f, roughness: 0.95, metalness: 0.1 }),
    steel: new THREE.MeshStandardMaterial({ color: 0xb0b4b8, roughness: 0.3, metalness: 0.95 }),
    hazard: new THREE.MeshStandardMaterial({ map: hazard, roughness: 0.8, metalness: 0.2 }),
    eye: new THREE.MeshStandardMaterial({ color: 0x220a14, emissive: 0xff3a86, emissiveIntensity: 4.5, roughness: 0.2 }),
    thruster: new THREE.MeshStandardMaterial({ color: 0x1a1008, emissive: 0xff7a3a, emissiveIntensity: 3.2, roughness: 0.4 }),
  };
  return { mats, textures: [armourTex, limbTex, hazard] };
}

export function heroMaterials(): { mats: MatSet; textures: THREE.Texture[] } {
  const whiteTex = armourTexture("#eceeea", "#b8bab6", 21, 256, 0.35);
  const hazard = hazardTexture();
  const mats: MatSet = {
    orange: new THREE.MeshStandardMaterial({ color: 0xff6a1a, roughness: 0.5, metalness: 0.2, emissive: 0x3a1000, emissiveIntensity: 0.5 }),
    hazard: new THREE.MeshStandardMaterial({ map: hazard, roughness: 0.75, metalness: 0.2 }),
    white: new THREE.MeshPhysicalMaterial({ map: whiteTex, roughness: 0.48, metalness: 0.12, clearcoat: 0.5, clearcoatRoughness: 0.3 }),
    blue: new THREE.MeshPhysicalMaterial({ color: 0x1f4aa8, roughness: 0.45, metalness: 0.2, clearcoat: 0.5 }),
    red: new THREE.MeshPhysicalMaterial({ color: 0xb8202a, roughness: 0.45, metalness: 0.2, clearcoat: 0.5 }),
    yellow: new THREE.MeshStandardMaterial({ color: 0xf2c230, roughness: 0.4, metalness: 0.3, emissive: 0x332400, emissiveIntensity: 0.4 }),
    frame: new THREE.MeshStandardMaterial({ color: 0x55585e, roughness: 0.55, metalness: 0.8 }),
    dark: new THREE.MeshStandardMaterial({ color: 0x23252a, roughness: 0.6, metalness: 0.7 }),
    steel: new THREE.MeshStandardMaterial({ color: 0xb9bdc2, roughness: 0.3, metalness: 0.95 }),
    eye: new THREE.MeshStandardMaterial({ color: 0x062014, emissive: 0x3dff8a, emissiveIntensity: 0, roughness: 0.15 }),
    thruster: new THREE.MeshStandardMaterial({ color: 0x1a1008, emissive: 0x7ab8ff, emissiveIntensity: 1.2, roughness: 0.4 }),
  };
  return { mats, textures: [whiteTex, hazard] };
}

/* ------------------------------------------------------------- helpers */

function group(name: string, x = 0, y = 0, z = 0): THREE.Group {
  const g = new THREE.Group();
  g.name = name;
  g.position.set(x, y, z);
  return g;
}

/** Accordion cable bundle between two points (tube + rings). */
function cableBundle(b: PartBuilder, ax: number, ay: number, az: number, bx: number, by: number, bz: number, sag: number, r: number, mat: string): void {
  const curve = new THREE.CatmullRomCurve3([
    new THREE.Vector3(ax, ay, az),
    new THREE.Vector3((ax + bx) / 2, (ay + by) / 2 - sag, (az + bz) / 2 + sag * 0.4),
    new THREE.Vector3(bx, by, bz),
  ]);
  const tube = new THREE.TubeGeometry(curve, 10, r, 7, false);
  b.raw(tube, 0, 0, 0, mat);
  for (let i = 1; i < 6; i++) {
    const p = curve.getPoint(i / 6);
    const t = curve.getTangent(i / 6);
    const q = new THREE.Quaternion().setFromUnitVectors(new THREE.Vector3(0, 0, 1), t.normalize());
    const e = new THREE.Euler().setFromQuaternion(q);
    b.torus(r * 1.05, r * 0.32, 6, 10, p.x, p.y, p.z, mat, [e.x, e.y, e.z]);
  }
}

/* ------------------------------------------------------- monoeye family */

interface LineageOpts {
  height: number;
  legStretch: number; // 1 = grunt, 1.18 = ace
  spike: boolean;
  fin: boolean;
  materials: { mats: MatSet; textures: THREE.Texture[] };
}

function buildLineage(o: LineageOpts): MechRig {
  const { mats, textures } = o.materials;
  const u = o.height / 20;
  const ls = o.legStretch;
  const root = group("mech");
  const thigh = 4.4 * u * ls;
  const shin = 4.6 * u * ls;
  const footH = 1.1 * u;
  const hipY = footH + shin + thigh;

  /* ---- legs ---- */
  function leg(side: number): { hip: THREE.Group; knee: THREE.Group } {
    const hip = group("hip", side * 2.1 * u, hipY, 0);
    let b = new PartBuilder();
    b.cyl(1.05 * u, 1.05 * u, 1.4 * u, 10, 0, 0, 0, "dark", [0, 0, Math.PI / 2]); // hip joint
    b.wedge(2.3 * u, thigh, 2.5 * u, 0.86, 0, -thigh / 2, 0, "limb");
    b.box(2.5 * u, thigh * 0.55, 0.5 * u, 0, -thigh * 0.45, 1.3 * u, "armour"); // knee guard plate
    b.rivets(-0.9 * u, -thigh * 0.2, 1.35 * u, 0.9 * u, -thigh * 0.2, 1.35 * u, 4, 0.09 * u, "steel");
    hip.add(b.build(mats));

    const knee = group("knee", 0, -thigh, 0);
    b = new PartBuilder();
    b.cyl(1.0 * u, 1.0 * u, 2.6 * u, 10, 0, 0, 0, "dark", [0, 0, Math.PI / 2]);
    b.wedge(2.4 * u, shin, 2.6 * u, 0.9, 0, -shin / 2, 0, "limb");
    // calf cable bundle
    cableBundle(b, -0.9 * u, -shin * 0.15, -1.2 * u, -0.9 * u, -shin * 0.85, -1.5 * u, 0.5 * u, 0.28 * u, "cable");
    cableBundle(b, 0.9 * u, -shin * 0.15, -1.2 * u, 0.9 * u, -shin * 0.85, -1.5 * u, 0.5 * u, 0.28 * u, "cable");
    // piston at the back of the shin
    b.cyl(0.18 * u, 0.18 * u, shin * 0.7, 6, 0, -shin * 0.45, -1.55 * u, "steel");
    // foot
    b.box(2.6 * u, footH, 3.6 * u, 0, -shin - footH / 2, 0.5 * u, "dark");
    b.box(2.7 * u, footH * 0.7, 1.6 * u, 0, -shin - footH * 0.3, 1.9 * u, "limb");
    b.box(1.6 * u, footH * 0.6, 0.6 * u, 0, -shin - footH * 0.5, -1.3 * u, "hazard");
    knee.add(b.build(mats));
    hip.add(knee);
    return { hip, knee };
  }
  const L = leg(-1);
  const R = leg(1);

  /* ---- hips / skirt ---- */
  const hips = group("hips", 0, hipY, 0);
  {
    const b = new PartBuilder();
    b.box(5.4 * u, 2.0 * u, 3.2 * u, 0, 0.2 * u, 0, "dark");
    b.wedge(6.2 * u, 2.4 * u, 3.8 * u, 0.85, 0, -0.3 * u, 0, "armour"); // skirt
    b.box(1.6 * u, 3.4 * u, 0.9 * u, -3.2 * u, -1.3 * u, 0.2 * u, "armour", [0, 0, 0.15]); // side skirt L
    b.box(1.6 * u, 3.4 * u, 0.9 * u, 3.2 * u, -1.3 * u, 0.2 * u, "armour", [0, 0, -0.15]); // side skirt R
    b.box(2.8 * u, 2.6 * u, 0.7 * u, 0, -1.5 * u, 1.9 * u, "armour"); // front skirt
    // waist cable bundles across the front of the skirt
    cableBundle(b, -2.4 * u, 0.4 * u, 1.5 * u, 2.4 * u, 0.4 * u, 1.5 * u, 0.9 * u, 0.32 * u, "cable");
    cableBundle(b, -2.6 * u, 0.6 * u, -1.2 * u, 2.6 * u, 0.6 * u, -1.2 * u, 0.7 * u, 0.3 * u, "cable");
    // heat-hawk holstered on the left hip
    b.cyl(0.14 * u, 0.14 * u, 3.6 * u, 6, -3.9 * u, -1.6 * u, -0.4 * u, "steel", [0.15, 0, 0.1]);
    b.wedge(1.3 * u, 0.9 * u, 0.3 * u, 0.4, -3.9 * u, 0.4 * u, -0.4 * u, "dark", [0, 0, Math.PI]);
    hips.add(b.build(mats));
  }
  hips.add(L.hip, R.hip);
  L.hip.position.y = 0;
  R.hip.position.y = 0;
  root.add(hips);

  /* ---- torso ---- */
  const torsoH = 5.4 * u;
  const torso = group("torso", 0, 1.1 * u, 0);
  {
    const b = new PartBuilder();
    b.wedge(7.2 * u, torsoH, 4.6 * u, 1.08, 0, torsoH / 2, 0, "armour"); // chest, flares upward
    b.box(3.0 * u, 2.0 * u, 0.6 * u, 0, torsoH * 0.72, 2.45 * u, "dark"); // chest intake
    b.box(2.6 * u, 0.35 * u, 0.4 * u, 0, torsoH * 0.38, 2.5 * u, "hazard"); // warning band
    b.rivets(-3.2 * u, torsoH * 0.9, 2.25 * u, 3.2 * u, torsoH * 0.9, 2.25 * u, 7, 0.1 * u, "steel");
    b.box(0.3 * u, torsoH * 0.9, 0.1 * u, -2.2 * u, torsoH / 2, 2.38 * u, "dark"); // weld seam
    b.box(0.3 * u, torsoH * 0.9, 0.1 * u, 2.2 * u, torsoH / 2, 2.38 * u, "dark");
    // backpack + twin thrusters
    b.box(5.0 * u, 3.6 * u, 1.8 * u, 0, torsoH * 0.55, -3.0 * u, "dark");
    b.cyl(0.9 * u, 1.15 * u, 1.6 * u, 10, -1.6 * u, torsoH * 0.25, -3.4 * u, "steel", [Math.PI / 2 - 0.3, 0, 0]);
    b.cyl(0.9 * u, 1.15 * u, 1.6 * u, 10, 1.6 * u, torsoH * 0.25, -3.4 * u, "steel", [Math.PI / 2 - 0.3, 0, 0]);
    torso.add(b.build(mats));
    const tb = new PartBuilder();
    tb.cyl(0.75 * u, 0.75 * u, 0.2 * u, 10, -1.6 * u, torsoH * 0.25 - 0.4 * u, -4.1 * u, "thruster", [Math.PI / 2 - 0.3, 0, 0]);
    tb.cyl(0.75 * u, 0.75 * u, 0.2 * u, 10, 1.6 * u, torsoH * 0.25 - 0.4 * u, -4.1 * u, "thruster", [Math.PI / 2 - 0.3, 0, 0]);
    torso.add(tb.build(mats, false));
  }
  hips.add(torso);

  /* ---- shoulders (lag rig) ---- */
  const shoulders = group("shoulders", 0, torsoH * 0.88, 0);
  torso.add(shoulders);
  {
    const b = new PartBuilder();
    // right: spiked pauldron (or a smooth dome for the ace)
    b.dome(2.5 * u, 14, 4.9 * u, -0.2 * u, 0, "armour");
    b.cyl(2.5 * u, 2.3 * u, 1.4 * u, 14, 4.9 * u, -0.9 * u, 0, "dark");
    if (o.spike) {
      const spikes: Array<[number, number, number, number, number]> = [
        [0, 2.3, 0, 0, 0], [1.3, 1.9, 0.6, 0, -0.5], [-1.1, 1.9, 0.9, 0, 0.45], [0.7, 1.7, -1.4, 0.6, -0.3], [-0.8, 1.6, -1.5, 0.6, 0.35],
      ];
      for (const [sx, sy, sz, rx, rz] of spikes) b.cyl(0.02 * u, 0.36 * u, 1.9 * u, 7, 4.9 * u + sx * u, sy * u, sz * u, "steel", [rx, 0, rz]);
    } else {
      b.box(3.2 * u, 0.5 * u, 3.4 * u, 4.9 * u, 1.9 * u, 0, "dark");
    }
    // left: slab shield on the shoulder, angled to cover the chest
    b.box(0.9 * u, 6.2 * u, 4.6 * u, -5.4 * u, -1.1 * u, 0.4 * u, "armour", [0, 0.12, -0.16]);
    b.box(0.3 * u, 6.0 * u, 4.2 * u, -5.9 * u, -1.1 * u, 0.4 * u, "dark", [0, 0.12, -0.16]);
    b.box(0.35 * u, 0.5 * u, 3.6 * u, -5.95 * u, 1.4 * u, 0.4 * u, "hazard", [0, 0.12, -0.16]);
    b.rivets(-5.6 * u, 1.6 * u, -1.4 * u, -5.6 * u, 1.6 * u, 2.2 * u, 5, 0.1 * u, "steel");
    // shoulder axle blocks
    b.box(2.4 * u, 2.2 * u, 2.4 * u, 3.4 * u, -0.4 * u, 0, "dark");
    b.box(2.4 * u, 2.2 * u, 2.4 * u, -3.4 * u, -0.4 * u, 0, "dark");
    shoulders.add(b.build(mats));
  }

  /* ---- arms ---- */
  const upperL = 3.4 * u;
  const foreL = 3.4 * u;
  function arm(side: number, gun: boolean): { arm: THREE.Group; muzzle: THREE.Object3D } {
    const arm = group("arm", side * 4.9 * u, -0.9 * u, 0);
    const b = new PartBuilder();
    b.wedge(1.7 * u, upperL, 1.7 * u, 0.9, 0, -upperL / 2, 0, "limb");
    b.cyl(0.85 * u, 0.85 * u, 1.9 * u, 8, 0, -upperL, 0, "dark", [0, 0, Math.PI / 2]);
    // forearm bent forward to hold the weapon
    const fx = 0;
    const fz = foreL * 0.75;
    b.box(1.9 * u, 1.9 * u, foreL, fx, -upperL - 0.6 * u, fz / 2, "limb");
    b.box(1.3 * u, 1.3 * u, 1.2 * u, fx, -upperL - 0.6 * u, fz + 0.5 * u, "dark"); // fist
    b.rivets(-0.7 * u, -upperL + 0.4 * u, fz * 0.3, 0.7 * u, -upperL + 0.4 * u, fz * 0.3, 3, 0.09 * u, "steel");
    const muzzle = new THREE.Object3D();
    muzzle.name = "muzzle";
    if (gun) {
      // heavy drum-magazine machine gun
      const gy = -upperL - 0.6 * u;
      const gz = fz + 0.4 * u;
      b.box(1.0 * u, 1.2 * u, 4.6 * u, 0, gy + 0.5 * u, gz + 0.4 * u, "dark");
      b.cyl(0.28 * u, 0.32 * u, 3.4 * u, 8, 0, gy + 0.7 * u, gz + 4.2 * u, "steel", [Math.PI / 2, 0, 0]);
      b.cyl(0.55 * u, 0.55 * u, 0.5 * u, 8, 0, gy + 0.7 * u, gz + 5.6 * u, "dark", [Math.PI / 2, 0, 0]); // muzzle brake
      b.cyl(0.95 * u, 0.95 * u, 0.8 * u, 12, 0, gy - 0.8 * u, gz + 0.2 * u, "dark", [0, 0, Math.PI / 2]); // drum
      b.box(0.8 * u, 0.8 * u, 1.8 * u, 0, gy + 0.6 * u, gz - 2.4 * u, "limb"); // stock
      b.box(0.5 * u, 0.7 * u, 1.4 * u, 0, gy + 1.5 * u, gz + 1.2 * u, "steel"); // top sight rail
      muzzle.position.set(0, gy + 0.7 * u, gz + 5.9 * u);
    }
    arm.add(b.build(mats));
    arm.add(muzzle);
    return { arm, muzzle };
  }
  const AL = arm(-1, false);
  const AR = arm(1, true);
  shoulders.add(AL.arm, AR.arm);

  /* ---- head ---- */
  const head = group("head", 0, torsoH + 0.5 * u, 0.2 * u);
  {
    const b = new PartBuilder();
    b.cyl(1.0 * u, 1.2 * u, 0.9 * u, 10, 0, -0.1 * u, 0, "dark"); // neck
    const helm = new THREE.SphereGeometry(1.75 * u, 18, 12);
    helm.scale(1, 0.9, 1.05);
    helm.translate(0, 1.5 * u, 0);
    b.raw(helm, 0, 0, 0, "armour");
    b.box(3.7 * u, 0.55 * u, 1.2 * u, 0, 1.35 * u, 1.35 * u, "dark"); // visor slit
    b.cyl(0.42 * u, 0.5 * u, 1.3 * u, 8, 0, 0.55 * u, 1.9 * u, "dark", [Math.PI / 2, 0, 0]); // snout duct
    b.box(0.5 * u, 0.8 * u, 1.2 * u, 0, 2.7 * u, -0.5 * u, "dark"); // crown vent
    if (o.fin) {
      b.wedge(0.25 * u, 3.2 * u, 1.6 * u, 0.3, 0, 4.2 * u, -0.3 * u, "armour", [0.35, 0, 0]);
    }
    head.add(b.build(mats));
  }
  const eyeMat = mats.eye as THREE.MeshStandardMaterial;
  const eye = new THREE.Mesh(new THREE.SphereGeometry(0.3 * u, 10, 8), eyeMat);
  eye.name = "eye";
  eye.position.set(0, 1.35 * u, 1.75 * u);
  head.add(eye);
  torso.add(head);

  const materials = Object.values(mats);
  return {
    root,
    height: hipY + torsoH + 4.5 * u,
    hips,
    torso,
    shoulders,
    head,
    eyeMat,
    eye,
    legL: L.hip,
    legR: R.hip,
    kneeL: L.knee,
    kneeR: R.knee,
    armL: AL.arm,
    armR: AR.arm,
    muzzle: AR.muzzle,
    thrusterMat: mats.thruster as THREE.MeshStandardMaterial,
    wake: [],
    materials,
    textures,
  };
}

export function buildGrunt(): MechRig {
  return buildLineage({ height: 20, legStretch: 1, spike: true, fin: false, materials: gruntMaterials() });
}

export function buildAce(): MechRig {
  const rig = buildLineage({ height: 25, legStretch: 1.2, spike: false, fin: true, materials: aceMaterials() });
  // Energy wake: three additive red planes trailing from the backpack.
  const geo = new THREE.PlaneGeometry(1.2, 9);
  geo.translate(0, -4.5, 0);
  for (let i = 0; i < 3; i++) {
    const mat = new THREE.MeshBasicMaterial({ color: 0xff2a3a, transparent: true, opacity: 0.35, blending: THREE.AdditiveBlending, depthWrite: false, side: THREE.DoubleSide });
    const m = new THREE.Mesh(geo, mat);
    m.name = "wake";
    m.position.set((i - 1) * 2.2, 4, -4.6);
    m.rotation.x = -Math.PI / 2 + 0.25;
    m.rotation.y = (i - 1) * 0.15;
    m.renderOrder = 18;
    rig.torso.add(m);
    rig.wake.push(m);
    rig.materials.push(mat);
  }
  return rig;
}

/* ---------------------------------------------------------------- hero */

/**
 * AETHER FRAME forearm + hand, pointing along -z with the wrist at the
 * origin. `side` -1 = left (carries the slab shield), +1 = right.
 * Length ~4.6 m at u=1. Shared by the full hero rig and the cockpit view.
 */
export function buildHeroForearm(side: number, mats: MatSet, u = 1): THREE.Group {
  const g = group("forearm");
  const b = new PartBuilder();
  const len = 4.6 * u;
  b.cyl(0.62 * u, 0.62 * u, 1.9 * u, 12, 0, 0, 0, "frame", [0, 0, Math.PI / 2]); // elbow joint
  b.box(1.5 * u, 1.5 * u, 2.2 * u, 0, -0.5 * u, 1.3 * u, "white", [0.5, 0, 0]); // upper-arm stub behind the elbow
  b.wedge(1.9 * u, len, 1.9 * u, 0.86, 0, 0, -len / 2, "white", [Math.PI / 2, 0, 0]);
  b.box(2.0 * u, 0.5 * u, len * 0.6, 0, 0.85 * u, -len * 0.45, "white"); // top plate
  b.sharp(2.05 * u, 0.08 * u, 0.12 * u, 0, 1.12 * u, -len * 0.3, "dark"); // panel lines
  b.sharp(2.05 * u, 0.08 * u, 0.12 * u, 0, 1.12 * u, -len * 0.62, "dark");
  b.sharp(0.1 * u, 0.08 * u, len * 0.55, 0.6 * u, 1.12 * u, -len * 0.45, "dark");
  b.sharp(0.1 * u, 0.08 * u, len * 0.55, -0.6 * u, 1.12 * u, -len * 0.45, "dark");
  b.box(0.5 * u, 0.12 * u, len * 0.3, 0, 1.12 * u, -len * 0.45, "red"); // red stripe
  b.box(0.7 * u, 0.6 * u, 0.9 * u, -0.7 * u, 0.5 * u, -len * 0.15, "frame"); // wrist actuator housing
  b.box(1.95 * u, 0.6 * u, 0.4 * u, 0, 0.3 * u, -len * 0.78, "blue"); // wrist band
  // hand: palm block, four articulated fingers curled around the grip, thumb
  b.box(1.4 * u, 1.3 * u, 1.1 * u, 0, -0.1 * u, -len - 0.45 * u, "frame"); // palm
  b.box(1.5 * u, 0.45 * u, 1.2 * u, 0, 0.7 * u, -len - 0.45 * u, "white"); // hand guard
  for (let i = 0; i < 4; i++) {
    const fx = (i - 1.5) * 0.34 * u;
    b.box(0.3 * u, 0.3 * u, 0.7 * u, fx, -0.05 * u, -len - 1.25 * u, "frame", [0.35, 0, 0]); // proximal
    b.box(0.28 * u, 0.28 * u, 0.55 * u, fx, -0.5 * u, -len - 1.55 * u, "frame", [1.1, 0, 0]); // curled distal
    b.box(0.32 * u, 0.12 * u, 0.5 * u, fx, 0.15 * u, -len - 1.2 * u, "white", [0.35, 0, 0]); // knuckle plate
  }
  b.box(0.32 * u, 0.32 * u, 0.7 * u, side * 0.85 * u, -0.4 * u, -len - 0.7 * u, "frame", [0.4, 0, side * 0.9]); // thumb
  b.rivets(-0.7 * u, 1.0 * u, -len * 0.2, 0.7 * u, 1.0 * u, -len * 0.2, 3, 0.09 * u, "steel");
  if (side < 0) {
    // slab shield hanging off the outer face of the left forearm
    const sx = -1.6 * u;
    b.box(0.5 * u, 6.4 * u, 4.6 * u, sx, 0.4 * u, -len * 0.55, "white", [0, 0, 0.05]);
    b.box(0.25 * u, 3.0 * u, 3.6 * u, sx - 0.25 * u, 0.8 * u, -len * 0.55, "blue");
    b.box(0.25 * u, 0.9 * u, 3.4 * u, sx - 0.25 * u, -1.6 * u, -len * 0.55, "red");
    b.box(0.25 * u, 1.4 * u, 1.3 * u, sx - 0.25 * u, 2.6 * u, -len * 0.55, "yellow");
  }
  g.add(b.build(mats));
  return g;
}

/** AETHER FRAME beam rifle, grip at the origin, barrel along -z (~9.3 m at u=1). */
export function buildBeamRifle(mats: MatSet, u = 1): THREE.Group {
  const rb = new PartBuilder();
  rb.box(0.9 * u, 1.3 * u, 5.6 * u, 0, 0.1 * u, -3.4 * u, "white");
  rb.box(0.6 * u, 0.6 * u, 2.0 * u, 0, 0.1 * u, -0.2 * u, "frame");
  rb.cyl(0.3 * u, 0.36 * u, 3.2 * u, 8, 0, 0.3 * u, -7.4 * u, "frame", [Math.PI / 2, 0, 0]);
  rb.cyl(0.55 * u, 0.55 * u, 0.5 * u, 8, 0, 0.3 * u, -9.0 * u, "dark", [Math.PI / 2, 0, 0]);
  rb.box(0.5 * u, 0.8 * u, 1.6 * u, 0, 1.0 * u, -4.6 * u, "dark"); // scope
  rb.box(0.6 * u, 0.6 * u, 0.6 * u, 0, 0.9 * u, -2.0 * u, "yellow"); // sensor
  rb.box(0.3 * u, 0.5 * u, 2.4 * u, 0, -0.9 * u, -3.0 * u, "blue"); // under-barrel rail
  rb.box(0.5 * u, 1.1 * u, 0.6 * u, 0, -0.9 * u, -1.4 * u, "frame"); // magazine
  rb.box(0.5 * u, 0.9 * u, 0.5 * u, 0, -0.7 * u, 0.6 * u, "frame"); // grip
  rb.cyl(0.42 * u, 0.42 * u, 0.9 * u, 24, 0, 1.0 * u, -5.5 * u, "dark", [Math.PI / 2, 0, 0]); // scope body
  rb.cyl(0.3 * u, 0.3 * u, 0.1 * u, 24, 0, 1.0 * u, -5.98 * u, "yellow", [Math.PI / 2, 0, 0]); // scope lens
  for (let i = 0; i < 4; i++) rb.sharp(0.95 * u, 0.06 * u, 0.25 * u, 0, 0.55 * u, -4.2 * u - i * 0.5 * u, "dark"); // cooling vents
  rb.box(0.7 * u, 0.3 * u, 1.2 * u, 0, -0.6 * u, -5.9 * u, "red"); // fore-grip accent
  const g = rb.build(mats);
  g.name = "rifle";
  return g;
}

export interface HeroRig {
  root: THREE.Group;
  height: number;
  head: THREE.Group;
  eyeMat: THREE.MeshStandardMaterial;
  /** Chest cockpit hatch (opens during the reveal). */
  hatch: THREE.Group;
  hatchPoint: THREE.Object3D;
  materials: THREE.Material[];
  textures: THREE.Texture[];
}

export function buildHero(): HeroRig {
  const { mats, textures } = heroMaterials();
  const u = 1;
  const root = group("hero");
  const thigh = 4.6;
  const shin = 4.6;
  const footH = 1.2;
  const hipY = footH + shin + thigh;

  function leg(side: number): THREE.Group {
    const hip = group("hip", side * 2.0, hipY, 0);
    const b = new PartBuilder();
    b.cyl(1.0, 1.0, 1.4, 10, 0, 0, 0, "frame", [0, 0, Math.PI / 2]);
    b.wedge(2.2, thigh, 2.4, 0.85, 0, -thigh / 2, 0, "white");
    b.cyl(0.95, 0.95, 2.4, 10, 0, -thigh, 0, "frame", [0, 0, Math.PI / 2]);
    b.box(2.0, 1.6, 0.6, 0, -thigh + 0.1, 1.3, "white"); // knee
    b.wedge(2.4, shin, 2.5, 0.9, 0, -thigh - shin / 2, 0, "white");
    b.box(0.6, shin * 0.6, 0.3, 0, -thigh - shin * 0.45, 1.35, "blue");
    b.box(2.6, footH, 3.8, 0, -thigh - shin - footH / 2, 0.5, "red"); // red feet
    b.box(2.7, footH * 0.5, 1.4, 0, -thigh - shin - footH * 0.2, 2.0, "red");
    b.box(1.8, footH * 0.5, 0.8, 0, -thigh - shin - footH * 0.5, -1.4, "frame");
    hip.add(b.build(mats));
    return hip;
  }
  root.add(leg(-1), leg(1));

  const hips = group("hips", 0, hipY, 0);
  {
    const b = new PartBuilder();
    b.box(5.2, 2.0, 3.2, 0, 0.2, 0, "frame");
    b.box(2.6, 2.4, 0.7, 0, -1.2, 1.8, "white"); // front skirt
    b.box(1.6, 3.0, 0.9, -3.0, -1.2, 0.2, "white", [0, 0, 0.15]);
    b.box(1.6, 3.0, 0.9, 3.0, -1.2, 0.2, "white", [0, 0, -0.15]);
    b.box(1.2, 1.2, 0.8, 0, 0.2, 1.9, "red"); // crotch block
    b.box(0.8, 0.8, 0.5, 0, 0.2, 2.2, "yellow");
    hips.add(b.build(mats));
  }
  root.add(hips);

  const torsoH = 5.6;
  const torso = group("torso", 0, hipY + 1.1, 0);
  {
    const b = new PartBuilder();
    b.wedge(6.8, torsoH, 4.4, 1.1, 0, torsoH / 2, 0, "blue"); // blue chest
    b.box(7.4, 1.6, 4.6, 0, torsoH * 0.92, 0, "white"); // white collar
    b.box(2.2, 2.2, 3.4, 0, torsoH * 0.35, 0.8, "white"); // abdomen core
    b.box(1.6, 1.0, 0.5, -1.9, torsoH * 0.62, 2.35, "red"); // chest vents
    b.box(1.6, 1.0, 0.5, 1.9, torsoH * 0.62, 2.35, "red");
    b.box(0.2, 0.8, 0.1, -1.9, torsoH * 0.62, 2.62, "dark");
    b.box(0.2, 0.8, 0.1, 1.9, torsoH * 0.62, 2.62, "dark");
    b.box(0.9, 0.9, 0.4, 0, torsoH * 0.62, 2.35, "yellow"); // central sensor block
    // backpack with twin saber hilts
    b.box(4.8, 3.8, 1.9, 0, torsoH * 0.55, -3.0, "white");
    b.cyl(0.4, 0.4, 3.2, 8, -1.8, torsoH * 0.55 + 2.4, -3.2, "steel", [0.25, 0, 0]);
    b.cyl(0.4, 0.4, 3.2, 8, 1.8, torsoH * 0.55 + 2.4, -3.2, "steel", [0.25, 0, 0]);
    b.cyl(0.9, 1.1, 1.4, 10, -1.5, torsoH * 0.2, -3.5, "frame", [Math.PI / 2 - 0.3, 0, 0]);
    b.cyl(0.9, 1.1, 1.4, 10, 1.5, torsoH * 0.2, -3.5, "frame", [Math.PI / 2 - 0.3, 0, 0]);
    torso.add(b.build(mats));
    const tb = new PartBuilder();
    tb.cyl(0.7, 0.7, 0.2, 10, -1.5, torsoH * 0.2 - 0.4, -4.1, "thruster", [Math.PI / 2 - 0.3, 0, 0]);
    tb.cyl(0.7, 0.7, 0.2, 10, 1.5, torsoH * 0.2 - 0.4, -4.1, "thruster", [Math.PI / 2 - 0.3, 0, 0]);
    torso.add(tb.build(mats, false));
  }
  root.add(torso);

  // cockpit hatch on the chest (hinged at its top edge)
  const hatch = group("hatch", 0, torsoH * 0.5 + 0.9, 2.3);
  {
    const b = new PartBuilder();
    b.box(1.8, 1.8, 0.35, 0, -0.9, 0.15, "blue");
    b.box(1.5, 0.3, 0.1, 0, -0.9, 0.35, "dark");
    hatch.add(b.build(mats));
  }
  torso.add(hatch);
  const hatchPoint = new THREE.Object3D();
  hatchPoint.position.set(0, torsoH * 0.5, 1.9);
  torso.add(hatchPoint);

  // shoulders + arms
  const shoulders = group("shoulders", 0, torsoH * 0.88, 0);
  torso.add(shoulders);
  {
    const b = new PartBuilder();
    for (const s of [-1, 1]) {
      b.box(3.0, 2.4, 3.4, s * 4.6, 0.3, 0, "white");
      b.box(3.1, 0.5, 3.5, s * 4.6, 1.55, 0, "white");
      b.box(2.4, 2.0, 2.4, s * 3.2, -0.4, 0, "frame");
    }
    shoulders.add(b.build(mats));
  }
  const upperL = 3.4;
  for (const s of [-1, 1]) {
    const arm = group("arm", s * 4.6, -0.9, 0);
    const b = new PartBuilder();
    b.wedge(1.8, upperL, 1.8, 0.9, 0, -upperL / 2, 0, "white");
    arm.add(b.build(mats));
    const fore = buildHeroForearm(s, mats, u);
    fore.position.set(0, -upperL, 0);
    fore.rotation.x = s > 0 ? -0.45 : -0.15;
    arm.add(fore);
    if (s > 0) {
      const rifle = buildBeamRifle(mats, u);
      rifle.position.set(0, -0.1, -4.6 - 0.5);
      fore.add(rifle);
    }
    shoulders.add(arm);
  }

  // head
  const head = group("head", 0, torsoH + 0.6, 0.2);
  {
    const b = new PartBuilder();
    b.cyl(0.9, 1.1, 0.9, 10, 0, -0.1, 0, "frame");
    b.box(2.6, 2.4, 2.6, 0, 1.3, 0, "white"); // helmet
    b.box(2.7, 0.6, 2.2, 0, 2.5, -0.2, "white");
    b.box(2.2, 0.9, 0.5, 0, 1.3, 1.35, "dark"); // eye recess
    b.box(1.0, 1.0, 0.7, 0, 0.4, 1.3, "white"); // face plate
    b.box(0.5, 0.18, 0.2, -0.3, 0.45, 1.66, "dark"); // face vents
    b.box(0.5, 0.18, 0.2, 0.3, 0.45, 1.66, "dark");
    b.box(0.5, 0.7, 0.3, 0, 0.45, 1.5, "red"); // chin
    b.box(0.7, 0.4, 0.7, 0, 2.6, 0.9, "red"); // forehead sensor
    // yellow V-fin
    b.box(0.18, 2.6, 0.5, -1.0, 3.6, 0.9, "yellow", [0, 0, -0.55]);
    b.box(0.18, 2.6, 0.5, 1.0, 3.6, 0.9, "yellow", [0, 0, 0.55]);
    head.add(b.build(mats));
  }
  const eyeMat = mats.eye as THREE.MeshStandardMaterial;
  const eyeGeo = new THREE.BoxGeometry(0.7, 0.4, 0.2);
  for (const s of [-1, 1]) {
    const e = new THREE.Mesh(eyeGeo, eyeMat);
    e.position.set(s * 0.55, 1.3, 1.62);
    head.add(e);
  }
  torso.add(head);

  return { root, height: hipY + torsoH + 5, head, eyeMat, hatch, hatchPoint, materials: Object.values(mats), textures };
}

export function disposeRig(rig: { root: THREE.Object3D; materials: THREE.Material[]; textures: THREE.Texture[] }): void {
  disposeTree(rig.root, false);
  for (const m of rig.materials) m.dispose();
  for (const t of rig.textures) t.dispose();
}
