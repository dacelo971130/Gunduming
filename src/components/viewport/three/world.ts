/**
 * The lunar world: displaced regolith with craters, black vacuum sky with a
 * fixed-seed starfield, a crescent-lit Earth, a distant base with blinking
 * beacons, and the lighting rig (one hard sun + faint blue Earthshine).
 */
import * as THREE from "three";
import { PartBuilder, disposeTree } from "./parts";
import { DEG, TERRAIN_SIZE, seeded, terrainHeight } from "./math";
import { earthBillboard, regolithTexture } from "./textures";

/** Sun direction (pointing FROM the sun): front-right, fairly low — long hard shadows. */
export const SUN_POSITION = new THREE.Vector3(620, 330, -560);
export const SHADOW_MAP_SIZE = 2048;

interface Beacon {
  mat: THREE.MeshStandardMaterial;
  phase: number;
  period: number;
}

export class World {
  readonly group = new THREE.Group();
  readonly sun: THREE.DirectionalLight;
  private readonly beacons: Beacon[] = [];
  private earth: THREE.Mesh | null = null;
  private readonly textures: THREE.Texture[] = [];
  private stars: THREE.Points | null = null;
  private shipLights: THREE.MeshStandardMaterial | null = null;
  private shipGlint: THREE.MeshBasicMaterial | null = null;
  /** Set to 1 when the fleet fires — the battleship's bow flashes. */
  glint = 0;

  constructor(scene: THREE.Scene) {
    scene.add(this.group);

    /* ---- lights ---- */
    this.sun = new THREE.DirectionalLight(0xfff3e2, 2.7);
    this.sun.position.copy(SUN_POSITION);
    this.sun.target.position.set(0, 0, -160);
    this.sun.castShadow = true;
    this.sun.shadow.mapSize.set(SHADOW_MAP_SIZE, SHADOW_MAP_SIZE);
    const sc = this.sun.shadow.camera;
    sc.left = -420;
    sc.right = 420;
    sc.top = 420;
    sc.bottom = -420;
    sc.near = 200;
    sc.far = 1800;
    this.sun.shadow.bias = -0.0006;
    this.sun.shadow.normalBias = 0.6;
    this.sun.shadow.radius = 1;
    this.group.add(this.sun, this.sun.target);

    // Earthshine: cold blue from above-left, almost nothing from below.
    const earthshine = new THREE.HemisphereLight(0x4a6a9c, 0x0a0a0c, 0.22);
    this.group.add(earthshine);
    this.group.add(new THREE.AmbientLight(0x1b1f2a, 0.35));

    this.buildTerrain();
    this.buildStars();
    this.buildEarth();
    this.buildBase();
    this.buildBattleship();
  }

  /** Allied battleship parked high in the sky, off to the left. Dark hull, running lights — scenery. */
  private buildBattleship(): void {
    const hull = new THREE.MeshStandardMaterial({ color: 0x1a1d22, roughness: 0.7, metalness: 0.6 });
    const trim = new THREE.MeshStandardMaterial({ color: 0x2b2f36, roughness: 0.6, metalness: 0.7 });
    this.shipLights = new THREE.MeshStandardMaterial({ color: 0x111111, emissive: 0xbfd8ff, emissiveIntensity: 2 });
    const b = new PartBuilder();
    b.wedge(60, 34, 420, 0.75, 0, 0, 0, "hull", [0, 0, Math.PI / 2]); // main hull, wedge nose
    b.box(40, 22, 180, 0, 26, -20, "trim"); // superstructure
    b.box(16, 30, 40, 0, 46, -60, "trim"); // bridge tower
    b.box(90, 6, 60, 0, -6, 60, "trim"); // wing sponsons
    b.box(90, 6, 60, 0, -6, -140, "trim");
    b.cyl(2, 2, 60, 8, 0, 70, -60, "trim"); // mast
    b.cyl(6, 6, 120, 16, -22, 10, 130, "hull", [Math.PI / 2, 0, 0]); // twin main guns forward
    b.cyl(6, 6, 120, 16, 22, 10, 130, "hull", [Math.PI / 2, 0, 0]);
    const ship = b.build({ hull, trim }, false);
    // running lights
    const lg = new THREE.SphereGeometry(2.2, 8, 6);
    for (const [x, y, z] of [[-30, 2, 80], [30, 2, 80], [0, 72, -60], [-45, -4, -140], [45, -4, -140], [0, 40, -80]]) {
      const m = new THREE.Mesh(lg, this.shipLights);
      m.position.set(x, y, z);
      ship.add(m);
    }
    this.shipGlint = new THREE.MeshBasicMaterial({ color: 0xffffff, transparent: true, opacity: 0, blending: THREE.AdditiveBlending, depthWrite: false });
    const glint = new THREE.Mesh(new THREE.PlaneGeometry(120, 120), this.shipGlint);
    glint.position.set(0, 10, 190);
    glint.name = "glint";
    ship.add(glint);
    const bearing = -19 * DEG;
    const elev = 24 * DEG;
    const dist = 3400;
    ship.position.set(Math.sin(bearing) * Math.cos(elev) * dist, Math.sin(elev) * dist, -Math.cos(bearing) * Math.cos(elev) * dist);
    ship.rotation.set(0.1, 0.9, 0.05);
    ship.frustumCulled = false;
    this.group.add(ship);
  }

