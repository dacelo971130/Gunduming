/**
 * Tiny procedural-model builder: accumulate primitives per material key, then
 * merge them into one mesh per material. Every mech, console and base
 * structure is built this way — a handful of draw calls per object, no files.
 */
import * as THREE from "three";
import { mergeGeometries } from "three/examples/jsm/utils/BufferGeometryUtils.js";
import { RoundedBoxGeometry } from "three/examples/jsm/geometries/RoundedBoxGeometry.js";

/** Minimum tessellation for curved primitives — the pilot reads facets as "pixels". */
const MIN_RADIAL = 32;
const MIN_SPHERE = 32;

/** Bevelled box: every armour plate gets a soft chamfer proportional to its smallest side. */
function bevelBox(w: number, h: number, d: number): THREE.BufferGeometry {
  const m = Math.min(w, h, d);
  const radius = Math.min(m * 0.18, Math.max(w, h, d) * 0.04);
  if (radius < 0.004) return new THREE.BoxGeometry(w, h, d);
  return new RoundedBoxGeometry(w, h, d, 2, radius);
}

export type Rot = [number, number, number];

export class PartBuilder {
  private readonly buckets = new Map<string, THREE.BufferGeometry[]>();

  /** Add an arbitrary pre-built geometry (must carry position/normal/uv). */
  raw(geo: THREE.BufferGeometry, x: number, y: number, z: number, mat: string, rot?: Rot): this {
    this.push(geo, x, y, z, mat, rot);
    return this;
  }

  private push(geo: THREE.BufferGeometry, x: number, y: number, z: number, mat: string, rot?: Rot): void {
    if (rot) {
      geo.rotateX(rot[0]);
      geo.rotateY(rot[1]);
      geo.rotateZ(rot[2]);
    }
    geo.translate(x, y, z);
    let list = this.buckets.get(mat);
    if (!list) {
      list = [];
      this.buckets.set(mat, list);
    }
    list.push(geo);
  }

  box(w: number, h: number, d: number, x: number, y: number, z: number, mat: string, rot?: Rot): this {
    this.push(bevelBox(w, h, d), x, y, z, mat, rot);
    return this;
  }
  /** Sharp-edged box for panel lines, seams and other things that must stay crisp. */
  sharp(w: number, h: number, d: number, x: number, y: number, z: number, mat: string, rot?: Rot): this {
    this.push(new THREE.BoxGeometry(w, h, d), x, y, z, mat, rot);
    return this;
  }
  /** Box with a wedge taper: top face narrower than bottom (sleek armour). */
  wedge(w: number, h: number, d: number, taper: number, x: number, y: number, z: number, mat: string, rot?: Rot): this {
    const geo = bevelBox(w, h, d);
    const pos = geo.attributes.position as THREE.BufferAttribute;
    for (let i = 0; i < pos.count; i++) {
      // Smooth taper: full at the top face, none at the bottom.
      const k = 1 + (taper - 1) * Math.max(0, Math.min(1, pos.getY(i) / h + 0.5));
      pos.setX(i, pos.getX(i) * k);
      pos.setZ(i, pos.getZ(i) * k);
    }
    geo.computeVertexNormals();
    this.push(geo, x, y, z, mat, rot);
    return this;
  }
  cyl(rTop: number, rBot: number, h: number, seg: number, x: number, y: number, z: number, mat: string, rot?: Rot): this {
    this.push(new THREE.CylinderGeometry(rTop, rBot, h, Math.max(seg, MIN_RADIAL)), x, y, z, mat, rot);
    return this;
  }
  sphere(r: number, seg: number, x: number, y: number, z: number, mat: string): this {
    const n = Math.max(seg, MIN_SPHERE);
    this.push(new THREE.SphereGeometry(r, n, Math.max(4, n >> 1)), x, y, z, mat);
    return this;
  }
  dome(r: number, seg: number, x: number, y: number, z: number, mat: string): this {
    const n = Math.max(seg, MIN_SPHERE);
    this.push(new THREE.SphereGeometry(r, n, Math.max(4, n >> 1), 0, Math.PI * 2, 0, Math.PI / 2), x, y, z, mat);
    return this;
  }
  torus(r: number, tube: number, radial: number, tubular: number, x: number, y: number, z: number, mat: string, rot?: Rot): this {
    this.push(new THREE.TorusGeometry(r, tube, Math.max(radial, 10), Math.max(tubular, MIN_RADIAL)), x, y, z, mat, rot);
    return this;
  }
  /** Row of rivets (small spheres) along a line from a to b. */
  rivets(ax: number, ay: number, az: number, bx: number, by: number, bz: number, n: number, r: number, mat: string): this {
    for (let i = 0; i < n; i++) {
      const t = n === 1 ? 0.5 : i / (n - 1);
      this.push(new THREE.SphereGeometry(r, 12, 8), ax + (bx - ax) * t, ay + (by - ay) * t, az + (bz - az) * t, mat);
    }
    return this;
  }

  build(materials: Record<string, THREE.Material>, shadows = true): THREE.Group {
    const group = new THREE.Group();
    for (const [key, list0] of this.buckets) {
      // RoundedBoxGeometry is non-indexed; mergeGeometries needs all-or-none, so flatten when mixed.
      const mixed = list0.some((g) => g.index) && list0.some((g) => !g.index);
      const list = mixed ? list0.map((g) => (g.index ? g.toNonIndexed() : g)) : list0;
      if (mixed) for (let i = 0; i < list0.length; i++) if (list0[i] !== list[i]) list0[i].dispose();
      const merged = list.length === 1 ? list[0] : mergeGeometries(list, false);
      if (!merged) continue;
      if (list.length > 1) for (const g of list) g.dispose();
      const mat = materials[key];
      if (!mat) throw new Error(`PartBuilder: no material for key "${key}"`);
      const mesh = new THREE.Mesh(merged, mat);
      mesh.castShadow = shadows;
      mesh.receiveShadow = shadows;
      mesh.name = key;
      group.add(mesh);
    }
    this.buckets.clear();
    return group;
  }
}

/** Dispose every geometry (and optionally material) under a root. */
export function disposeTree(root: THREE.Object3D, materialsToo: boolean): void {
  root.traverse((o) => {
    const mesh = o as THREE.Mesh;
    if (mesh.geometry) mesh.geometry.dispose();
    if (materialsToo && mesh.material) {
      const m = mesh.material;
      if (Array.isArray(m)) m.forEach((x) => x.dispose());
      else m.dispose();
    }
  });
}

/** Deep-clone a template so each instance can fade/darken independently (geometry stays shared). */
export function cloneWithMaterials(template: THREE.Object3D): THREE.Object3D {
  const clone = template.clone(true);
  clone.traverse((o) => {
    const mesh = o as THREE.Mesh;
    if (mesh.isMesh && mesh.material) {
      mesh.material = Array.isArray(mesh.material) ? mesh.material.map((m) => m.clone()) : mesh.material.clone();
    }
  });
  return clone;
}
