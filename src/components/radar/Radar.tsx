"use client";

import { useEffect, useMemo, useState } from "react";
import { motion, AnimatePresence } from "motion/react";
import { useGame } from "@/game/store";
import type { Enemy } from "@/game/types";

const SIZE = 220;
const CX = SIZE / 2;
const CY = SIZE / 2;
const MAX_R = 92;
const MAX_DISTANCE = 1400;
const RINGS = [400, 800, 1200];
const SWEEP_PERIOD_MS = 3200;
const TRAIL_DEG = 36;

function polar(cx: number, cy: number, r: number, deg: number) {
  const rad = (deg * Math.PI) / 180;
  return { x: cx + r * Math.sin(rad), y: cy - r * Math.cos(rad) };
}

function norm360(deg: number) {
  return ((deg % 360) + 360) % 360;
}

function wedgePath(cx: number, cy: number, r: number, fromDeg: number, toDeg: number) {
  const p0 = polar(cx, cy, r, fromDeg);
  const p1 = polar(cx, cy, r, toDeg);
  const large = norm360(toDeg - fromDeg) > 180 ? 1 : 0;
  return `M ${cx} ${cy} L ${p0.x} ${p0.y} A ${r} ${r} 0 ${large} 1 ${p1.x} ${p1.y} Z`;
}

function EnemyBlip({ enemy, locked, brightness }: { enemy: Enemy; locked: boolean; brightness: number }) {
  const r = Math.min(MAX_R, (enemy.distance / MAX_DISTANCE) * MAX_R);
  const { x, y } = polar(CX, CY, r, enemy.bearing);
  const destroyed = enemy.state === "DESTROYED";
  const isCrimson = enemy.kind === "CRIMSON";
  const color = isCrimson ? "var(--color-hud-red)" : "var(--color-hud-green)";
  const size = isCrimson ? 7 : 5;

  return (
    <motion.g
      key={enemy.id}
      initial={{ opacity: 0, scale: 0.4 }}
      animate={
        destroyed
          ? { opacity: [1, 0.15, 0.85, 0], scale: [1, 1.4, 1, 0.5] }
          : { opacity: 0.35 + brightness * 0.65, scale: 1 }
      }
      exit={{ opacity: 0, scale: 0.3 }}
      transition={destroyed ? { duration: 0.9, times: [0, 0.2, 0.5, 1] } : { duration: 0.2 }}
    >
      {isCrimson && !destroyed && (
        <circle
          cx={x}
          cy={y}
          r={size + 4}
          fill="none"
          stroke={color}
          strokeWidth={1}
          className="animate-breathe"
          opacity={0.6}
        />
      )}

      {isCrimson ? (
        <polygon
          points={`${x},${y - size} ${x + size},${y + size} ${x - size},${y + size}`}
          fill={color}
          style={{ filter: `drop-shadow(0 0 4px ${color})` }}
        />
      ) : (
        <rect
          x={x - size / 1.4}
          y={y - size / 1.4}
          width={(size * 2) / 1.4}
          height={(size * 2) / 1.4}
          fill={color}
          transform={`rotate(45 ${x} ${y})`}
          style={{ filter: `drop-shadow(0 0 3px ${color})` }}
        />
      )}

      {locked && !destroyed && (
        <motion.g
          animate={{ rotate: 360 }}
          transition={{ duration: 4, repeat: Infinity, ease: "linear" }}
          style={{ transformOrigin: `${x}px ${y}px` }}
        >
          {[0, 90, 180, 270].map((a) => {
            const p = polar(x, y, size + 8, a);
            return (
              <line
                key={a}
                x1={p.x}
                y1={p.y}
                x2={polar(x, y, size + 4, a).x}
                y2={polar(x, y, size + 4, a).y}
                stroke="var(--color-hud-green)"
                strokeWidth={1.5}
              />
            );
          })}
        </motion.g>
      )}
    </motion.g>
  );
}