  private buildTerrain(): void {
    const seg = 170;
    const geo = new THREE.PlaneGeometry(TERRAIN_SIZE, TERRAIN_SIZE, seg, seg);
    geo.rotateX(-Math.PI / 2);
    const pos = geo.attributes.position as THREE.BufferAttribute;
    for (let i = 0; i < pos.count; i++) {
      const x = pos.getX(i);
      const z = pos.getZ(i);
      pos.setY(i, terrainHeight(x, z));
    }
    geo.computeVertexNormals();
    const { map, bump } = regolithTexture();
    this.textures.push(map, bump);
    const mat = new THREE.MeshStandardMaterial({
      color: 0x7e7c78,
      map,
      bumpMap: bump,
      bumpScale: 1.4,
      roughness: 0.96,
      metalness: 0.02,
    });
    const mesh = new THREE.Mesh(geo, mat);
    mesh.receiveShadow = true;
    mesh.name = "regolith";
    this.group.add(mesh);
  }

  private buildStars(): void {
    const n = 2600;
    const rnd = seeded(4242);
    const positions = new Float32Array(n * 3);
    const colors = new Float32Array(n * 3);
    const R = 5200;
    for (let i = 0; i < n; i++) {
      // Uniform on the upper hemisphere (+ a bit below the horizon for parallax when the frame rolls).
      const u = rnd();
      const v = rnd() * 0.92 + 0.04;
      const theta = u * Math.PI * 2;
      const phi = Math.acos(1 - v);
      const y = Math.cos(phi) * R;
      const r = Math.sin(phi) * R;
      positions[i * 3] = Math.cos(theta) * r;
      positions[i * 3 + 1] = y - 300;
      positions[i * 3 + 2] = Math.sin(theta) * r;
      const mag = Math.pow(rnd(), 3);
      const tint = rnd();
      const b = 0.25 + mag * 0.75;
      colors[i * 3] = b * (tint < 0.2 ? 1 : tint > 0.85 ? 0.85 : 0.95);
      colors[i * 3 + 1] = b * (tint < 0.2 ? 0.9 : 0.95);
      colors[i * 3 + 2] = b * (tint < 0.2 ? 0.8 : tint > 0.85 ? 1 : 0.98);
    }
    const geo = new THREE.BufferGeometry();
    geo.setAttribute("position", new THREE.BufferAttribute(positions, 3));
    geo.setAttribute("color", new THREE.BufferAttribute(colors, 3));
    const mat = new THREE.PointsMaterial({ size: 1.8, sizeAttenuation: false, vertexColors: true, transparent: true, opacity: 0.95, depthWrite: false });
    this.stars = new THREE.Points(geo, mat);
    this.stars.frustumCulled = false;
    this.group.add(this.stars);
  }

