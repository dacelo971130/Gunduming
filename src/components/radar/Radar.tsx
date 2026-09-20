"use client";

import { useEffect, useMemo, useState } from "react";
import { AnimatePresence, motion, useReducedMotion } from "motion/react";
import { useGame } from "@/game/store";
import type { Enemy } from "@/game/types";

const SIZE = 240;
const CX = SIZE / 2;
const CY = SIZE / 2;
const MAX_R = 96; // glass radius used for plotting
const GLASS_R = 102;
const BEZEL_R = 114;
const MAX_DISTANCE = 1400;
const RINGS = [400, 800, 1200];
const SWEEP_PERIOD_MS = 3200;
const TRAIL_STEPS = 10;
const TRAIL_STEP_DEG = 4;

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

function shortName(codename: string) {
  const parts = codename.split("/");
  return (parts.length > 1 ? parts[parts.length - 1] : codename).trim();
}

function Bracket({ x, y, s, color }: { x: number; y: number; s: number; color: string }) {
  const c = s;
  const l = s * 0.5;
  return (
    <g stroke={color} strokeWidth={1.2} fill="none">
      <path d={`M ${x - c} ${y - c + l} V ${y - c} H ${x - c + l}`} />
      <path d={`M ${x + c - l} ${y - c} H ${x + c} V ${y - c + l}`} />
      <path d={`M ${x + c} ${y + c - l} V ${y + c} H ${x + c - l}`} />
      <path d={`M ${x - c + l} ${y + c} H ${x - c} V ${y + c - l}`} />
    </g>
  );
}

function EnemyBlip({ enemy, locked, brightness }: { enemy: Enemy; locked: boolean; brightness: number }) {
  const r = Math.min(MAX_R - 3, (enemy.distance / MAX_DISTANCE) * MAX_R);
  const { x, y } = polar(CX, CY, r, enemy.bearing);
  const destroyed = enemy.state === "DESTROYED";
  const isCrimson = enemy.kind === "CRIMSON";
  const color = isCrimson ? "var(--color-mfd-red)" : "var(--color-mfd-phosphor)";
  const size = isCrimson ? 4.2 : 2.8;
  const glow = 0.3 + brightness * 0.7;
  const tagAnchor = x > CX + 20 ? "end" : "start";
  const tagX = x > CX + 20 ? x - size - 4 : x + size + 4;

  return (
    <motion.g
      initial={{ opacity: 0 }}
      animate={destroyed ? { opacity: [1, 0.2, 0.7, 0] } : { opacity: 1 }}
      exit={{ opacity: 0 }}
      transition={destroyed ? { duration: 1.1, times: [0, 0.25, 0.5, 1] } : { duration: 0.25 }}
    >
      {/* phosphor afterglow */}
      <circle cx={x} cy={y} r={size * 2.6} fill={color} opacity={glow * 0.22} filter="url(#radar-blur)" />
      {isCrimson ? (
        <polygon
          points={`${x},${y - size - 1} ${x + size + 1},${y + size} ${x - size - 1},${y + size}`}
          fill={color}
          opacity={0.45 + glow * 0.55}
        />
      ) : (
        <circle cx={x} cy={y} r={size} fill={color} opacity={0.4 + glow * 0.6} />
      )}
      {isCrimson && !destroyed && (
        <motion.circle
          cx={x}
          cy={y}
          r={size + 5}
          fill="none"
          stroke={color}
          strokeWidth={0.8}
          animate={{ opacity: [0.7, 0.15, 0.7] }}
          transition={{ duration: 1.2, repeat: Infinity, ease: "easeInOut" }}
        />
      )}
      {!destroyed && (
        <text
          x={tagX}
          y={y + 2.5}
          textAnchor={tagAnchor}
          fontFamily="var(--font-mono)"
          fontSize={6.5}
          fill={color}
          opacity={0.35 + glow * 0.65}
        >
          {shortName(enemy.codename)}
        </text>
      )}
      {locked && !destroyed && <Bracket x={x} y={y} s={size + 6} color="var(--color-mfd-phosphor)" />}
    </motion.g>
  );
}

