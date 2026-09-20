"use client";

import { useGame } from "@/game/store";
import type { Mission } from "@/game/types";
import { Lamp, Pip, Readout, type LampColor } from "./instruments";

const STATUS_LAMP: Record<Mission["status"], { color: LampColor; blink: boolean }> = {
  PENDING: { color: "amber", blink: false },
  ACTIVE: { color: "green", blink: false },
  COMPLETE: { color: "green", blink: false },
  FAILED: { color: "red", blink: true },
};

const THREAT_TONE: Record<Mission["threat"], LampColor> = {
  LOW: "green",
  MODERATE: "amber",
  HIGH: "amber",
  CRITICAL: "red",
};

/** Mission page: id / sector / objective, status lamp, wave pips, threat, weather block. */
export function MissionControl() {
  const missionId = useGame((s) => s.mission.id);
  const sector = useGame((s) => s.mission.sector);
  const objective = useGame((s) => s.mission.objective);
  const status = useGame((s) => s.mission.status);
  const threat = useGame((s) => s.mission.threat);
  const wave = useGame((s) => s.mission.wave);
  const totalWaves = useGame((s) => s.mission.totalWaves);
  const weather = useGame((s) => s.weather);

  const lamp = STATUS_LAMP[status];

  return (
    <div className="flex h-full min-h-0 flex-col gap-1.5 p-2.5 text-[10px]">
      <div className="flex items-center justify-between">
        <span className="mfd-num font-mono text-[11px] font-semibold tracking-[0.12em] text-mfd-text">
          {missionId} <span className="text-mfd-muted">/</span> {sector}
        </span>
        <span className="flex items-center gap-[6px]">
          <Lamp color={lamp.color} size="sm" blink={lamp.blink} />
          <span className="mfd-label text-mfd-text/80">{status}</span>
        </span>
      </div>

      <p className="min-h-0 flex-1 overflow-hidden font-mono text-[10px] leading-snug text-mfd-phosphor mfd-phosphor">
        {objective}
      </p>

      <div className="flex items-center justify-between border-t border-mfd-phosphor-faint pt-1.5">
        <div className="flex flex-col gap-[3px]">
          <span className="mfd-label">
            WAVE <span className="mfd-num text-mfd-text">{wave}</span>/<span className="mfd-num">{totalWaves}</span>
          </span>
          <div className="flex gap-[3px]">
            {Array.from({ length: Math.max(1, totalWaves) }).map((_, i) => (
              <Pip key={i} state={i + 1 < wave ? "done" : i + 1 === wave ? "active" : "off"} />
            ))}
          </div>
        </div>
        <div className="w-[46%]">
          <Readout label="THREAT" value={threat} tone={THREAT_TONE[threat]} />
        </div>
      </div>

      {weather ? (
        <div className="flex items-center justify-between border-t border-mfd-phosphor-faint pt-1.5">
          <div className="flex flex-col">
            <span className="mfd-label">{weather.city}</span>
            <span className="mfd-num font-mono text-[11px] text-mfd-text">
              {Math.round(weather.tempC).toString().padStart(2, "0")}°C
              <span className="ml-1 text-[8px] uppercase text-mfd-muted">{weather.condition}</span>
            </span>
          </div>
          <div className="flex flex-col items-end gap-[2px]">
            <span className="mfd-label">
              RAIN <span className="mfd-num text-mfd-text">{Math.round(weather.rainProb)}%</span> · WIND{" "}
              <span className="mfd-num text-mfd-text">{Math.round(weather.windKph)}</span> KPH
            </span>
            <span className="flex items-center gap-[5px]">
              <Lamp color={weather.isMock ? "amber" : "green"} size="sm" />
              <span className="mfd-label text-[7px]">{weather.isMock ? "MOCK FEED" : "LIVE FEED"}</span>
            </span>
          </div>
        </div>
      ) : (
        <div className="flex items-center gap-[6px] border-t border-mfd-phosphor-faint pt-1.5">
          <Lamp color="off" size="sm" />
          <span className="mfd-label">WEATHER LINK UNAVAILABLE</span>
        </div>
      )}
    </div>
  );
}