  private buildEarth(): void {
    const tex = earthBillboard();
    this.textures.push(tex);
    const mat = new THREE.MeshBasicMaterial({ map: tex, transparent: true, depthWrite: false, toneMapped: true });
    const size = 640;
    const geo = new THREE.PlaneGeometry(size, size);
    const mesh = new THREE.Mesh(geo, mat);
    const bearing = -21 * DEG;
    const elev = 19 * DEG;
    const dist = 4600;
    mesh.position.set(Math.sin(bearing) * Math.cos(elev) * dist, Math.sin(elev) * dist, -Math.cos(bearing) * Math.cos(elev) * dist);
    mesh.lookAt(0, 11, 0);
    mesh.frustumCulled = false;
    this.earth = mesh;
    this.group.add(mesh);
  }

  private buildBase(): void {
    const dark = new THREE.MeshStandardMaterial({ color: 0x3d3f42, roughness: 0.85, metalness: 0.35 });
    const panel = new THREE.MeshStandardMaterial({ color: 0x5a5c5e, roughness: 0.7, metalness: 0.5 });
    const b = new PartBuilder();
    // A cluster of hab modules, a dome, a landing gantry and antenna masts.
    b.dome(26, 18, 0, 0, 0, "panel");
    b.cyl(14, 14, 10, 12, 44, 5, 8, "dark");
    b.cyl(14, 14, 10, 12, 44, 5, -26, "dark");
    b.box(60, 8, 12, 44, 4, -9, "dark");
    b.box(18, 30, 18, -46, 15, 6, "panel");
    b.box(90, 3, 3, 10, 34, 12, "dark");
    b.cyl(1.2, 1.6, 62, 6, -70, 31, -18, "dark");
    b.cyl(0.8, 1.2, 48, 6, 78, 24, 10, "dark");
    b.box(30, 1.5, 30, -70, 60, -18, "panel");
    b.cyl(2, 2, 30, 8, 20, 15, 30, "dark");
    b.box(40, 2, 40, 20, 30, 30, "panel");
    const base = b.build({ dark, panel });
    const bearing = 24 * DEG;
    const dist = 1080;
    const x = Math.sin(bearing) * dist;
    const z = -Math.cos(bearing) * dist;
    base.position.set(x, terrainHeight(x, z) - 2, z);
    base.rotation.y = -0.4;
    base.traverse((o) => {
      o.castShadow = false;
      o.receiveShadow = false;
    });
    this.group.add(base);

    // Blinking beacons: one material each so they can pulse independently.
    const beaconSpots: Array<[number, number, number, number]> = [
      [-70, 63, -18, 0xff3a2a],
      [78, 49, 10, 0xff3a2a],
      [0, 27, 0, 0xffffff],
      [44, 11, 8, 0xffb43d],
      [-46, 31, 6, 0xff3a2a],
    ];
    const geo = new THREE.SphereGeometry(1.6, 8, 6);
    beaconSpots.forEach(([bx, by, bz, color], i) => {
      const mat = new THREE.MeshStandardMaterial({ color: 0x111111, emissive: color, emissiveIntensity: 2 });
      const m = new THREE.Mesh(geo, mat);
      m.position.set(bx, by, bz);
      base.add(m);
      this.beacons.push({ mat, phase: i * 0.7, period: 1.3 + i * 0.35 });
    });
  }

  update(time: number, camera: THREE.Camera): void {
    for (const b of this.beacons) {
      const on = ((time + b.phase) % b.period) < 0.14;
      b.mat.emissiveIntensity = on ? 3.2 : 0.08;
    }
    if (this.earth) this.earth.lookAt(camera.position);
    if (this.shipLights) this.shipLights.emissiveIntensity = (time % 1.6) < 0.12 ? 4 : 1.2;
    if (this.shipGlint) {
      this.glint = Math.max(0, this.glint - 0.6 / 60);
      this.shipGlint.opacity = this.glint * 0.9;
    }
  }

  dispose(): void {
    disposeTree(this.group, true);
    for (const t of this.textures) t.dispose();
  }
}
