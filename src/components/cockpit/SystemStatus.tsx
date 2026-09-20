"use client";

import { useGame } from "@/game/store";
import { SUBSYSTEMS } from "@/lib/config";

function heatColor(heat: number) {
  if (heat >= 80) return "text-hud-red";
  if (heat >= 50) return "text-hud-amber";
  return "text-hud-white";
}

function Stat({ label, value, colorClass }: { label: string; value: number; colorClass?: string }) {
  return (
    <div className="flex items-baseline justify-between">
      <span className="hud-label">{label}</span>
      <span className={`text-sm font-semibold tabular-nums ${colorClass ?? "text-hud-white"}`}>
        {Math.round(value)}
      </span>
    </div>
  );
}

const STATUS_STYLE: Record<string, string> = {
  OFFLINE: "text-hud-dim",
  BOOTING: "animate-blink text-hud-amber",
  ONLINE: "text-hud-green",
};

/** Numeric subsystem readouts plus the subsystem boot list. */
export function SystemStatus() {
  const energy = useGame((s) => s.player.energy);
  const armor = useGame((s) => s.player.armor);
  const boost = useGame((s) => s.player.boost);
  const heat = useGame((s) => s.player.heat);
  const special = useGame((s) => s.player.special);
  const subsystems = useGame((s) => s.subsystems);

  return (
    <div className="flex h-full flex-col gap-2 p-3">
      <div className="grid grid-cols-2 gap-x-3 gap-y-1.5">
        <Stat label="ENERGY" value={energy} />
        <Stat label="ARMOR" value={armor} />
        <Stat label="BOOST" value={boost} />
        <Stat label="HEAT" value={heat} colorClass={heatColor(heat)} />
        <Stat label="SPECIAL" value={special} />
      </div>

      <div className="mt-1 min-h-0 flex-1 space-y-1 overflow-y-auto border-t border-hud-line pt-2 text-[10px]">
        {SUBSYSTEMS.map((name) => (
          <div key={name} className="flex items-baseline">
            <span className="shrink-0 text-hud-gray">{name}</span>
            <span className="dot-leader" />
            <span className={`shrink-0 ${STATUS_STYLE[subsystems[name]]}`}>{subsystems[name]}</span>
          </div>
        ))}
      </div>
    </div>
  );
}
