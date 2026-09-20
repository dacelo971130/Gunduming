"use client";

import { useEffect, useState } from "react";
import { AnimatePresence, motion } from "motion/react";
import { useGame } from "@/game/store";
import { bus } from "@/lib/bus";
import { WEAPONS, weaponSpec, type WeaponId, type WeaponSpec } from "@/lib/config";
import { runManualCommand } from "@/voice/pipeline";
import { Gauge, Lamp, highIsBad, lowIsBad, toneClass, type LampColor } from "./instruments";

type FireMode = "BURST" | "PRECISION" | "BARRAGE";
const HEAT_MAX = 100;

const MODE_KEY: Record<FireMode, string> = {
  BURST: "F",
  PRECISION: "VOICE",
  BARRAGE: "VOICE",
};

function fmtRange(spec: WeaponSpec): string {
  return spec.maxRange === null ? "UNLTD" : `${spec.maxRange} m`;
}

interface SlotProps {
  spec: WeaponSpec;
  selected: boolean;
  outOfRange: boolean;
  index: number;
  compact: boolean;
  onSelect: (id: WeaponId) => void;
}

function Slot({ spec, selected, outOfRange, index, compact, onSelect }: SlotProps) {
  const showStats = !compact || selected;
  return (
    <button
      type="button"
      className={`weapon-slot px-2 ${compact ? "py-[3px]" : "py-[4px]"}`}
      data-selected={selected}
      onClick={() => onSelect(spec.id)}
      aria-pressed={selected}
      title={spec.role}
    >
      {selected && (
        <motion.span
          layoutId="weapon-selected-bracket"
          className="pointer-events-none absolute inset-[-1px] border border-mfd-phosphor/60"
          style={{ boxShadow: "0 0 8px rgba(134,207,159,0.25)" }}
          transition={{ type: "spring", stiffness: 500, damping: 38 }}
        />
      )}
      <div className="flex items-center gap-2">
        <Lamp color={selected ? "green" : "off"} size="sm" />
        <span className={`mfd-num w-[22px] shrink-0 font-mono text-[9px] font-bold ${selected ? "text-mfd-phosphor mfd-phosphor" : "text-mfd-muted"}`}>
          {index + 1}·{spec.tag}
        </span>
        <span className={`mfd-label flex-1 truncate text-[9px] tracking-[0.14em] ${selected ? "text-mfd-text" : "text-mfd-muted"}`}>
          {spec.name}
        </span>
        <span className={`mfd-num shrink-0 font-mono text-[9px] ${outOfRange ? "text-mfd-red mfd-glow-red" : selected ? "text-mfd-phosphor" : "text-mfd-muted"}`}>
          {fmtRange(spec)}
        </span>
      </div>
      {showStats && (
      <div className="mt-[2px] flex gap-3 pl-[22px]">
        <Stat k="DMG" v={spec.damage} lit={selected} />
        <Stat k="HEAT" v={spec.heat} lit={selected} />
        <Stat k="EN" v={spec.energy} lit={selected} />
        <Stat k="CONE" v={spec.splashDeg} unit="°" lit={selected} />
      </div>
      )}
    </button>
  );
}

function Stat({ k, v, unit = "", lit }: { k: string; v: number; unit?: string; lit: boolean }) {
  return (
    <span className="flex items-baseline gap-[3px]">
      <span className="mfd-label text-[7px]">{k}</span>
      <span className={`mfd-num font-mono text-[9px] ${lit ? "text-mfd-text" : "text-mfd-muted"}`}>
        {v.toString().padStart(2, "0")}
        {unit}
      </span>
    </span>
  );
}