/** Circular top-down radar, player fixed at centre facing up (bearing 0). */
export function Radar() {
  const enemies = useGame((s) => s.enemies);
  const targetId = useGame((s) => s.targetId);
  const [sweepAngle, setSweepAngle] = useState(0);

  useEffect(() => {
    const startedAt = Date.now();
    const id = window.setInterval(() => {
      const elapsed = (Date.now() - startedAt) % SWEEP_PERIOD_MS;
      setSweepAngle((elapsed / SWEEP_PERIOD_MS) * 360);
    }, 60);
    return () => window.clearInterval(id);
  }, []);

  const target = useMemo(
    () => (targetId ? (enemies.find((e) => e.id === targetId) ?? null) : null),
    [enemies, targetId],
  );
  const targetR = target ? Math.min(MAX_R, (target.distance / MAX_DISTANCE) * MAX_R) : 0;
  const targetPoint = target ? polar(CX, CY, targetR, target.bearing) : null;
  const labelPoint = target ? polar(CX, CY, MAX_R + 14, target.bearing) : null;

  return (
    <div className="flex h-full w-full items-center justify-center p-1.5">
      <svg
        viewBox={`0 0 ${SIZE} ${SIZE}`}
        width="100%"
        height="100%"
        style={{ maxWidth: 234, maxHeight: 234 }}
      >
        {/* range rings */}
        {RINGS.map((dist) => {
          const r = (dist / MAX_DISTANCE) * MAX_R;
          return (
            <circle
              key={dist}
              cx={CX}
              cy={CY}
              r={r}
              fill="none"
              stroke="var(--color-hud-line)"
              strokeWidth={1}
            />
          );
        })}
        <circle cx={CX} cy={CY} r={MAX_R} fill="none" stroke="var(--color-hud-grid)" strokeWidth={1} />

        {RINGS.map((dist) => {
          const r = (dist / MAX_DISTANCE) * MAX_R;
          return (
            <text
              key={dist}
              x={CX + 3}
              y={CY - r - 2}
              className="fill-hud-dim"
              fontSize={6}
              letterSpacing={0.5}
            >
              {dist}
            </text>
          );
        })}

        {/* bearing ticks every 30deg, N/E/S/W labelled */}
        {Array.from({ length: 12 }).map((_, i) => {
          const deg = i * 30;
          const outer = polar(CX, CY, MAX_R, deg);
          const inner = polar(CX, CY, MAX_R - (deg % 90 === 0 ? 8 : 4), deg);
          const label = { 0: "N", 90: "E", 180: "S", 270: "W" }[deg as 0 | 90 | 180 | 270];
          const labelPos = polar(CX, CY, MAX_R + 9, deg);
          return (
            <g key={deg}>
              <line
                x1={inner.x}
                y1={inner.y}
                x2={outer.x}
                y2={outer.y}
                stroke="var(--color-hud-dim)"
                strokeWidth={deg % 90 === 0 ? 1.2 : 0.8}
              />
              {label && (
                <text
                  x={labelPos.x}
                  y={labelPos.y + 2.5}
                  textAnchor="middle"
                  className="fill-hud-green"
                  fontSize={7.5}
                  fontWeight={700}
                >
                  {label}
                </text>
              )}
            </g>
          );
        })}

        {/* sweep trail wedge + line — CSS-driven via .animate-sweep; a parallel
            JS timer below tracks the same period to brighten passed blips */}
        <g className="animate-sweep" style={{ transformOrigin: `${CX}px ${CY}px` }}>
          <path
            d={wedgePath(CX, CY, MAX_R, -TRAIL_DEG, 0)}
            fill="var(--color-hud-green)"
            opacity={0.14}
          />
          <line
            x1={CX}
            y1={CY}
            x2={CX}
            y2={CY - MAX_R}
            stroke="var(--color-hud-green)"
            strokeWidth={1.4}
            opacity={0.85}
          />
        </g>

        {/* player marker, always centre, facing up */}
        <polygon
          points={`${CX},${CY - 5} ${CX + 4},${CY + 4} ${CX - 4},${CY + 4}`}
          fill="var(--color-hud-white)"
        />

        <AnimatePresence>
          {enemies.map((enemy) => {
            const bearingNorm = norm360(enemy.bearing);
            const rel = norm360(sweepAngle - bearingNorm);
            const brightness = rel < TRAIL_DEG ? 1 - rel / TRAIL_DEG : 0;
            return (
              <EnemyBlip
                key={enemy.id}
                enemy={enemy}
                locked={enemy.id === targetId}
                brightness={brightness}
              />
            );
          })}
        </AnimatePresence>

        {/* locked target leader line + label */}
        {target && targetPoint && labelPoint && (
          <g>
            <line
              x1={targetPoint.x}
              y1={targetPoint.y}
              x2={labelPoint.x}
              y2={labelPoint.y}
              stroke="var(--color-hud-green)"
              strokeWidth={0.75}
              strokeDasharray="2 2"
              opacity={0.8}
            />
            <text
              x={labelPoint.x}
              y={labelPoint.y}
              textAnchor={labelPoint.x > CX ? "start" : labelPoint.x < CX ? "end" : "middle"}
              className="fill-hud-green"
              fontSize={6.5}
              fontWeight={700}
            >
              {target.codename}
            </text>
            <text
              x={labelPoint.x}
              y={labelPoint.y + 7}
              textAnchor={labelPoint.x > CX ? "start" : labelPoint.x < CX ? "end" : "middle"}
              className="fill-hud-gray"
              fontSize={6}
            >
              {Math.round(target.distance)}m
            </text>
          </g>
        )}
      </svg>
    </div>
  );
}
