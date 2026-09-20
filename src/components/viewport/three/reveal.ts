/**
 * The hangar reveal scene for MechReveal: dark lunar bay, floodlights,
 * gantries, drifting mist, the full AETHER FRAME, and a scripted ~6 s camera.
 */
import * as THREE from "three";
import { EffectComposer } from "three/examples/jsm/postprocessing/EffectComposer.js";
import { RenderPass } from "three/examples/jsm/postprocessing/RenderPass.js";
import { UnrealBloomPass } from "three/examples/jsm/postprocessing/UnrealBloomPass.js";
import { OutputPass } from "three/examples/jsm/postprocessing/OutputPass.js";
import { SMAAPass } from "three/examples/jsm/postprocessing/SMAAPass.js";
import { RoomEnvironment } from "three/examples/jsm/environments/RoomEnvironment.js";
import { buildHero, disposeRig } from "./mechs";
import { PartBuilder, disposeTree } from "./parts";
import { ParticlePool } from "./particles";
import { cockpitMetalTexture, softDotTexture } from "./textures";
import { clamp, lerp, seeded, smoothstep } from "./math";

export const REVEAL_DURATION_S = 6.2;
const MAX_PIXEL_RATIO = 2;

export interface RevealScene {
  dispose(): void;
}

function hangarFloorTexture(size = 512): THREE.CanvasTexture {
  const canvas = document.createElement("canvas");
  canvas.width = size;
  canvas.height = size;
  const ctx = canvas.getContext("2d");
  if (!ctx) throw new Error("2d context unavailable");
  const rnd = seeded(31);
  ctx.fillStyle = "#3b3d40";
  ctx.fillRect(0, 0, size, size);
  for (let i = 0; i < 4000; i++) {
    ctx.fillStyle = rnd() < 0.5 ? `rgba(0,0,0,${rnd() * 0.2})` : `rgba(255,255,255,${rnd() * 0.05})`;
    ctx.fillRect(rnd() * size, rnd() * size, 1 + rnd() * 3, 1 + rnd() * 3);
  }
  ctx.strokeStyle = "rgba(0,0,0,0.55)";
  ctx.lineWidth = 3;
  for (let i = 0; i <= 4; i++) {
    const p = (i / 4) * size;
    ctx.beginPath();
    ctx.moveTo(p, 0);
    ctx.lineTo(p, size);
    ctx.moveTo(0, p);
    ctx.lineTo(size, p);
    ctx.stroke();
  }
  ctx.strokeStyle = "rgba(220,180,40,0.75)";
  ctx.lineWidth = 6;
  ctx.setLineDash([40, 24]);
  ctx.strokeRect(size * 0.08, size * 0.08, size * 0.84, size * 0.84);
  const tex = new THREE.CanvasTexture(canvas);
  tex.wrapS = THREE.RepeatWrapping;
  tex.wrapT = THREE.RepeatWrapping;
  tex.repeat.set(6, 6);
  tex.colorSpace = THREE.SRGBColorSpace;
  tex.anisotropy = 4;
  return tex;
}

export interface RevealOptions {
  /** Debug: hold the timeline at this second instead of playing (never fires onDone). */
  freezeAt?: number;
}

