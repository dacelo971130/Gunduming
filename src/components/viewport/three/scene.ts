/**
 * Orchestrates the WebGL battle viewport: renderer + post chain, world,
 * cockpit, ECHO-01, enemies, FX, overlay, bus wiring and the frame loop.
 * Reads `game.get()` imperatively every frame — React never re-renders for it.
 */
import * as THREE from "three";
import { EffectComposer } from "three/examples/jsm/postprocessing/EffectComposer.js";
import { RenderPass } from "three/examples/jsm/postprocessing/RenderPass.js";
import { UnrealBloomPass } from "three/examples/jsm/postprocessing/UnrealBloomPass.js";
import { ShaderPass } from "three/examples/jsm/postprocessing/ShaderPass.js";
import { OutputPass } from "three/examples/jsm/postprocessing/OutputPass.js";
import { SMAAPass } from "three/examples/jsm/postprocessing/SMAAPass.js";
import { RoomEnvironment } from "three/examples/jsm/environments/RoomEnvironment.js";
import { canopyAperture } from "@/components/cockpit/layout";
import { game } from "@/game/store";
import { bus } from "@/lib/bus";
import type { Enemy, WeaponId } from "@/game/types";
import { CameraRig } from "./camera";
import { World } from "./world";
import { CockpitRig } from "./cockpit";
import { Echo01 } from "./echo";
import { EnemyTemplates, EnemyView } from "./enemies";
import { FxSystem } from "./fx";
import { CRIMSON_COLOR, MANTIS_COLOR, Overlay, type EdgeArrow, type FleetMark, type Tag } from "./overlay";
import { APERTURE_HALF_DEG, DEG, clamp, terrainHeight } from "./math";

/** Clamp big pauses (tab switches) so physics never jumps; generous enough that a slow GPU does not run in slow motion. */
const MAX_DT = 1 / 12;
const MAX_PIXEL_RATIO = 2;
/** Consecutive failed frames before we give up and hand over to the legacy renderer. */
const FATAL_FRAME_FAILURES = 30;

const GRAIN_SHADER = {
  uniforms: { tDiffuse: { value: null }, time: { value: 0 }, grain: { value: 0.035 }, vignette: { value: 0.35 } },
  vertexShader: /* glsl */ `
    varying vec2 vUv;
    void main() { vUv = uv; gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0); }`,
  fragmentShader: /* glsl */ `
    uniform sampler2D tDiffuse; uniform float time; uniform float grain; uniform float vignette;
    varying vec2 vUv;
    float hash(vec2 p) { return fract(sin(dot(p, vec2(12.9898, 78.233)) + time) * 43758.5453); }
    void main() {
      vec4 c = texture2D(tDiffuse, vUv);
      float n = hash(vUv * vec2(1917.0, 1077.0)) - 0.5;
      c.rgb += n * grain * (0.35 + c.rgb);
      float d = distance(vUv, vec2(0.5));
      c.rgb *= 1.0 - smoothstep(0.4, 0.95, d) * vignette;
      gl_FragColor = c;
    }`,
};

export interface BattleScene {
  dispose(): void;
}

interface Scheduled {
  at: number;
  fn: () => void;
}

