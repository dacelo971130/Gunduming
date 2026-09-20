"use client";

import { useGame } from "@/game/store";
import type { Stance } from "@/game/types";
import { Gauge, Lamp, lowIsBad, type LampColor } from "./instruments";

const STANCES: { id: Stance; label: string; lit: LampColor }[] = [
  { id: "NEUTRAL", label: "NEUT", lit: "green" },
  { id: "ASSAULT", label: "ASLT", lit: "amber" },
  { id: "GUARD", label: "GRD", lit: "green" },
  { id: "EVADE", label: "EVD", lit: "amber" },
];

/** Airframe page: structure and armor gauges plus the stance annunciators. */
export function PilotStatus() {
  const hp = useGame((s) => s.player.hp);
  const maxHp = useGame((s) => s.player.maxHp);
  const armor = useGame((s) => s.player.armor);
  const stance = useGame((s) => s.player.stance);

  const hpPct = maxHp > 0 ? (hp / maxHp) * 100 : 0;
  const critical = hpPct < 30;

  return (
    <div className="flex h-full flex-col justify-between gap-1.5 p-2">
      <Gauge label="STRUCTURE" value={hpPct} color={lowIsBad(hpPct)} redBand={[0, 30]} compact />
      <Gauge label="ARMOR PLATE" value={armor} color={lowIsBad(armor)} redBand={[0, 20]} compact />

      <div className="flex items-center justify-between leading-none">
        <div className="flex items-center gap-[9px]">
          <span className="mfd-label">STANCE</span>
          {STANCES.map((s) => (
            <span key={s.id} className="flex items-center gap-[4px]">
              <Lamp color={stance === s.id ? s.lit : "off"} size="sm" />
              <span className={`mfd-label text-[7px] ${stance === s.id ? "text-mfd-text" : ""}`}>{s.label}</span>
            </span>
          ))}
        </div>
        <span className="flex items-center gap-[5px]">
          <Lamp color={critical ? "red" : "green"} size="sm" blink={critical} />
          <span className={`mfd-num font-mono text-[9px] font-semibold ${critical ? "text-mfd-red mfd-glow-red" : "text-mfd-phosphor mfd-phosphor"}`}>
            {critical ? "STRUCT CRIT" : "NOMINAL"}
          </span>
        </span>
      </div>
    </div>
  );
}
