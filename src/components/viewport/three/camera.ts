/**
 * Camera rig. The horizontal FOV is chosen so bearing ±35° lands exactly on
 * the horizontal diameter of the circular canopy aperture, and the projection
 * is shifted so bearing 0 sits on the aperture centre even when the aperture
 * is not the canvas centre.
 *
 * A useful consequence: at any view-space depth `d` the aperture circle has
 * world radius `d * tan(35°)` — so camera-parented cockpit geometry never
 * needs rebuilding on resize.
 */
import * as THREE from "three";
import type { Aperture } from "@/components/cockpit/layout";
import { DEG, EYE_Y, TAN_APERTURE, clamp } from "./math";

export const CAMERA_NEAR = 0.08;
export const CAMERA_FAR = 6000;

export class CameraRig {
  readonly camera: THREE.PerspectiveCamera;
  /** Focal length in CSS px — px per unit of tan(angle). */
  focalPx = 500;
  width = 1;
  height = 1;
  aperture: Aperture = { cx: 0.5, cy: 0.5, r: 0.5 };

  /* dynamics */
  shake = 0;
  private time = 0;
  private roll = 0;
  private rollTarget = 0;
  private dip = 0;
  private headingRad = 0;
  private turnBank = 0;
  private quakeAmp = 0;
  private quakeLeft = 0;
  private quakeTotal = 1;

  constructor() {
    this.camera = new THREE.PerspectiveCamera(60, 1, CAMERA_NEAR, CAMERA_FAR);
    this.camera.position.set(0, EYE_Y, 0);
    this.camera.rotation.order = "YXZ";
  }

  fit(width: number, height: number, aperture: Aperture): void {
    this.width = Math.max(1, width);
    this.height = Math.max(1, height);
    this.aperture = aperture;
    this.focalPx = aperture.r / TAN_APERTURE;
    const vFov = 2 * Math.atan(this.height / 2 / this.focalPx);
    this.camera.fov = vFov / DEG;
    this.camera.aspect = this.width / this.height;
    // Shift the projection so the optical axis pierces the aperture centre.
    const ox = this.width / 2 - aperture.cx;
    const oy = this.height / 2 - aperture.cy;
    if (Math.abs(ox) > 0.5 || Math.abs(oy) > 0.5) {
      this.camera.setViewOffset(this.width, this.height, ox, oy, this.width, this.height);
    } else {
      this.camera.clearViewOffset();
    }
    this.camera.updateProjectionMatrix();
  }

  /** World radius of the aperture circle at view depth `d` (camera-parented geometry). */
  apertureRadiusAt(d: number): number {
    return d * TAN_APERTURE;
  }

  /**
   * Camera-space position that lands at screen fraction (fx, fy) of the
   * aperture radius (fx=+1 right rim, fy=+1 top rim) at view depth `d`.
   */
  atScreen(fx: number, fy: number, d: number, out: THREE.Vector3): THREE.Vector3 {
    const R = d * TAN_APERTURE;
    return out.set(fx * R, fy * R, -d);
  }

  kick(intensity: number): void {
    this.shake = Math.min(1, this.shake + clamp(intensity, 0, 1));
  }
  /** Quick bank for EVADE. */
  bank(dir: number): void {
    this.rollTarget = dir * 0.09;
  }
  /** Nose dip for BOOST. */
  lurch(): void {
    this.dip = 1;
  }
  /** Sustained heavy shake (nuke): `amp` 0..1 decaying over `seconds`. */
  quake(amp: number, seconds: number): void {
    this.quakeAmp = clamp(amp, 0, 1);
    this.quakeLeft = seconds;
    this.quakeTotal = seconds;
  }
  /** `player:turned` — bank 2–3° into the turn while the heading sweeps. */
  turned(deltaDeg: number): void {
    if (!deltaDeg) return;
    this.turnBank = clamp(-deltaDeg / 30, -1, 1) * 0.05;
  }

  update(dt: number, headingDeg: number, lowHp: boolean): void {
    this.time += dt;
    const t = this.time;
    this.shake = Math.max(0, this.shake - dt / 0.55);
    this.rollTarget *= Math.exp(-dt * 2.2);
    this.roll += (this.rollTarget - this.roll) * (1 - Math.exp(-dt * 6));
    this.dip = Math.max(0, this.dip - dt / 0.9);
    // Heading eases toward the store value over ~150 ms so a 30° voice turn sweeps instead of snapping.
    this.headingRad += (-headingDeg * DEG - this.headingRad) * (1 - Math.exp(-dt * 14));
    this.turnBank *= Math.exp(-dt * 3.5);

    // Subtle idle sway — the frame is a walking machine, never perfectly still.
    const swayAmp = lowHp ? 1.6 : 1;
    const swayX = Math.sin(t * 0.61) * 0.0035 * swayAmp + Math.sin(t * 1.7) * 0.0012;
    const swayZ = Math.sin(t * 0.43 + 1) * 0.0028 * swayAmp;
    const bobY = Math.sin(t * 1.25) * 0.05 * swayAmp;

    if (this.quakeLeft > 0) {
      this.quakeLeft = Math.max(0, this.quakeLeft - dt);
      const q = this.quakeAmp * (this.quakeLeft / this.quakeTotal);
      this.shake = Math.max(this.shake, q);
    }
    const s = this.shake * this.shake;
    const jx = s ? (Math.random() - 0.5) * 0.05 * s : 0;
    const jy = s ? (Math.random() - 0.5) * 0.05 * s : 0;
    const jr = s ? (Math.random() - 0.5) * 0.02 * s : 0;

    const cam = this.camera;
    cam.position.set(jx, EYE_Y + bobY + jy - this.dip * 0.35, 0);
    cam.rotation.set(swayX + jr * 0.6 - this.dip * 0.03, this.headingRad, swayZ + this.roll + this.turnBank + jr);
  }

  /** Project a world point to CSS px. Returns false if behind the camera. */
  project(world: THREE.Vector3, out: { x: number; y: number; depth: number }, tmp: THREE.Vector3): boolean {
    tmp.copy(world).project(this.camera);
    out.x = (tmp.x + 1) * 0.5 * this.width;
    out.y = (1 - tmp.y) * 0.5 * this.height;
    out.depth = tmp.z;
    return tmp.z < 1 && tmp.z > -1;
  }
}
