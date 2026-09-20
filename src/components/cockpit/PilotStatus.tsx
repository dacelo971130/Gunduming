"use client";

import { useGame } from "@/game/store";

const SEGMENTS = 16;

function colorFor(pct: number) {
  if (pct < 30) return "bg-hud-red";
  if (pct < 60) return "bg-hud-amber";
  return "bg-hud-green";
}

function SegBar({ pct }: { pct: number }) {
  const clamped = Math.max(0, Math.min(100, pct));
  const filled = Math.round((clamped / 100) * SEGMENTS);
  const color = colorFor(clamped);
  return (
    <div className="flex gap-[2px]">
      {Array.from({ length: SEGMENTS }).map((_, i) => (
        <div key={i} className={`h-3 flex-1 ${i < filled ? color : "bg-hud-line"}`} />
      ))}
    </div>
  );
}

function Row({ label, pct }: { label: string; pct: number }) {
  return (
    <div className="flex flex-col gap-1">
      <div className="flex items-center justify-between">
        <span className="hud-label">{label}</span>
        <span className="text-xs font-semibold tabular-nums text-hud-white">{Math.round(pct)}%</span>
      </div>
      <SegBar pct={pct} />
    </div>
  );
}

/** Structural integrity, armor, stance — the pilot's own body panel. */
export function PilotStatus() {
  const hp = useGame((s) => s.player.hp);
  const maxHp = useGame((s) => s.player.maxHp);
  const armor = useGame((s) => s.player.armor);
  const stance = useGame((s) => s.player.stance);

  const hpPct = maxHp > 0 ? (hp / maxHp) * 100 : 0;
  const critical = hpPct < 30;

  return (
    <div className={`flex h-full flex-col gap-3 p-3 ${critical ? "animate-red-alert" : ""}`}>
      <Row label="STRUCTURAL INTEGRITY" pct={hpPct} />
      <Row label="ARMOR" pct={armor} />

      <div className="flex items-center justify-between pt-0.5">
        <span className="hud-label">STANCE</span>
        <span className="text-glow text-xs font-semibold tracking-[0.2em] text-hud-green">{stance}</span>
      </div>

      {critical && (
        <div className="animate-blink mt-auto text-center text-xs font-bold tracking-[0.35em] text-hud-red">
          CRITICAL
        </div>
      )}
    </div>
  );
}
