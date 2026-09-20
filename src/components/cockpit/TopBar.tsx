"use client";

import { useEffect, useState } from "react";
import { useGame } from "@/game/store";
import type { Mission } from "@/game/types";

function useClock() {
  const [time, setTime] = useState<Date | null>(null);
  useEffect(() => {
    setTime(new Date());
    const id = window.setInterval(() => setTime(new Date()), 1000);
    return () => window.clearInterval(id);
  }, []);
  return time;
}

function pad(n: number) {
  return n.toString().padStart(2, "0");
}

const THREAT_STYLE: Record<Mission["threat"], string> = {
  LOW: "text-hud-green border-hud-green/40",
  MODERATE: "text-hud-amber border-hud-amber/40",
  HIGH: "text-hud-amber border-hud-amber/70",
  CRITICAL: "text-hud-red border-hud-red/70 animate-blink",
};

const PHASE_LABEL: Record<string, string> = {
  STANDBY: "SYS STANDBY",
  WAKE: "SYS WAKE",
  BOOT: "SYS BOOT",
  COCKPIT_BOOT: "SYS BOOT",
  BRIEFING: "SYS ONLINE",
  COMBAT: "SYS ONLINE",
  BOSS_INTRO: "SYS ONLINE",
  BOSS: "SYS ONLINE",
  VICTORY: "SYS ONLINE",
  DEFEAT: "SYS FAULT",
};

/** Top bar: system state, mission header, live clock, threat chip, link mode. */
export function TopBar() {
  const phase = useGame((s) => s.phase);
  const missionId = useGame((s) => s.mission.id);
  const sector = useGame((s) => s.mission.sector);
  const threat = useGame((s) => s.mission.threat);
  const neuralOnline = useGame((s) => s.neuralOnline);
  const time = useClock();

  return (
    <div className="hud-panel flex h-10 items-center justify-between px-4 text-[11px] tracking-[0.14em]">
      <div className="flex items-center gap-4 overflow-hidden">
        <span className="text-glow shrink-0 font-semibold text-hud-green">
          {PHASE_LABEL[phase] ?? "SYS ONLINE"}
        </span>
        <span className="text-hud-dim">|</span>
        <span className="truncate text-hud-gray">
          MISSION {missionId} <span className="text-hud-dim">·</span> {sector}
        </span>
      </div>

      <div className="flex shrink-0 items-center gap-4">
        <span className={`hud-label rounded-sm border px-2 py-0.5 ${THREAT_STYLE[threat]}`}>
          THREAT {threat}
        </span>
        <span className={neuralOnline ? "text-hud-green" : "text-hud-amber"}>
          {neuralOnline ? "NEURAL LINK · ONLINE" : "REFLEX LINK · LOCAL"}
        </span>
        <span className="tabular-nums font-semibold text-hud-white">
          {time ? `${pad(time.getHours())}:${pad(time.getMinutes())}:${pad(time.getSeconds())}` : "--:--:--"}
        </span>
      </div>
    </div>
  );
}
