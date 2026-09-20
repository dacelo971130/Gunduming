"use client";

import { useGame } from "@/game/store";
import { SUBSYSTEMS } from "@/lib/config";
import type { SubsystemStatus } from "@/game/types";
import { Gauge, Lamp, highIsBad, lowIsBad, type LampColor } from "./instruments";

const STATUS_LAMP: Record<SubsystemStatus, { color: LampColor; blink: boolean; text: string }> = {
  OFFLINE: { color: "off", blink: false, text: "text-mfd-muted" },
  BOOTING: { color: "amber", blink: true, text: "text-mfd-amber" },
  ONLINE: { color: "green", blink: false, text: "text-mfd-phosphor" },
};

/** Systems page: energy / boost / heat / special gauges and the subsystem lamp board. */
export function SystemStatus() {
  const energy = useGame((s) => s.player.energy);
  const boost = useGame((s) => s.player.boost);
  const heat = useGame((s) => s.player.heat);
  const special = useGame((s) => s.player.special);
  const subsystems = useGame((s) => s.subsystems);

  return (
    <div className="flex h-full min-h-0 flex-col gap-1.5 p-2">
      <div className="grid grid-cols-2 gap-x-4 gap-y-1">
        <Gauge label="ENERGY" value={energy} color={lowIsBad(energy)} compact />
        <Gauge label="THRUSTER" value={boost} color={lowIsBad(boost)} compact />
        <Gauge label="WPN HEAT" value={heat} color={highIsBad(heat)} redBand={[85, 100]} compact />
        <Gauge label="SPECIAL CHG" value={special} color={special >= 100 ? "green" : "white"} compact />
      </div>

      <div className="mt-auto grid min-h-0 grid-cols-2 gap-x-4 gap-y-[2px] border-t border-mfd-phosphor-faint pt-1 leading-none">
        {SUBSYSTEMS.map((name) => {
          const st = subsystems[name];
          const lamp = STATUS_LAMP[st];
          return (
            <div key={name} className="flex h-[10px] items-center gap-[6px] overflow-hidden">
              <Lamp color={lamp.color} size="sm" blink={lamp.blink} />
              <span className={`mfd-label truncate text-[7.5px] ${st === "ONLINE" ? "text-mfd-text/80" : ""}`}>{name}</span>
            </div>
          );
        })}
      </div>
    </div>
  );
}
