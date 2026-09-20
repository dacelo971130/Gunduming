"use client";

import { useEffect, useRef } from "react";
import { game } from "@/game/store";
import { bus } from "@/lib/bus";
import type { EnemyKind } from "@/game/types";
import {
  createParticlePool,
  updateParticles,
  drawParticles,
  spawnMuzzleFlash,
  spawnHitBurst,
  spawnExplosion,
  spawnAsh,
  spawnThrusterWash,
  type ParticlePool,
} from "./render/particles";
import { createWorldState, updateWorld, drawSky, drawBase, drawHorizon, drawGrid, drawCraters, drawDust } from "./render/world";
import { projectEnemy, edgeArrowPos, clamp, FAR_DIST, type Glass } from "./render/project";
import { canopyGlass } from "@/components/cockpit/layout";
import {
  createEnemyAnim,
  updateEnemyAnim,
  drawMantis,
  drawCrimson,
  drawEnemyTag,
  drawTargetLock,
  drawWeakPoint,
  drawEdgeArrow,
  type EnemyAnim,
} from "./render/mecha";
import {
  createFxState,
  fireTracer,
  fireBeam,
  addScar,
  updateFx,
  drawTracers,
  drawBeam,
  drawScars,
  createBossIntroState,
  startBossIntro,
  updateBossIntro,
  drawBossIntro,
} from "./render/fx";
import {
  createCanopyState,
  triggerCrack,
  updateCanopy,
  drawReticle,
  drawBearingTape,
  drawRangeTicks,
  drawFrameStruts,
  drawVignette,
  drawInterference,
  drawCrack,
} from "./render/canopy";

const MAX_DT = 1 / 20; // clamp big pauses/tab-switches so physics never jumps
const HOSTILE_MANTIS = "#ffb43d";
const HOSTILE_CRIMSON = "#ff3b4e";

interface ScreenPoint {
  x: number;
  y: number;
}

/**
 * LEGACY 2D canvas renderer — the fallback used when WebGL2 is unavailable or
 * the three.js viewport throws during init. Kept compiling and feature-complete.
 *
 * The canopy view — the only place enemies physically exist on screen.
 * Owns a single <canvas>, a requestAnimationFrame loop that reads
 * `useGame.getState()` imperatively (no per-frame React re-render), and
 * every bus subscription that drives its effects layers.
 */