/** Weapon selector: four physical slots, live heat/energy with next-shot cost, target range check. */
export function WeaponStatus({ compact = false }: { compact?: boolean }) {
  const weapon = useGame((s) => s.player.weapon);
  const heat = useGame((s) => s.player.heat);
  const energy = useGame((s) => s.player.energy);
  const special = useGame((s) => s.player.special);
  const target = useGame((s) => (s.targetId ? (s.enemies.find((e) => e.id === s.targetId) ?? null) : null));

  const [mode, setMode] = useState<FireMode>("BURST");
  const [flash, setFlash] = useState<{ id: number; weapon: WeaponId } | null>(null);

  useEffect(() => {
    const offCmd = bus.on("cmd:executed", ({ command, result }) => {
      if (command.action === "ATTACK" && result.ok) setMode(command.mode ?? "BURST");
    });
    let seq = 0;
    let timer: number | null = null;
    const offWpn = bus.on("weapon:changed", ({ weapon: next }) => {
      seq += 1;
      setFlash({ id: seq, weapon: next });
      if (timer !== null) window.clearTimeout(timer);
      timer = window.setTimeout(() => setFlash(null), 1100);
    });
    return () => {
      offCmd();
      offWpn();
      if (timer !== null) window.clearTimeout(timer);
    };
  }, []);

  const spec = weaponSpec(weapon);
  const targetDistance = target && target.state !== "DESTROYED" ? target.distance : null;
  const outOfRange = targetDistance !== null && spec.maxRange !== null && targetDistance > spec.maxRange;

  let readiness: { text: string; tone: LampColor; blink: boolean } = { text: "READY", tone: "green", blink: false };
  if (heat >= HEAT_MAX) readiness = { text: "OVERHEAT", tone: "red", blink: true };
  else if (energy < spec.energy) readiness = { text: "LOW ENERGY", tone: "amber", blink: false };
  else if (outOfRange) readiness = { text: "RANGE", tone: "red", blink: true };

  const select = (id: WeaponId) => {
    if (id === weapon) return;
    runManualCommand({ action: "SWITCH_WEAPON", weapon: id });
  };

  return (
    <div className={`relative flex h-full min-h-0 flex-col ${compact ? "gap-1 p-2" : "gap-1.5 p-2.5"}`}>
      {/* header: readiness + fire mode */}
      <div className="flex items-center justify-between">
        <span className="flex items-center gap-[6px]">
          <Lamp color={readiness.tone} size="sm" blink={readiness.blink} />
          <span className={`mfd-num font-mono text-[10px] font-bold tracking-[0.14em] ${toneClass(readiness.tone)}`}>{readiness.text}</span>
        </span>
        <span className="mfd-label">
          MODE <span className="mfd-num text-mfd-text">{mode}</span>{" "}
          <span className="text-[7px] opacity-70">[{MODE_KEY[mode]}]</span>
        </span>
      </div>

      {/* the four slots */}
      <div className={`flex flex-col ${compact ? "gap-[3px]" : "gap-[4px]"}`}>
        {WEAPONS.map((w, i) => (
          <Slot
            key={w.id}
            spec={w}
            index={i}
            compact={compact}
            selected={w.id === weapon}
            outOfRange={targetDistance !== null && w.maxRange !== null && targetDistance > w.maxRange}
            onSelect={select}
          />
        ))}
      </div>

      {/* target + range check */}
      <div className="flex items-center justify-between border-t border-mfd-phosphor-faint pt-1.5">
        <span className="mfd-label">TGT</span>
        {target ? (
          <span className="mfd-num flex items-baseline gap-2 font-mono text-[9.5px] text-mfd-text">
            <span className="truncate">{target.codename}</span>
            <span className="text-mfd-muted">{Math.round(target.bearing).toString().padStart(3, "0")}°</span>
            <span className={outOfRange ? "text-mfd-red mfd-glow-red" : "text-mfd-phosphor"}>
              {Math.round(target.distance).toString().padStart(4, "0")} m
            </span>
          </span>
        ) : (
          <span className="mfd-label text-mfd-muted">NO LOCK</span>
        )}
      </div>
      {outOfRange && targetDistance !== null && (
        <div className="flex items-center gap-[6px] border border-mfd-red/50 bg-mfd-red/10 px-2 py-[3px]">
          <Lamp color="red" size="sm" blink />
          <span className="mfd-num font-mono text-[9px] font-bold tracking-[0.12em] text-mfd-red mfd-glow-red">
            RANGE {Math.round(targetDistance)} m {">"} {spec.maxRange} m{compact ? "" : " — CLOSE IN OR SWITCH"}
          </span>
        </div>
      )}

      {/* live heat / energy with next-shot cost marked */}
      <div className="mt-auto flex flex-col gap-1.5">
        <Gauge
          label={`HEAT · NEXT +${spec.heat}`}
          value={heat}
          color={highIsBad(heat)}
          redBand={[85, 100]}
          cost={[heat, Math.min(100, heat + spec.heat)]}
          compact
        />
        <Gauge
          label={`ENERGY · NEXT -${spec.energy}`}
          value={energy}
          color={lowIsBad(energy)}
          cost={[Math.max(0, energy - spec.energy), energy]}
          compact
        />
        {!compact && (
        <div className="flex items-center justify-between">
          <span className="mfd-label">SPECIAL</span>
          <div className="mfd-bar mx-2 flex-1" style={{ height: 4 }}>
            <div
              className="mfd-bar-fill"
              style={{
                width: `calc(${Math.max(0, Math.min(100, special))}% - 2px)`,
                background: special >= 100 ? "var(--color-mfd-phosphor)" : "var(--color-mfd-amber)",
              }}
            />
          </div>
          <span className={`mfd-num font-mono text-[9px] font-semibold ${special >= 100 ? "text-mfd-phosphor mfd-phosphor" : "text-mfd-text"}`}>
            {special >= 100 ? "ARMED [X]" : `${Math.round(special).toString().padStart(3, "0")}%`}
          </span>
        </div>
        )}
      </div>

      {/* weapon change flash */}
      <AnimatePresence>
        {flash && (
          <motion.div
            key={flash.id}
            className="pointer-events-none absolute inset-x-2 top-[26px] z-20 flex items-center justify-center border border-mfd-phosphor/50 bg-mfd-glass/95 py-1"
            initial={{ opacity: 0, scaleY: 0.2 }}
            animate={{ opacity: [0, 1, 0.7, 1], scaleY: 1 }}
            exit={{ opacity: 0, scaleY: 0.4 }}
            transition={{ duration: 0.28 }}
            style={{ boxShadow: "0 0 14px rgba(134,207,159,0.25)" }}
          >
            <span className="mfd-num font-mono text-[10px] font-bold tracking-[0.2em] text-mfd-phosphor mfd-phosphor">
              ▸ {weaponSpec(flash.weapon).name} SELECTED
            </span>
          </motion.div>
        )}
      </AnimatePresence>
    </div>
  );
}