export function createBattleScene(container: HTMLElement, onFatal: (err: unknown) => void): BattleScene {
  /* ------------------------------------------------------------ renderer */
  const canvas = document.createElement("canvas");
  canvas.style.cssText = "position:absolute;inset:0;width:100%;height:100%;display:block;";
  const renderer = new THREE.WebGLRenderer({ canvas, antialias: true, powerPreference: "high-performance", alpha: false, stencil: false });
  renderer.shadowMap.enabled = true;
  renderer.shadowMap.type = THREE.PCFShadowMap;
  renderer.toneMapping = THREE.ACESFilmicToneMapping;
  renderer.toneMappingExposure = 1.05;
  renderer.setClearColor(0x000000, 1);

  const scene = new THREE.Scene();
  scene.background = new THREE.Color(0x000000);
  const rig = new CameraRig();
  scene.add(rig.camera);

  // Neutral studio environment at low intensity gives the glass, clearcoat and steel something to reflect.
  const pmrem = new THREE.PMREMGenerator(renderer);
  const envTex = pmrem.fromScene(new RoomEnvironment(), 0.04).texture;
  pmrem.dispose();
  scene.environment = envTex;
  scene.environmentIntensity = 0.22;

  const world = new World(scene);
  const templates = new EnemyTemplates();
  const cockpit = new CockpitRig(rig);
  const echo = new Echo01(rig);
  const fx = new FxSystem(scene, rig.camera);
  const overlay = new Overlay();
  container.appendChild(canvas);
  container.appendChild(overlay.canvas);

  /* -------------------------------------------------------- post chain */
  const composer = new EffectComposer(renderer);
  const renderPass = new RenderPass(scene, rig.camera);
  const bloom = new UnrealBloomPass(new THREE.Vector2(1, 1), 0.32, 0.4, 0.92);
  const grain = new ShaderPass(GRAIN_SHADER);
  const output = new OutputPass();
  const smaa = new SMAAPass();
  composer.addPass(renderPass);
  composer.addPass(bloom);
  composer.addPass(grain);
  composer.addPass(output);
  composer.addPass(smaa);

  /* --------------------------------------------------------------- state */
  const views = new Map<string, EnemyView>();
  const scheduled: Scheduled[] = [];
  const pendingImpact = new Map<string, number>();
  let width = 0;
  let height = 0;
  let dpr = 1;
  let time = 0;
  let lastTargetId: string | null = null;
  let targetLockAt = 0;
  let failures = 0;
  let disposed = false;
  /** Pending fleet support call: shells launch ~1 s before impact so they land on time. */
  let fleet: { targetId: string | null; impactAt: number; launched: boolean; pos: THREE.Vector3 } | null = null;
  const skyColor = new THREE.Color();

  const _p = new THREE.Vector3();
  const _q = new THREE.Vector3();
  const _r = new THREE.Vector3();
  const _dir = new THREE.Vector3();
  const _proj = { x: 0, y: 0, depth: 0 };
  const _proj2 = { x: 0, y: 0, depth: 0 };
  const tags: Tag[] = [];
  const arrows: EdgeArrow[] = [];

  /* -------------------------------------------------------------- resize */
  function resize(w: number, h: number): void {
    width = Math.max(1, Math.floor(w));
    height = Math.max(1, Math.floor(h));
    dpr = Math.min(MAX_PIXEL_RATIO, window.devicePixelRatio || 1);
    renderer.setPixelRatio(dpr);
    renderer.setSize(width, height, false);
    composer.setPixelRatio(dpr);
    composer.setSize(width, height);
    bloom.resolution.set(width, height);
    const aperture = canopyAperture(width, height);
    rig.fit(width, height, aperture);
    overlay.resize(width, height, dpr, aperture);
    fx.setPixelScale(rig.focalPx, dpr);
  }
  const ro = new ResizeObserver((entries) => {
    for (const e of entries) resize(e.contentRect.width, e.contentRect.height);
  });
  ro.observe(container);
  resize(container.clientWidth || 1, container.clientHeight || 1);

  /* ------------------------------------------------------------- helpers */
  function fallbackAim(out: THREE.Vector3): THREE.Vector3 {
    rig.camera.getWorldDirection(_dir);
    return out.copy(rig.camera.position).addScaledVector(_dir, 260).setY(Math.max(terrainHeight(out.x, out.z) + 8, rig.camera.position.y - 2));
  }
  function liveEnemies(): Enemy[] {
    return game.get().enemies.filter((e) => e.state !== "DESTROYED");
  }
  function viewChest(id: string, out: THREE.Vector3): THREE.Vector3 | null {
    const v = views.get(id);
    return v ? v.chestWorld(out) : null;
  }
  function schedule(delay: number, fn: () => void): void {
    if (delay <= 0.01) fn();
    else scheduled.push({ at: time + delay, fn });
  }

  /* ---------------------------------------------------------- bus wiring */
  const offs: Array<() => void> = [];

  offs.push(
    bus.on("fx:fire", ({ targetId, weapon: w }) => {
      const weapon: WeaponId = w ?? game.get().player.weapon;
      cockpit.setWeapon(weapon);
      cockpit.fire(weapon);
      rig.camera.updateMatrixWorld();
      cockpit.muzzleWorld(_p, weapon);
      const targets: Array<{ id: string; pos: THREE.Vector3 }> = [];
      const enemies = liveEnemies();
      const primary = targetId ? enemies.find((e) => e.id === targetId) : undefined;
      if (weapon === "MISSILE") {
        const aimBearing = primary?.bearing ?? 0;
        for (const e of enemies) {
          if (Math.abs(e.bearing - aimBearing) <= 30) {
            const pos = viewChest(e.id, new THREE.Vector3());
            if (pos) targets.push({ id: e.id, pos });
          }
        }
        targets.sort((a, b) => (a.id === targetId ? -1 : b.id === targetId ? 1 : 0));
      } else if (primary) {
        const pos = viewChest(primary.id, new THREE.Vector3());
        // The blade only reaches a target inside its range.
        if (pos && !(weapon === "BLADE" && primary.distance > 260)) targets.push({ id: primary.id, pos });
      }
      const flight = fx.fire(weapon, _p, targets, fallbackAim(_q));
      for (const t of targets) pendingImpact.set(t.id, time + flight);
      rig.kick(weapon === "CANNON" ? 0.4 : weapon === "MISSILE" ? 0.15 : weapon === "BLADE" ? 0.2 : 0.08);
      overlay.reticleOpen = 1;
    }),
  );

  offs.push(
    bus.on("fx:hit", ({ targetId, killed }) => {
      const view = views.get(targetId);
      const enemy = game.get().enemies.find((e) => e.id === targetId);
      const at = pendingImpact.get(targetId);
      const delay = at !== undefined ? clamp(at - time, 0, 1.5) : 0;
      pendingImpact.delete(targetId);
      if (view) view.wreckDelay = killed ? delay : 0;
      const scale = enemy?.kind === "CRIMSON" ? 1.5 : 1;
      const color = enemy?.kind === "CRIMSON" ? 0xff6a7a : 0xffd9a0;
      const captured = view ? view.chestWorld(new THREE.Vector3()) : null;
      schedule(delay, () => {
        const pos = (view && views.has(targetId) ? view.chestWorld(_r) : captured) ?? null;
        if (!pos) return;
        fx.burst(pos, scale * 0.9, color);
        if (killed) {
          fx.explode(pos, scale, terrainHeight(pos.x, pos.z));
          rig.kick(0.45);
          echo.onKill();
        }
      });
    }),
  );

  offs.push(
    bus.on("fx:special", ({ targetId }) => {
      rig.camera.updateMatrixWorld();
      cockpit.muzzleWorld(_p, "RIFLE");
      const to = (targetId && viewChest(targetId, _q)) || fallbackAim(_q);
      fx.beam(_p, to);
      rig.kick(0.35);
      overlay.reticleOpen = 1;
    }),
  );

  offs.push(
    bus.on("fx:playerHit", ({ amount, fromBearing }) => {
      overlay.crack(fromBearing, amount);
      rig.kick(clamp(amount / 22, 0.3, 1));
      echo.onPlayerHit();
      // The unit closest to the reported bearing is the shooter — flash its muzzle.
      let best: EnemyView | null = null;
      let bestD = 999;
      for (const e of liveEnemies()) {
        const d = Math.abs(e.bearing - fromBearing);
        const v = views.get(e.id);
        if (v && d < bestD) {
          bestD = d;
          best = v;
        }
      }
      if (best) {
        best.recoil = 1;
        fx.incoming(best.muzzleWorld(_p));
      }
    }),
  );

  offs.push(
    bus.on("phase:changed", ({ phase }) => {
      if (phase === "BOSS_INTRO") {
        overlay.bossIntro();
        echo.onBossIntro();
        rig.kick(0.3);
      }
    }),
  );

  offs.push(
    bus.on("cmd:executed", ({ command, result }) => {
      if (!result.ok) return;
      if (command.action === "BOOST") {
        rig.lurch();
        const dir = command.direction === "LEFT" ? -1 : command.direction === "RIGHT" ? 1 : 0;
        if (dir) rig.bank(-dir);
        rig.camera.getWorldDirection(_dir);
        const cam = rig.camera.position;
        for (let i = 0; i < 60; i++) {
          fx.smoke.spawn(cam.x + (Math.random() - 0.5) * 14 + _dir.x * 8, 0.5, cam.z + (Math.random() - 0.5) * 14 + _dir.z * 8, (Math.random() - 0.5) * 10, 4 + Math.random() * 8, (Math.random() - 0.5) * 10, { life: 1.4 + Math.random(), size: 3 + Math.random() * 4, r: 0.55, g: 0.53, b: 0.5, drag: 1.5, grow: 3, alpha: 0.5 });
        }
      } else if (command.action === "EVADE") {
        rig.bank(Math.random() < 0.5 ? -1 : 1);
      }
    }),
  );

  offs.push(bus.on("weapon:changed", ({ weapon }) => cockpit.setWeapon(weapon)));

  offs.push(
    bus.on("fx:nuke", ({ targetId, killed }) => {
      const at = (targetId && viewChest(targetId, new THREE.Vector3())) || fallbackAim(new THREE.Vector3());
      fx.nuke(at);
      rig.quake(1, 3);
      for (const id of killed) {
        const v = views.get(id);
        if (v) v.hurl(at);
      }
    }),
  );

  offs.push(
    bus.on("fx:fleetCall", ({ targetId, impactAtMs }) => {
      const pos = (targetId && viewChest(targetId, new THREE.Vector3())) || fallbackAim(new THREE.Vector3());
      fleet = { targetId, impactAt: time + Math.max(0.2, (impactAtMs - Date.now()) / 1000), launched: false, pos };
      world.glint = 1;
    }),
  );

  offs.push(
    bus.on("fx:fleetImpact", ({ targetId, killed }) => {
      // If the shells were never launched (timing drift), land them now.
      const at = fleet?.pos ?? ((targetId && viewChest(targetId, new THREE.Vector3())) || fallbackAim(new THREE.Vector3()));
      let delay = 0;
      if (!fleet || !fleet.launched) delay = fx.fleetStreaks(at);
      else delay = Math.max(0, fleet.impactAt - time);
      for (const id of killed) {
        const v = views.get(id);
        if (v) v.wreckDelay = delay;
      }
      rig.quake(0.6, 1.2);
      fleet = null;
    }),
  );
  // The pilot yawed: enemies keep their (already shifted) relative bearings, the camera sweeps
  // through the fixed world (stars, Earth, base, terrain) and banks slightly into the turn.
  offs.push(bus.on("player:turned", ({ delta }) => rig.turned(delta)));

  /* ----------------------------------------------------------- frame loop */
  let raf = 0;
  let last = performance.now();

  function frame(now: number): void {
    if (disposed) return;
    raf = requestAnimationFrame(frame);
    const dt = clamp((now - last) / 1000, 0, MAX_DT);
    last = now;
    time += dt;
    try {
      render(dt, now);
      failures = 0;
    } catch (err) {
      failures++;
      console.error("[viewport] frame failed", err);
      if (failures >= FATAL_FRAME_FAILURES) {
        cancelAnimationFrame(raf);
        onFatal(err);
      }
    }
  }

  function render(dt: number, now: number): void {
    if (width <= 1 || height <= 1) return;
    const s = game.get();
    const hpFrac = s.player.hp / s.player.maxHp;

    rig.update(dt, s.player.bearing, hpFrac < 0.4);
    rig.camera.updateMatrixWorld();
    if (cockpit.weapon !== s.player.weapon) cockpit.setWeapon(s.player.weapon);
    cockpit.update(dt);
    const locked = s.targetId ? s.enemies.find((e) => e.id === s.targetId) : undefined;
    echo.targetBearing = locked ? locked.bearing : null;
    echo.update(dt, s.aiStatus, hpFrac);
    world.update(time, rig.camera);

    if (s.targetId !== lastTargetId) {
      lastTargetId = s.targetId;
      targetLockAt = time;
    }

    /* ---- enemies ---- */
    const camPos = rig.camera.position;
    for (const enemy of s.enemies) {
      let view = views.get(enemy.id);
      if (!view) {
        view = new EnemyView(enemy, templates);
        views.set(enemy.id, view);
        scene.add(view.root);
      }
      view.burning = (enemy.burningUntil ?? 0) > now && enemy.state !== "DESTROYED";
      view.update(enemy, s.player.bearing, dt, now, camPos);
      if (view.isWreck) fx.wreckSmoke(view.chestWorld(_p), dt, view.u);
      if (view.burning) fx.burn(view.chestWorld(_p), dt, view.u);
    }

    // Fleet support: launch the streaks so they land at impactAt.
    let fleetMark: FleetMark | null = null;
    if (fleet) {
      if (fleet.targetId) {
        const live = viewChest(fleet.targetId, _p);
        if (live) fleet.pos.copy(live);
      }
      if (!fleet.launched && fleet.impactAt - time <= 1.05) {
        fleet.launched = true;
        fx.fleetStreaks(fleet.pos);
        world.glint = 1;
      }
      if (rig.project(fleet.pos, _proj, _q)) fleetMark = { x: _proj.x, y: _proj.y, eta: fleet.impactAt - time };
      if (time - fleet.impactAt > 4) fleet = null;
    }

    // Nuke: sky brightens and the glass overexposes while the flash lasts.
    overlay.whiteout = fx.nukeGlow;
    skyColor.setScalar(fx.nukeGlow * 0.5);
    (scene.background as THREE.Color).copy(skyColor);
    world.sun.intensity = 2.7 + fx.nukeGlow * 4;
    if (views.size !== s.enemies.length) {
      for (const [id, view] of views) {
        if (!s.enemies.some((e) => e.id === id)) {
          view.dispose();
          views.delete(id);
          pendingImpact.delete(id);
        }
      }
    }

    for (let i = scheduled.length - 1; i >= 0; i--) {
      if (scheduled[i].at <= time) {
        const item = scheduled[i];
        scheduled.splice(i, 1);
        item.fn();
      }
    }

    fx.update(dt);

    /* ---- overlay ---- */
    tags.length = 0;
    arrows.length = 0;
    for (const enemy of s.enemies) {
      if (enemy.state === "DESTROYED") continue;
      const view = views.get(enemy.id);
      if (!view) continue;
      const color = enemy.kind === "CRIMSON" ? CRIMSON_COLOR : MANTIS_COLOR;
      const rel = enemy.bearing;
      const inCone = Math.abs(rel) <= APERTURE_HALF_DEG * 1.04;
      const frontOk = rig.project(view.headTopWorld(_p), _proj, _q) && rig.project(view.feetWorld(_p), _proj2, _q);
      if (!inCone || !frontOk) {
        const elev = clamp(enemy.altitude, -1, 1) * 0.35;
        const angle = rel > 0 ? -elev : Math.PI + elev;
        arrows.push({ angle, label: `${enemy.kind} ${Math.round(enemy.distance)}M`, color });
        continue;
      }
      const cy = (_proj.y + _proj2.y) / 2;
      const hh = Math.max(12, (_proj2.y - _proj.y) / 2);
      const spawnAge = (Date.now() - enemy.spawnAt) / 1000;
      tags.push({
        x: _proj.x,
        y: cy,
        hw: Math.max(10, hh * 0.6),
        hh,
        codename: enemy.codename,
        hpPct: (enemy.hp / enemy.maxHp) * 100,
        distance: enemy.distance,
        color,
        alpha: clamp(spawnAge / 0.6, 0.2, 1),
        locked: enemy.id === s.targetId,
        lockAge: time - targetLockAt,
        weakPoint: enemy.weakPointOpen,
        winding: view.winding,
      });
    }
    overlay.reticleOpen = Math.max(overlay.reticleOpen, clamp(s.player.heat / 100, 0, 1) * 0.3);
    overlay.draw(dt, tags, arrows, rig.shake, fleetMark);

    grain.uniforms.time.value = time % 1000;
    composer.render();
  }

  raf = requestAnimationFrame(frame);

  /* ------------------------------------------------------------- dispose */
  return {
    dispose() {
      if (disposed) return;
      disposed = true;
      cancelAnimationFrame(raf);
      ro.disconnect();
      for (const off of offs) off();
      for (const v of views.values()) v.dispose();
      views.clear();
      templates.dispose();
      cockpit.dispose();
      echo.dispose();
      fx.dispose();
      world.dispose();
      envTex.dispose();
      composer.dispose();
      bloom.dispose();
      renderer.dispose();
      renderer.forceContextLoss();
      canvas.remove();
      overlay.canvas.remove();
    },
  };
}

export { DEG };