export function LegacyBattleViewport() {
  const canvasRef = useRef<HTMLCanvasElement | null>(null);
  const wrapRef = useRef<HTMLDivElement | null>(null);

  useEffect(() => {
    const canvas = canvasRef.current;
    const wrap = wrapRef.current;
    if (!canvas || !wrap) return;
    const ctx2d = canvas.getContext("2d");
    if (!ctx2d) return;
    // Rebind to a permanently non-null const — nested function declarations
    // below (frame/render) don't retain the narrowing on `ctx2d` otherwise.
    const ctx: CanvasRenderingContext2D = ctx2d;

    /* ---------------------------------------------------------- local state */
    let width = 0;
    let height = 0;
    let dpr = 1;
    /** Visible canopy span between the HUD panel columns — enemies are projected into this. */
    let glass: Glass = { x: 0, w: 0 };

    const particles: ParticlePool = createParticlePool(400);
    const world = createWorldState(800);
    const fx = createFxState();
    const canopy = createCanopyState();
    const bossIntro = createBossIntroState();
    const anims = new Map<string, EnemyAnim>();
    const lastProjected = new Map<string, { x: number; y: number; scale: number }>();

    let boostPulse = 0;
    let reticleOpen = 0;
    let shake = 0;
    let ashAccum = 0;
    let time = 0;
    let targetLockAt = 0;
    let lastTargetId: string | null = null;

    function resolveTargetScreenPoint(targetId: string | null): ScreenPoint | null {
      if (!targetId) return null;
      const cached = lastProjected.get(targetId);
      if (cached) return { x: cached.x, y: cached.y };
      const enemy = game.get().enemies.find((e) => e.id === targetId);
      if (!enemy) return null;
      const p = projectEnemy(enemy.bearing, enemy.distance, enemy.altitude, width, height, glass);
      return { x: p.x, y: p.y };
    }

    /* -------------------------------------------------------------- resize */
    const ro = new ResizeObserver((entries) => {
      for (const entry of entries) {
        const cw = Math.max(1, Math.floor(entry.contentRect.width));
        const ch = Math.max(1, Math.floor(entry.contentRect.height));
        dpr = Math.min(2, window.devicePixelRatio || 1);
        width = cw;
        height = ch;
        glass = canopyGlass(cw, ch);
        canvas.width = Math.floor(cw * dpr);
        canvas.height = Math.floor(ch * dpr);
        canvas.style.width = `${cw}px`;
        canvas.style.height = `${ch}px`;
      }
    });
    ro.observe(wrap);

    /* --------------------------------------------------------- bus wiring */
    const offFire = bus.on("fx:fire", ({ targetId }) => {
      try {
        const target = resolveTargetScreenPoint(targetId) ?? { x: width / 2, y: height * 0.42 };
        fireTracer(fx, 0, height, target.x, target.y);
        fireTracer(fx, width, height, target.x, target.y);
        spawnMuzzleFlash(particles, width * 0.18, height * 0.98);
        spawnMuzzleFlash(particles, width * 0.82, height * 0.98);
        reticleOpen = 1;
      } catch (err) {
        console.error("[viewport] fx:fire handler failed", err);
      }
    });

    const offSpecial = bus.on("fx:special", ({ targetId }) => {
      try {
        const target = resolveTargetScreenPoint(targetId) ?? { x: width / 2, y: height * 0.4 };
        fireBeam(fx, target);
        reticleOpen = 1;
      } catch (err) {
        console.error("[viewport] fx:special handler failed", err);
      }
    });

    const offHit = bus.on("fx:hit", ({ targetId, killed }) => {
      try {
        const p = lastProjected.get(targetId);
        const point = p ?? resolveTargetScreenPoint(targetId);
        if (!point) return;
        const scale = p?.scale ?? 0.6;
        const enemy = game.get().enemies.find((e) => e.id === targetId);
        const color = enemy?.kind === "CRIMSON" ? HOSTILE_CRIMSON : "#ffe0a0";
        spawnHitBurst(particles, point.x, point.y, scale, color);
        if (killed) {
          spawnExplosion(particles, point.x, point.y, scale);
          addScar(fx, point.x, point.y, Math.max(0.4, scale));
          shake = Math.max(shake, 0.5);
        }
      } catch (err) {
        console.error("[viewport] fx:hit handler failed", err);
      }
    });

    const offPlayerHit = bus.on("fx:playerHit", ({ amount, fromBearing }) => {
      try {
        triggerCrack(canopy, fromBearing);
        shake = Math.min(1, shake + clamp(amount / 25, 0.2, 1));
      } catch (err) {
        console.error("[viewport] fx:playerHit handler failed", err);
      }
    });

    const offPhase = bus.on("phase:changed", ({ phase }) => {
      try {
        if (phase === "BOSS_INTRO") startBossIntro(bossIntro);
      } catch (err) {
        console.error("[viewport] phase:changed handler failed", err);
      }
    });

    const offCmd = bus.on("cmd:executed", ({ command, result }) => {
      try {
        if (!result.ok) return;
        if (command.action === "BOOST") boostPulse = 1;
      } catch (err) {
        console.error("[viewport] cmd:executed handler failed", err);
      }
    });

    /* ------------------------------------------------------------ RAF loop */
    let raf = 0;
    let last = performance.now();

    function frame(now: number) {
      raf = requestAnimationFrame(frame);
      const dtRaw = (now - last) / 1000;
      last = now;
      const dt = clamp(dtRaw, 0, MAX_DT);
      time += dt;

      try {
        render(dt);
      } catch (err) {
        // A bad frame must never kill the demo.
        console.error("[viewport] render frame failed", err);
      }
    }

    function render(dt: number) {
      if (width <= 0 || height <= 0) return;
      ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
      ctx.clearRect(0, 0, width, height);

      const snap = game.get();
      const player = snap.player;
      const enemies = snap.enemies;
      const targetId = snap.targetId;

      if (targetId !== lastTargetId) {
        lastTargetId = targetId;
        targetLockAt = time;
      }

      // Decay ephemeral pulses.
      boostPulse = Math.max(0, boostPulse - dt / 1.1);
      reticleOpen = Math.max(0, reticleOpen - dt / 0.28);
      shake = Math.max(0, shake - dt / 0.5);

      updateWorld(world, dt, boostPulse);
      updateFx(fx, dt);
      updateCanopy(canopy, dt);
      updateBossIntro(bossIntro, dt);
      updateParticles(particles, dt);

      // Idle drifting ash, rate-limited (never allocates beyond the pool).
      ashAccum += dt;
      if (ashAccum > 0.4) {
        ashAccum = 0;
        spawnAsh(particles, width, height);
      }
      if (boostPulse > 0.15) {
        spawnThrusterWash(particles, width * 0.5, height * 0.99);
      }

      // Screen shake: a small random world-space offset, reset every frame.
      const shakeMag = shake * 6;
      const sx = shakeMag ? (Math.random() - 0.5) * shakeMag : 0;
      const sy = shakeMag ? (Math.random() - 0.5) * shakeMag : 0;

      ctx.save();
      ctx.translate(sx, sy);

      /* ---- layer 1: world ---- */
      drawSky(ctx, width, height, time, player.bearing);
      drawBase(ctx, width, height, world, player.bearing);
      drawHorizon(ctx, width, height, player.bearing);
      drawGrid(ctx, width, height, world, player.bearing);
      drawCraters(ctx, width, height, world, player.bearing);
      drawDust(ctx, width, height, world);

      /* ---- layer 2: enemies ---- */
      const liveIds = new Set<string>();
      const sorted = [...enemies]
        .filter((e) => e.state !== "DESTROYED")
        .sort((a, b) => b.distance - a.distance);

      lastProjected.clear();
      for (const enemy of sorted) {
        liveIds.add(enemy.id);
        const proj = projectEnemy(enemy.bearing, enemy.distance, enemy.altitude, width, height, glass);
        lastProjected.set(enemy.id, { x: proj.x, y: proj.y, scale: proj.scale });

        let anim = anims.get(enemy.id);
        if (!anim) {
          anim = createEnemyAnim(enemy.bearing);
          anims.set(enemy.id, anim);
        }
        updateEnemyAnim(anim, enemy.bearing, dt, proj.x, proj.y, proj.scale, enemy.kind);

        if (!proj.visible) {
          const pos = edgeArrowPos(proj.side, enemy.altitude, width, height, glass);
          const color = enemy.kind === "CRIMSON" ? HOSTILE_CRIMSON : HOSTILE_MANTIS;
          drawEdgeArrow(ctx, pos.x, pos.y, proj.side, color, `${enemy.kind} ${Math.round(enemy.distance)}M`);
          continue;
        }

        const spawnAge = (Date.now() - enemy.spawnAt) / 1000;
        const spawnFade = clamp(spawnAge / 0.6, 0.15, 1);
        const fog = 1 - clamp((enemy.distance / FAR_DIST) * 0.3, 0, 0.3);

        drawEnemyBody(enemy.kind, ctx, proj.x, proj.y, proj.scale, anim, spawnFade * fog, time);

        if (enemy.weakPointOpen) {
          drawWeakPoint(ctx, proj.x, proj.y, proj.scale, time);
        }
        if (enemy.id === targetId) {
          drawTargetLock(ctx, proj.x, proj.y, proj.scale, time - targetLockAt);
        }
        const color = enemy.kind === "CRIMSON" ? HOSTILE_CRIMSON : HOSTILE_MANTIS;
        drawEnemyTag(ctx, proj.x, proj.y, proj.scale, enemy.codename, Math.max(0, (enemy.hp / enemy.maxHp) * 100), enemy.distance, color, spawnFade);
      }
      // Drop animation state for enemies that left the world (killed/despawned).
      for (const id of Array.from(anims.keys())) {
        if (!liveIds.has(id)) anims.delete(id);
      }

      /* ---- BOSS_INTRO choreography, drawn over the world/enemies ---- */
      drawBossIntro(ctx, width, height, bossIntro);

      /* ---- layer 3+4: weapon fire, particles, scars ---- */
      drawTracers(ctx, fx);
      drawBeam(ctx, fx, width, height);
      drawParticles(ctx, particles);
      drawScars(ctx, fx);

      ctx.restore(); // end shake transform — canopy overlay itself doesn't shake

      /* ---- layer 5: canopy overlay ---- */
      drawRangeTicks(ctx, width, height);
      drawBearingTape(ctx, width, player.bearing);
      drawFrameStruts(ctx, width, height);
      const weaponOpenness = clamp(player.heat / 100, 0, 1) * 0.3 + reticleOpen * 0.7;
      drawReticle(ctx, width, height, weaponOpenness, targetId != null);
      drawVignette(ctx, width, height);
      drawInterference(ctx, width, height, canopy);
      drawCrack(ctx, width, height, canopy);
    }

    raf = requestAnimationFrame(frame);

    return () => {
      cancelAnimationFrame(raf);
      ro.disconnect();
      offFire();
      offSpecial();
      offHit();
      offPlayerHit();
      offPhase();
      offCmd();
    };
  }, []);

  return (
    <div ref={wrapRef} className="absolute inset-0 h-full w-full overflow-hidden bg-hud-void">
      <canvas ref={canvasRef} className="block h-full w-full" />
    </div>
  );
}

function drawEnemyBody(
  kind: EnemyKind,
  ctx: CanvasRenderingContext2D,
  x: number,
  y: number,
  scale: number,
  anim: EnemyAnim,
  fade: number,
  time: number,
): void {
  if (kind === "CRIMSON") {
    drawCrimson(ctx, x, y, scale, anim, fade, time);
  } else {
    drawMantis(ctx, x, y, scale, anim, fade);
  }
}