export function createRevealScene(container: HTMLElement, onDone: () => void, opts: RevealOptions = {}): RevealScene {
  const canvas = document.createElement("canvas");
  canvas.style.cssText = "position:absolute;inset:0;width:100%;height:100%;display:block;";
  const renderer = new THREE.WebGLRenderer({ canvas, antialias: true, powerPreference: "high-performance" });
  renderer.shadowMap.enabled = true;
  renderer.shadowMap.type = THREE.PCFSoftShadowMap;
  renderer.toneMapping = THREE.ACESFilmicToneMapping;
  renderer.toneMappingExposure = 1.0;
  container.appendChild(canvas);
  const fade = document.createElement("div");
  fade.style.cssText = "position:absolute;inset:0;background:#000;opacity:1;pointer-events:none;transition:none;";
  container.appendChild(fade);

  const scene = new THREE.Scene();
  scene.background = new THREE.Color(0x020304);
  scene.fog = new THREE.FogExp2(0x05060a, 0.006);
  const camera = new THREE.PerspectiveCamera(42, 1, 0.1, 800);
  const pmrem = new THREE.PMREMGenerator(renderer);
  const envTex = pmrem.fromScene(new RoomEnvironment(), 0.04).texture;
  pmrem.dispose();
  scene.environment = envTex;
  scene.environmentIntensity = 0.18;

  const disposables: Array<{ dispose(): void }> = [envTex];

  /* ---- hero ---- */
  const hero = buildHero();
  hero.root.position.set(0, 0, 0);
  hero.root.rotation.y = 0.15;
  scene.add(hero.root);
  // Soft round lens glow over the eyes while they ignite (stretched horizontally like an anamorphic flare).
  const flareTex = softDotTexture(128);
  const eyeFlare = new THREE.Mesh(
    new THREE.PlaneGeometry(1, 1),
    new THREE.MeshBasicMaterial({ color: 0x9fffc8, map: flareTex, transparent: true, opacity: 0, blending: THREE.AdditiveBlending, depthWrite: false, depthTest: false }),
  );
  eyeFlare.renderOrder = 20;
  scene.add(eyeFlare);
  disposables.push(eyeFlare.geometry, eyeFlare.material as THREE.Material, flareTex);

  /* ---- hangar ---- */
  const floorTex = hangarFloorTexture();
  const { map: metalMap, rough: metalRough } = cockpitMetalTexture();
  disposables.push(floorTex, metalMap, metalRough);
  const floorMat = new THREE.MeshStandardMaterial({ map: floorTex, color: 0x9a9a9a, roughness: 0.8, metalness: 0.25 });
  const floor = new THREE.Mesh(new THREE.PlaneGeometry(400, 400), floorMat);
  floor.rotation.x = -Math.PI / 2;
  floor.receiveShadow = true;
  scene.add(floor);
  disposables.push(floorMat, floor.geometry);

  const steel = new THREE.MeshStandardMaterial({ color: 0x6a6e74, map: metalMap, roughnessMap: metalRough, roughness: 0.6, metalness: 0.7 });
  const dark = new THREE.MeshStandardMaterial({ color: 0x1e2024, roughness: 0.9, metalness: 0.3 });
  const hazard = new THREE.MeshStandardMaterial({ color: 0xc9a227, roughness: 0.7 });
  disposables.push(steel, dark, hazard);
  const b = new PartBuilder();
  // back wall + side walls
  b.box(160, 70, 4, 0, 35, -50, "dark");
  b.box(4, 70, 140, -80, 35, 0, "dark");
  b.box(4, 70, 140, 80, 35, 0, "dark");
  // ceiling beams
  for (let i = -3; i <= 3; i++) b.box(160, 2.5, 2.5, 0, 62, i * 18, "steel");
  b.box(3, 3, 140, -30, 63, 0, "steel");
  b.box(3, 3, 140, 30, 63, 0, "steel");
  // gantry platforms at shoulder height on both sides, with rails and hazard edges
  for (const s of [-1, 1]) {
    b.box(14, 1, 40, s * 22, 20, 0, "steel");
    b.box(14, 0.3, 40, s * 22, 20.6, 0, "hazard");
    b.box(0.4, 3, 40, s * 15.2, 22, 0, "steel");
    for (let k = -2; k <= 2; k++) b.box(0.4, 3, 0.4, s * 15.2, 22, k * 9, "steel");
    for (let k = -1; k <= 1; k++) b.box(2, 20, 2, s * 28, 10, k * 18, "steel");
    b.box(2, 1, 60, s * 28, 30, 0, "steel");
  }
  // rear maintenance crane
  b.box(70, 3, 3, 0, 52, -30, "steel");
  b.box(3, 3, 30, 0, 52, -20, "steel");
  b.cyl(0.3, 0.3, 24, 6, 0, 40, -6, "dark");
  b.box(4, 2, 4, 0, 28, -6, "hazard");
  // floor clamps around the feet
  for (const s of [-1, 1]) {
    b.box(6, 2.4, 9, s * 4.2, 1.2, 1, "steel");
    b.box(6.2, 0.3, 9.2, s * 4.2, 2.5, 1, "hazard");
  }
  const hangar = b.build({ steel, dark, hazard });
  scene.add(hangar);

  /* ---- lights ---- */
  scene.add(new THREE.AmbientLight(0x243040, 0.6));
  const hemi = new THREE.HemisphereLight(0x5b6b80, 0x101214, 0.4);
  scene.add(hemi);
  const key = new THREE.SpotLight(0xfff0dc, 14000, 260, 0.45, 0.55, 2);
  key.position.set(-40, 62, 55);
  key.target.position.set(0, 14, 0);
  key.castShadow = true;
  key.shadow.mapSize.set(2048, 2048);
  key.shadow.bias = -0.0004;
  key.shadow.normalBias = 0.4;
  scene.add(key, key.target);
  const fill = new THREE.SpotLight(0xbfd0ff, 6000, 260, 0.55, 0.7, 2);
  fill.position.set(48, 58, 40);
  fill.target.position.set(0, 12, 0);
  scene.add(fill, fill.target);
  const rim = new THREE.SpotLight(0xffd9b0, 5000, 260, 0.5, 0.8, 2);
  rim.position.set(10, 50, -40);
  rim.target.position.set(0, 16, 0);
  scene.add(rim, rim.target);
  // floodlight housings
  const fb = new PartBuilder();
  for (const l of [key, fill, rim]) fb.box(4, 3, 4, l.position.x, l.position.y, l.position.z, "dark");
  const lampMat = new THREE.MeshStandardMaterial({ color: 0xffffff, emissive: 0xfff2dc, emissiveIntensity: 6 });
  disposables.push(lampMat);
  for (const l of [key, fill, rim]) {
    const lens = new THREE.Mesh(new THREE.CircleGeometry(1.6, 16), lampMat);
    lens.position.copy(l.position);
    lens.lookAt(l.target.position);
    lens.translateZ(2.1);
    scene.add(lens);
    disposables.push(lens.geometry);
  }
  scene.add(fb.build({ dark }, false));

  /* ---- mist ---- */
  const mist = new ParticlePool(220, false);
  scene.add(mist.points);
  const rnd = seeded(7);
  for (let i = 0; i < 200; i++) {
    mist.spawn((rnd() - 0.5) * 120, rnd() * 6, (rnd() - 0.5) * 100, (rnd() - 0.5) * 0.8, 0.05, (rnd() - 0.5) * 0.8, { life: 40 + rnd() * 20, size: 14 + rnd() * 18, r: 0.35, g: 0.38, b: 0.45, alpha: 0.16, grow: 1.2 });
  }

  /* ---- post ---- */
  const composer = new EffectComposer(renderer);
  composer.addPass(new RenderPass(scene, camera));
  const bloom = new UnrealBloomPass(new THREE.Vector2(1, 1), 0.55, 0.6, 0.85);
  composer.addPass(bloom);
  composer.addPass(new OutputPass());
  composer.addPass(new SMAAPass());

  let width = 1;
  let height = 1;
  function resize(w: number, h: number): void {
    width = Math.max(1, Math.floor(w));
    height = Math.max(1, Math.floor(h));
    const dpr = Math.min(MAX_PIXEL_RATIO, window.devicePixelRatio || 1);
    renderer.setPixelRatio(dpr);
    renderer.setSize(width, height, false);
    composer.setPixelRatio(dpr);
    composer.setSize(width, height);
    bloom.resolution.set(width, height);
    camera.aspect = width / height;
    camera.updateProjectionMatrix();
    mist.setPixelScale(height / 2 / Math.tan((camera.fov / 2) * (Math.PI / 180)), dpr);
  }
  const ro = new ResizeObserver((entries) => {
    for (const e of entries) resize(e.contentRect.width, e.contentRect.height);
  });
  ro.observe(container);
  resize(container.clientWidth || 1, container.clientHeight || 1);

  /* ---- camera script ---- */
  const H = hero.height; // ~26
  const headY = H - 3.2;
  const eyeWorld = new THREE.Vector3();
  const hatchWorld = new THREE.Vector3();
  const camPos = new THREE.Vector3();
  const look = new THREE.Vector3();
  const tmp = new THREE.Vector3();
  const tmp2 = new THREE.Vector3();

  function orbit(angle: number, radius: number, y: number, out: THREE.Vector3): THREE.Vector3 {
    return out.set(Math.sin(angle) * radius, y, Math.cos(angle) * radius);
  }

  function script(t: number): void {
    hero.root.updateMatrixWorld();
    hero.head.getWorldPosition(eyeWorld).add(tmp.set(0, 1.3, 1.7));
    hero.hatchPoint.getWorldPosition(hatchWorld);

    // 0.0–1.9  feet, tilt up the body
    // 1.9–4.0  orbit from the rifle side across the front to the shield side, rising to the face
    // 4.0–5.4  push toward the chest hatch as it opens
    // 5.4–6.2  fade to black
    if (t < 1.9) {
      const k = smoothstep(0, 1.9, t);
      camPos.set(lerp(9, 12, k), lerp(1.8, 9, k), lerp(24, 30, k));
      look.set(0, lerp(1.5, H * 0.5, k), 0);
    } else if (t < 4.0) {
      const k = smoothstep(1.9, 4.0, t);
      const ang = lerp(0.55, -0.5, k);
      orbit(ang, lerp(38, 30, k), lerp(12, headY + 2, k), camPos);
      look.set(0, lerp(H * 0.5, headY - 1, k), 0);
      tmp2.set(0, H * 0.72, 0);
    } else if (t < 5.4) {
      const k = smoothstep(4.0, 5.4, t);
      orbit(-0.5, 30, headY + 2, tmp);
      camPos.lerpVectors(tmp, tmp2.copy(hatchWorld).add(tmp2.set(0, 0.2, 2.2)), k * k);
      look.lerpVectors(tmp.set(0, headY, 0), hatchWorld, Math.min(1, k * 1.4));
    } else {
      camPos.copy(hatchWorld).add(tmp.set(0, 0.1, 1.0));
      look.copy(hatchWorld);
    }
    // subtle handheld drift
    camPos.x += Math.sin(t * 1.3) * 0.12;
    camPos.y += Math.sin(t * 0.9) * 0.08;
    camera.position.copy(camPos);
    camera.lookAt(look);
    camera.fov = t > 4.0 ? lerp(42, 34, smoothstep(4.0, 5.6, t)) : 42;
    camera.updateProjectionMatrix();

    // Eyes ignite 3.1–3.8 s with a bloom flare.
    const ignite = smoothstep(3.1, 3.8, t);
    const flash = Math.sin(clamp((t - 3.3) / 0.5, 0, 1) * Math.PI);
    hero.eyeMat.emissiveIntensity = ignite * 4 + flash * 8;
    eyeFlare.position.copy(eyeWorld);
    eyeFlare.lookAt(camera.position);
    const flareSize = 0.5 + flash * 3.5;
    eyeFlare.scale.set(flareSize * 3.2, flareSize * 1.1, 1);
    (eyeFlare.material as THREE.MeshBasicMaterial).opacity = flash * 0.85;

    // Hatch swings open 4.3–5.0 s.
    hero.hatch.rotation.x = -smoothstep(4.3, 5.0, t) * 1.7;

    // Fade in over the first 0.6 s, out over the last 0.7 s.
    const fadeIn = 1 - smoothstep(0, 0.6, t);
    const fadeOut = smoothstep(5.5, 6.15, t);
    fade.style.opacity = String(Math.max(fadeIn, fadeOut));
  }

  /* ---- loop ---- */
  let raf = 0;
  let start = -1;
  let disposed = false;
  let finished = false;
  function frame(now: number): void {
    if (disposed) return;
    if (start < 0) start = now;
    const t = opts.freezeAt !== undefined ? opts.freezeAt : (now - start) / 1000;
    if (t >= REVEAL_DURATION_S) {
      if (!finished) {
        finished = true;
        onDone();
      }
      return;
    }
    raf = requestAnimationFrame(frame);
    try {
      script(t);
      mist.update(1 / 60);
      composer.render();
    } catch (err) {
      console.error("[reveal] frame failed", err);
      if (!finished) {
        finished = true;
        cancelAnimationFrame(raf);
        onDone();
      }
    }
  }
  raf = requestAnimationFrame(frame);

  return {
    dispose() {
      if (disposed) return;
      disposed = true;
      cancelAnimationFrame(raf);
      ro.disconnect();
      disposeRig(hero);
      disposeTree(hangar, false);
      mist.dispose();
      for (const d of disposables) d.dispose();
      composer.dispose();
      bloom.dispose();
      renderer.dispose();
      renderer.forceContextLoss();
      canvas.remove();
      fade.remove();
    },
  };
}