/** Round CRT tactical scope: player fixed at centre facing up (bearing 0, + = right). */
export function Radar() {
  const enemies = useGame((s) => s.enemies);
  const targetId = useGame((s) => s.targetId);
  const heading = useGame((s) => s.player.bearing);
  const reduced = useReducedMotion();
  const [sweepAngle, setSweepAngle] = useState(0);

  useEffect(() => {
    if (reduced) return;
    const startedAt = Date.now();
    const id = window.setInterval(() => {
      const elapsed = (Date.now() - startedAt) % SWEEP_PERIOD_MS;
      setSweepAngle((elapsed / SWEEP_PERIOD_MS) * 360);
    }, 50);
    return () => window.clearInterval(id);
  }, [reduced]);

  const target = useMemo(
    () => (targetId ? (enemies.find((e) => e.id === targetId) ?? null) : null),
    [enemies, targetId],
  );
  const live = enemies.filter((e) => e.state !== "DESTROYED").length;

  return (
    <div className="flex h-full w-full items-center justify-center p-1">
      <svg viewBox={`0 0 ${SIZE} ${SIZE}`} width="100%" height="100%" style={{ maxHeight: "100%" }}>
        <defs>
          <filter id="radar-blur" x="-100%" y="-100%" width="300%" height="300%">
            <feGaussianBlur stdDeviation="2.2" />
          </filter>
          <radialGradient id="radar-glass" cx="50%" cy="45%" r="55%">
            <stop offset="0%" stopColor="#0c1f15" />
            <stop offset="65%" stopColor="#07130c" />
            <stop offset="100%" stopColor="#030705" />
          </radialGradient>
          <linearGradient id="radar-bezel" x1="0" y1="0" x2="1" y2="1">
            <stop offset="0%" stopColor="#3a424a" />
            <stop offset="45%" stopColor="#1a1f24" />
            <stop offset="100%" stopColor="#0b0e11" />
          </linearGradient>
          <linearGradient id="radar-sheen" x1="0" y1="0" x2="1" y2="1">
            <stop offset="0%" stopColor="rgba(255,255,255,0.10)" />
            <stop offset="45%" stopColor="rgba(255,255,255,0.0)" />
          </linearGradient>
          <clipPath id="radar-clip">
            <circle cx={CX} cy={CY} r={GLASS_R} />
          </clipPath>
        </defs>

        {/* bezel ring */}
        <circle cx={CX} cy={CY} r={BEZEL_R} fill="url(#radar-bezel)" stroke="#05070a" strokeWidth={1} />
        <circle cx={CX} cy={CY} r={GLASS_R + 1.5} fill="none" stroke="#000" strokeWidth={2} />
        <circle cx={CX} cy={CY} r={GLASS_R + 3} fill="none" stroke="rgba(255,255,255,0.05)" strokeWidth={0.8} />

        {/* engraved bearing labels on the bezel, every 30° */}
        {Array.from({ length: 12 }).map((_, i) => {
          const deg = i * 30;
          const p = polar(CX, CY, GLASS_R + 6.5, deg);
          return (
            <text
              key={deg}
              x={p.x}
              y={p.y}
              textAnchor="middle"
              dominantBaseline="middle"
              fontFamily="var(--font-instrument)"
              fontSize={5.5}
              fontWeight={700}
              fill={deg === 0 ? "var(--color-mfd-text)" : "var(--color-mfd-bezel-label)"}
              transform={`rotate(${deg} ${p.x} ${p.y})`}
            >
              {deg.toString().padStart(3, "0")}
            </text>
          );
        })}

        {/* glass */}
        <circle cx={CX} cy={CY} r={GLASS_R} fill="url(#radar-glass)" />

        <g clipPath="url(#radar-clip)">
          {/* fine grid */}
          <line x1={CX - GLASS_R} y1={CY} x2={CX + GLASS_R} y2={CY} stroke="var(--color-mfd-grid)" strokeWidth={0.8} />
          <line x1={CX} y1={CY - GLASS_R} x2={CX} y2={CY + GLASS_R} stroke="var(--color-mfd-grid)" strokeWidth={0.8} />

          {/* range rings */}
          {RINGS.map((dist) => {
            const r = (dist / MAX_DISTANCE) * MAX_R;
            return (
              <g key={dist}>
                <circle cx={CX} cy={CY} r={r} fill="none" stroke="var(--color-mfd-phosphor-faint)" strokeWidth={0.9} />
                <text x={CX + 2.5} y={CY - r - 1.5} fontFamily="var(--font-mono)" fontSize={5.5} fill="var(--color-mfd-phosphor-dim)">
                  {dist}m
                </text>
              </g>
            );
          })}
          <circle cx={CX} cy={CY} r={MAX_R} fill="none" stroke="var(--color-mfd-phosphor-dim)" strokeWidth={0.8} opacity={0.6} />

          {/* bearing ticks: minor every 10°, major every 30° */}
          {Array.from({ length: 36 }).map((_, i) => {
            const deg = i * 10;
            const major = deg % 30 === 0;
            const a = polar(CX, CY, MAX_R, deg);
            const b = polar(CX, CY, MAX_R - (major ? 6 : 3), deg);
            return (
              <line
                key={deg}
                x1={a.x}
                y1={a.y}
                x2={b.x}
                y2={b.y}
                stroke={deg === 0 ? "var(--color-mfd-phosphor)" : "var(--color-mfd-phosphor-dim)"}
                strokeWidth={major ? 1 : 0.6}
                opacity={major ? 0.9 : 0.6}
              />
            );
          })}

          {/* sweep with fading phosphor trail */}
          <g
            className={reduced ? "" : "animate-sweep"}
            style={{ transformOrigin: `${CX}px ${CY}px`, animationDuration: `${SWEEP_PERIOD_MS}ms` }}
          >
            {Array.from({ length: TRAIL_STEPS }).map((_, i) => (
              <path
                key={i}
                d={wedgePath(CX, CY, MAX_R, -(i + 1) * TRAIL_STEP_DEG, -i * TRAIL_STEP_DEG)}
                fill="var(--color-mfd-phosphor)"
                opacity={0.22 * Math.pow(1 - i / TRAIL_STEPS, 1.6)}
              />
            ))}
            <line x1={CX} y1={CY} x2={CX} y2={CY - MAX_R} stroke="var(--color-mfd-phosphor)" strokeWidth={1.2} opacity={0.9} />
          </g>

          {/* own ship */}
          <polygon
            points={`${CX},${CY - 5} ${CX + 3.6},${CY + 3.6} ${CX},${CY + 1.6} ${CX - 3.6},${CY + 3.6}`}
            fill="var(--color-mfd-text)"
            opacity={0.95}
          />

          <AnimatePresence>
            {enemies.map((enemy) => {
              const rel = norm360(sweepAngle - norm360(enemy.bearing));
              const brightness = reduced ? 0.8 : Math.pow(1 - rel / 360, 2.2);
              return (
                <EnemyBlip key={enemy.id} enemy={enemy} locked={enemy.id === targetId} brightness={brightness} />
              );
            })}
          </AnimatePresence>

          {/* glass sheen */}
          <ellipse cx={CX - 28} cy={CY - 46} rx={54} ry={26} fill="url(#radar-sheen)" transform={`rotate(-28 ${CX - 28} ${CY - 46})`} />
        </g>

        {/* readouts on the lower bezel */}
        <text x={CX - BEZEL_R + 6} y={SIZE - 4} fontFamily="var(--font-mono)" fontSize={6} fill="var(--color-mfd-bezel-label)">
          HDG {norm360(heading).toFixed(0).padStart(3, "0")}
        </text>
        <text x={CX + BEZEL_R - 6} y={SIZE - 4} textAnchor="end" fontFamily="var(--font-mono)" fontSize={6} fill="var(--color-mfd-bezel-label)">
          RNG 1400m · TRK {live.toString().padStart(2, "0")}
        </text>
        {target && (
          <text
            x={CX}
            y={SIZE - 4}
            textAnchor="middle"
            fontFamily="var(--font-mono)"
            fontSize={6}
            fontWeight={700}
            fill={target.kind === "CRIMSON" ? "var(--color-mfd-red)" : "var(--color-mfd-phosphor)"}
          >
            LOCK {shortName(target.codename)} {Math.round(target.distance)}m
          </text>
        )}
      </svg>
    </div>
  );
}
