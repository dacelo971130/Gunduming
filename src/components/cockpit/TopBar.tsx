"use client";

import { useEffect, useState } from "react";
import { useGame } from "@/game/store";
import type { Mission } from "@/game/types";
import { WarningLamps } from "./CockpitFrame";

function useClock() {
  const [time, setTime] = useState<Date | null>(null);
  useEffect(() => {
    const tick = () => setTime(new Date());
    const first = window.setTimeout(tick, 0);
    const id = window.setInterval(tick, 1000);
    return () => {
      window.clearTimeout(first);
      window.clearInterval(id);
    };
  }, []);
  return time;
}

function pad(n: number) {
  return n.toString().padStart(2, "0");
}

const THREAT_STYLE: Record<Mission["threat"], { text: string; lamp: string }> = {
  LOW: { text: "text-mfd-phosphor", lamp: "lamp-green" },
  MODERATE: { text: "text-mfd-amber", lamp: "lamp-amber" },
  HIGH: { text: "text-mfd-amber", lamp: "lamp-amber animate-blink" },
  CRITICAL: { text: "text-mfd-red", lamp: "lamp-red animate-blink" },
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

/** Slim status rail above the aperture: phase, mission header, annunciators, threat, link, clock. */
export function TopBar({ height }: { height: number }) {
  const phase = useGame((s) => s.phase);
  const missionId = useGame((s) => s.mission.id);
  const sector = useGame((s) => s.mission.sector);
  const threat = useGame((s) => s.mission.threat);
  const neuralOnline = useGame((s) => s.neuralOnline);
  const time = useClock();
  const fault = phase === "DEFEAT";
  const compact = height < 36;

  return (
    <div className="console-rail flex w-full items-center justify-between px-4" style={{ height }}>
      <div className="flex min-w-0 items-center gap-3">
        <span className={`lamp lamp-sm ${fault ? "lamp-red animate-blink" : "lamp-green"}`} />
        <span className={`mfd-engraved shrink-0 ${fault ? "text-mfd-red" : ""}`}>{PHASE_LABEL[phase] ?? "SYS ONLINE"}</span>
        <span className="h-[14px] w-px bg-black shadow-[1px_0_0_rgba(255,255,255,0.06)]" />
        <span className="mfd-engraved truncate opacity-80">
          MISSION {missionId} <span className="opacity-50">/</span> {sector}
        </span>
      </div>

      <div className={`flex items-start ${compact ? "scale-90" : ""}`}>
        <WarningLamps />
      </div>

      <div className="flex shrink-0 items-center gap-4">
        <span className="flex items-center gap-[6px]">
          <span className={`lamp lamp-sm ${THREAT_STYLE[threat].lamp}`} />
          <span className={`mfd-engraved ${THREAT_STYLE[threat].text}`}>THREAT {threat}</span>
        </span>
        <span className="flex items-center gap-[6px]">
          <span className={`lamp lamp-sm ${neuralOnline ? "lamp-green" : "lamp-amber"}`} />
          <span className="mfd-engraved">{neuralOnline ? "NEURAL LINK" : "REFLEX LOCAL"}</span>
        </span>
        <span className="mfd-num font-mono text-[12px] font-semibold tracking-[0.08em] text-mfd-text">
          {time ? `${pad(time.getHours())}:${pad(time.getMinutes())}:${pad(time.getSeconds())}` : "--:--:--"}
        </span>
      </div>
    </div>
  );
}
