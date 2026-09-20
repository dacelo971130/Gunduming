"use client";

import { useGame } from "@/game/store";

/** Mission id/objective/threat/wave plus the live (or mocked) weather block. */
export function MissionControl() {
  const missionId = useGame((s) => s.mission.id);
  const objective = useGame((s) => s.mission.objective);
  const status = useGame((s) => s.mission.status);
  const wave = useGame((s) => s.mission.wave);
  const totalWaves = useGame((s) => s.mission.totalWaves);
  const weather = useGame((s) => s.weather);

  return (
    <div className="flex h-full flex-col gap-2 p-3 text-xs">
      <div className="flex items-center justify-between">
        <span className="hud-label">MISSION {missionId}</span>
        <span className="text-hud-gray">
          WAVE {wave} / {totalWaves}
        </span>
      </div>

      <p className="leading-snug text-hud-white">{objective}</p>

      <div className="flex items-center justify-between border-t border-hud-line pt-2">
        <span className="hud-label">STATUS</span>
        <span className="text-hud-green">{status}</span>
      </div>

      {weather ? (
        <div className="mt-1 flex items-center justify-between border-t border-hud-line pt-2">
          <div className="flex flex-col gap-0.5">
            <span className="hud-label">{weather.city}</span>
            <span className="text-sm text-hud-white">
              {Math.round(weather.tempC)}°C{" "}
              <span className="text-[10px] text-hud-gray">· {weather.condition}</span>
            </span>
            <span className="text-[10px] text-hud-gray">RAIN {Math.round(weather.rainProb)}%</span>
          </div>
          <span
            className={`hud-label rounded-sm border px-1.5 py-0.5 ${
              weather.isMock ? "border-hud-amber/50 text-hud-amber" : "border-hud-green/50 text-hud-green"
            }`}
          >
            {weather.isMock ? "MOCK" : "LIVE"}
          </span>
        </div>
      ) : (
        <div className="mt-1 border-t border-hud-line pt-2 text-[10px] text-hud-dim">
          WEATHER LINK UNAVAILABLE
        </div>
      )}
    </div>
  );
}
