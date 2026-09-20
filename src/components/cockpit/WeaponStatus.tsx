"use client";

import { useEffect, useState } from "react";
import { AnimatePresence, motion } from "motion/react";
import { useGame } from "@/game/store";
import { bus } from "@/lib/bus";
import { WEAPONS, weaponSpec, type WeaponId, type WeaponSpec } from "@/lib/config";
import type { Enemy } from "@/game/types";
import { runManualCommand } from "@/voice/pipeline";
import { Gauge, Lamp, highIsBad, lowIsBad, toneClass, type LampColor } from "./instruments";

type FireMode = "BURST" | "PRECISION" | "BARRAGE";
const HEAT_MAX = 100;
const MODE_KEY: Record<FireMode, string> = { BURST: "F", PRECISION: "VOICE", BARRAGE: "VOICE" };

const HELD = WEAPONS.filter((w) => w.kind === "HELD");
const ORDNANCE = WEAPONS.filter((w) => w.kind === "ORDNANCE");
const SUPPORT = WEAPONS.filter((w) => w.kind === "SUPPORT");
const INDEX = new Map(WEAPONS.map((w, i) => [w.id, i + 1]));

interface Banner {
  id: number;
  text: string;
  tone: LampColor;
  /** Countdown target; text gets the seconds appended while it's in the future. */
  untilMs?: number;
}

/* ------------------------------------------------------------ helpers */

function fmtRange(spec: WeaponSpec): string {
  return spec.maxRange === null ? "UNLTD" : `${spec.maxRange} m`;
}
function secs(ms: number): string {
  return `${(Math.max(0, ms) / 1000).toFixed(1)} s`;
}

interface Live {
  ammoLeft: number | null; // null = unlimited
  readyIn: number; // ms until ready, 0 = ready
  outOfRange: boolean;
  tooClose: boolean;
}

function liveFor(spec: WeaponSpec, ammo: Partial<Record<WeaponId, number>>, readyAt: Partial<Record<WeaponId, number>>, now: number, target: Enemy | null): Live {
  const ammoLeft = spec.ammo === null ? null : (ammo[spec.id] ?? spec.ammo);
  const readyIn = Math.max(0, (readyAt[spec.id] ?? 0) - now);
  const dist = target ? target.distance : null;
  return {
    ammoLeft,
    readyIn,
    outOfRange: dist !== null && spec.maxRange !== null && dist > spec.maxRange,
    tooClose: dist !== null && spec.minRange !== undefined && dist < spec.minRange,
  };
}

/* ---------------------------------------------------------- sub-parts */

function Stat({ k, v, lit }: { k: string; v: string; lit: boolean }) {
  return (
    <span className="flex items-baseline gap-[3px] whitespace-nowrap">
      <span className="mfd-label text-[7px]">{k}</span>
      <span className={`mfd-num font-mono text-[8.5px] ${lit ? "text-mfd-text" : "text-mfd-muted"}`}>{v}</span>
    </span>
  );
}

function Ammo({ spec, left, lit }: { spec: WeaponSpec; left: number | null; lit: boolean }) {
  if (left === null) return <span className={`mfd-num font-mono text-[10px] ${lit ? "text-mfd-phosphor" : "text-mfd-muted"}`}>∞</span>;
  if (spec.ammo === 1) {
    return (
      <span className="flex items-center gap-[4px]">
        <Lamp color={left > 0 ? "red" : "off"} size="sm" />
        <span className={`mfd-num font-mono text-[8.5px] ${left > 0 ? "text-mfd-text" : "text-mfd-muted"}`}>{left}</span>
      </span>
    );
  }
  return (
    <span className="flex items-center gap-[2px]" title={`${left}/${spec.ammo}`}>
      {Array.from({ length: spec.ammo ?? 0 }).map((_, i) => (
        <span
          key={i}
          className="inline-block h-[6px] w-[6px] rounded-full"
          style={{
            background: i < left ? "var(--color-mfd-phosphor)" : "transparent",
            boxShadow: i < left ? "0 0 4px rgba(134,207,159,0.6), inset 0 0 0 1px rgba(0,0,0,0.5)" : "inset 0 0 0 1px rgba(134,207,159,0.35)",
          }}
        />
      ))}
    </span>
  );
}

function Cooldown({ spec, readyIn }: { spec: WeaponSpec; readyIn: number }) {
  if (!spec.cooldownMs) return null;
  const pct = Math.max(0, Math.min(100, (readyIn / spec.cooldownMs) * 100));
  return (
    <div className="flex items-center gap-[5px]">
      <div className="mfd-bar flex-1" style={{ height: 3 }}>
        <div className="mfd-bar-fill" style={{ width: `calc(${100 - pct}% - 2px)`, background: readyIn > 0 ? "var(--color-mfd-amber)" : "var(--color-mfd-phosphor)", transition: "none" }} />
      </div>
      <span className={`mfd-num w-[30px] text-right font-mono text-[7.5px] ${readyIn > 0 ? "text-mfd-amber" : "text-mfd-muted"}`}>
        {readyIn > 0 ? secs(readyIn) : "RDY"}
      </span>
    </div>
  );
}

function SelectedBracket() {
  return (
    <motion.span
      layoutId="weapon-selected-bracket"
      className="pointer-events-none absolute inset-[-1px] border border-mfd-phosphor/60"
      style={{ boxShadow: "0 0 8px rgba(134,207,159,0.25)" }}
      transition={{ type: "spring", stiffness: 500, damping: 38 }}
    />
  );
}

interface SlotProps {
  spec: WeaponSpec;
  live: Live;
  selected: boolean;
  compact: boolean;
  onSelect: (id: WeaponId) => void;
}

/** HELD weapon: single line, stats appear when selected (or always in roomy mode). */
function HeldSlot({ spec, live, selected, compact, onSelect }: SlotProps) {
  const rangeTone = live.outOfRange ? "text-mfd-red mfd-glow-red" : selected ? "text-mfd-phosphor" : "text-mfd-muted";
  return (
    <button type="button" className={`weapon-slot px-2 ${compact ? "py-[2px]" : "py-[3px]"}`} data-selected={selected} onClick={() => onSelect(spec.id)} aria-pressed={selected} title={spec.role}>
      {selected && <SelectedBracket />}
      <div className="flex items-center gap-2">
        <Lamp color={selected ? "green" : "off"} size="sm" />
        <span className={`mfd-num w-[24px] shrink-0 font-mono text-[9px] font-bold ${selected ? "text-mfd-phosphor mfd-phosphor" : "text-mfd-muted"}`}>{INDEX.get(spec.id)}·{spec.tag}</span>
        <span className={`mfd-label flex-1 truncate text-[8.5px] tracking-[0.14em] ${selected ? "text-mfd-text" : "text-mfd-muted"}`}>{spec.name}</span>
        <span className={`mfd-num shrink-0 font-mono text-[8.5px] ${rangeTone}`}>{fmtRange(spec)}</span>
        {!compact && <Ammo spec={spec} left={live.ammoLeft} lit={selected} />}
      </div>
      {selected && !compact && (
        <div className="mt-[1px] flex gap-3 pl-[24px]">
          <Stat k="DMG" v={String(spec.damage)} lit={selected} />
          <Stat k="HEAT" v={String(spec.heat)} lit={selected} />
          <Stat k="EN" v={String(spec.energy)} lit={selected} />
          <Stat k="CONE" v={`${spec.splashDeg}°`} lit={selected} />
          {spec.rounds && <Stat k="RDS" v={String(spec.rounds)} lit={selected} />}
        </div>
      )}
    </button>
  );
}

/** ORDNANCE / SUPPORT card: ammo pips, cooldown, extra stats. NUKE gets the safety cover. */
const SHORT_NAME: Partial<Record<WeaponId, string>> = { INCENDIARY: "INCENDIARY", NUKE: "TACTICAL NUKE", FLEET_CANNON: "FLEET CANNON" };

function Card({ spec, live, selected, compact, onSelect }: SlotProps) {
  const nuke = spec.id === "NUKE";
  const spent = live.ammoLeft !== null && live.ammoLeft <= 0;
  const showStats = selected || !compact;
  return (
    <button type="button" className={`weapon-card px-2 ${compact ? "py-[3px]" : "pb-[4px] pt-[5px]"}`} data-selected={selected} data-hazard={nuke} onClick={() => onSelect(spec.id)} aria-pressed={selected} title={spec.role}>
      {nuke && <span className="hazard-stripe absolute inset-x-0 top-0 h-[3px]" aria-hidden />}
      {selected && <SelectedBracket />}
      <div className={`flex items-center gap-[6px] ${nuke ? "mt-[2px]" : ""}`}>
        <Lamp color={selected ? (nuke ? "red" : "green") : "off"} size="sm" blink={nuke && selected} />
        <span className={`mfd-num shrink-0 font-mono text-[9px] font-bold ${selected ? (nuke ? "text-mfd-amber mfd-glow-amber" : "text-mfd-phosphor mfd-phosphor") : "text-mfd-muted"}`}>{INDEX.get(spec.id)}·{spec.tag}</span>
        <span className={`mfd-label min-w-0 flex-1 truncate text-[7.5px] ${selected ? "text-mfd-text" : "text-mfd-muted"}`}>{SHORT_NAME[spec.id] ?? spec.name}</span>
      </div>
      {showStats && (
      <div className="mt-[3px] flex flex-wrap gap-x-[8px] gap-y-[1px] pl-[1px]">
        <Stat k="DMG" v={String(spec.damage)} lit={selected} />
        {spec.rounds && <Stat k="RDS" v={String(spec.rounds)} lit={selected} />}
        {spec.burn && <Stat k="BURN" v={`${spec.burn.dps}×${spec.burn.ms / 1000}s`} lit={selected} />}
        {spec.delayMs && <Stat k="TOF" v={`${spec.delayMs / 1000}s`} lit={selected} />}
        {spec.minRange && <Stat k="MIN" v={`${spec.minRange}m`} lit={selected} />}
        {spec.maxRange !== null && <Stat k="MAX" v={`${spec.maxRange}m`} lit={selected} />}
        <Stat k="CONE" v={`${spec.splashDeg}°`} lit={selected} />
      </div>
      )}
      <div className="mt-[3px] flex items-center gap-2">
        {nuke ? (
          <span className="flex items-center gap-[5px]">
            <span className={`mfd-label text-[7px] ${selected && !spent ? "text-mfd-red mfd-glow-red animate-blink" : ""}`}>{spent ? "EXPENDED" : selected ? "ARMED" : "SAFE"}</span>
            {live.tooClose && <span className="mfd-label text-[7px] text-mfd-red mfd-glow-red">TOO CLOSE</span>}
          </span>
        ) : (
          <div className="flex-1"><Cooldown spec={spec} readyIn={live.readyIn} /></div>
        )}
        {live.outOfRange && <span className="mfd-label text-[7px] text-mfd-red">RANGE</span>}
        <span className="ml-auto"><Ammo spec={spec} left={live.ammoLeft} lit={selected} /></span>
      </div>
    </button>
  );
}

/* --------------------------------------------------------------- main */

/** Weapon selector: HELD 1–4, ORDNANCE block, SUPPORT block; ammo, cooldowns, range checks, live gauges. */
export function WeaponStatus({ compact = false }: { compact?: boolean }) {
  const weapon = useGame((s) => s.player.weapon);
  const heat = useGame((s) => s.player.heat);
  const energy = useGame((s) => s.player.energy);
  const ammo = useGame((s) => s.player.ammo);
  const readyAt = useGame((s) => s.player.weaponReadyAt);
  const target = useGame((s) => (s.targetId ? (s.enemies.find((e) => e.id === s.targetId) ?? null) : null));

  const [mode, setMode] = useState<FireMode>("BURST");
  const [banner, setBanner] = useState<Banner | null>(null);
  const [now, setNow] = useState(() => Date.now());

  // Ticking clock only while something is counting down.
  const pendingReady = Object.values(readyAt).some((t) => t !== undefined && t > now);
  const pendingBanner = banner?.untilMs !== undefined && banner.untilMs > now;
  useEffect(() => {
    if (!pendingReady && !pendingBanner) return;
    const id = window.setInterval(() => setNow(Date.now()), 100);
    return () => window.clearInterval(id);
  }, [pendingReady, pendingBanner]);

  useEffect(() => {
    let seq = 0;
    let timer: number | null = null;
    const show = (text: string, tone: LampColor, ttl: number, untilMs?: number) => {
      seq += 1;
      setBanner({ id: seq, text, tone, untilMs });
      setNow(Date.now());
      if (timer !== null) window.clearTimeout(timer);
      timer = window.setTimeout(() => setBanner(null), ttl);
    };
    const offs = [
      bus.on("cmd:executed", ({ command, result }) => {
        if (command.action === "ATTACK" && result.ok) setMode(command.mode ?? "BURST");
      }),
      bus.on("weapon:changed", ({ weapon: next }) => show(`▸ ${weaponSpec(next).name} SELECTED`, next === "NUKE" ? "amber" : "green", 1100)),
      bus.on("fx:nuke", () => show("NUCLEAR DETONATION", "red", 2600)),
      bus.on("fx:fleetCall", ({ impactAtMs, rounds }) => show(`FLEET FIRE MISSION ×${rounds} —`, "amber", Math.max(500, impactAtMs - Date.now() + 200), impactAtMs)),
      bus.on("fx:fleetImpact", () => show("FLEET SHELLS IMPACT", "green", 1600)),
    ];
    return () => {
      offs.forEach((off) => off());
      if (timer !== null) window.clearTimeout(timer);
    };
  }, []);

  const spec = weaponSpec(weapon);
  const liveTarget = target && target.state !== "DESTROYED" ? target : null;
  const sel = liveFor(spec, ammo, readyAt, now, liveTarget);

  let readiness: { text: string; tone: LampColor; blink: boolean } = { text: "READY", tone: "green", blink: false };
  if (sel.ammoLeft !== null && sel.ammoLeft <= 0) readiness = { text: "EMPTY", tone: "red", blink: false };
  else if (sel.readyIn > 0) readiness = { text: `RELOAD ${secs(sel.readyIn)}`, tone: "amber", blink: false };
  else if (heat >= HEAT_MAX) readiness = { text: "OVERHEAT", tone: "red", blink: true };
  else if (energy < spec.energy) readiness = { text: "LOW ENERGY", tone: "amber", blink: false };
  else if (sel.tooClose) readiness = { text: "TOO CLOSE", tone: "red", blink: true };
  else if (sel.outOfRange) readiness = { text: "RANGE", tone: "red", blink: true };
  else if (spec.id === "NUKE") readiness = { text: "ARMED", tone: "amber", blink: true };

  const select = (id: WeaponId) => {
    if (id !== weapon) runManualCommand({ action: "SWITCH_WEAPON", weapon: id });
  };

  const bannerText = banner && banner.untilMs !== undefined ? `${banner.text} ${secs(banner.untilMs - now)}` : banner?.text;

  return (
    <div className={`relative flex h-full min-h-0 flex-col ${compact ? "gap-[3px] p-2" : "gap-1 p-2.5"}`}>
      <div className="flex items-center justify-between">
        <span className="flex items-center gap-[6px]">
          <Lamp color={readiness.tone} size="sm" blink={readiness.blink} />
          <span className={`mfd-num font-mono text-[10px] font-bold tracking-[0.14em] ${toneClass(readiness.tone)}`}>{readiness.text}</span>
        </span>
        <span className="mfd-label">
          MODE <span className="mfd-num text-mfd-text">{mode}</span> <span className="text-[7px] opacity-70">[{MODE_KEY[mode]}]</span>
        </span>
      </div>

      <div className="mfd-divider mfd-label text-[7px]">{compact ? "" : "HELD"}</div>
      <div className={compact ? "grid grid-cols-2 gap-[3px]" : "flex flex-col gap-[3px]"}>
        {HELD.map((w) => (
          <HeldSlot key={w.id} spec={w} live={liveFor(w, ammo, readyAt, now, liveTarget)} selected={w.id === weapon} compact={compact} onSelect={select} />
        ))}
      </div>
      {compact && spec.kind === "HELD" && (
        <div className="flex gap-3 pl-1">
          <Stat k="DMG" v={String(spec.damage)} lit />
          <Stat k="HEAT" v={String(spec.heat)} lit />
          <Stat k="EN" v={String(spec.energy)} lit />
          <Stat k="CONE" v={`${spec.splashDeg}°`} lit />
          {spec.rounds && <Stat k="RDS" v={String(spec.rounds)} lit />}
          <span className="mfd-num ml-auto font-mono text-[8.5px] text-mfd-muted">∞</span>
        </div>
      )}

      <div className="mfd-divider mfd-label text-[7px] text-mfd-amber/80">{compact ? "" : "ORDNANCE"}</div>
      <div className="grid grid-cols-2 gap-[4px]">
        {ORDNANCE.map((w) => (
          <Card key={w.id} spec={w} live={liveFor(w, ammo, readyAt, now, liveTarget)} selected={w.id === weapon} compact={compact} onSelect={select} />
        ))}
      </div>

      <div className="mfd-divider mfd-label text-[7px]">{compact ? "" : "SUPPORT"}</div>
      {SUPPORT.map((w) => (
        <Card key={w.id} spec={w} live={liveFor(w, ammo, readyAt, now, liveTarget)} selected={w.id === weapon} compact={compact} onSelect={select} />
      ))}

      {/* target + range checks */}
      <div className={`flex items-center justify-between border-t border-mfd-phosphor-faint ${compact ? "pt-[2px]" : "pt-1"}`}>
        <span className="mfd-label">TGT</span>
        {liveTarget ? (
          <span className="mfd-num flex items-baseline gap-2 font-mono text-[9px] text-mfd-text">
            <span className="truncate">{liveTarget.codename}</span>
            <span className="text-mfd-muted">{Math.round(liveTarget.bearing).toString().padStart(3, "0")}°</span>
            <span className={sel.outOfRange || sel.tooClose ? "text-mfd-red mfd-glow-red" : "text-mfd-phosphor"}>{Math.round(liveTarget.distance).toString().padStart(4, "0")} m</span>
          </span>
        ) : (
          <span className="mfd-label text-mfd-muted">NO LOCK</span>
        )}
      </div>
      {(sel.outOfRange || sel.tooClose) && liveTarget && (
        <div className="flex items-center gap-[6px] border border-mfd-red/50 bg-mfd-red/10 px-2 py-[2px]">
          <Lamp color="red" size="sm" blink />
          <span className="mfd-num font-mono text-[8.5px] font-bold tracking-[0.12em] text-mfd-red mfd-glow-red">
            {sel.tooClose
              ? `TOO CLOSE ${Math.round(liveTarget.distance)} m < MIN ${spec.minRange} m`
              : `RANGE ${Math.round(liveTarget.distance)} m > ${spec.maxRange} m${compact ? "" : " — CLOSE IN OR SWITCH"}`}
          </span>
        </div>
      )}

      {/* live heat / energy with next-shot cost */}
      <div className={compact ? "mt-auto grid grid-cols-2 gap-x-3" : "mt-auto flex flex-col gap-1"}>
        <Gauge label={`HEAT · NEXT +${spec.heat}`} value={heat} color={highIsBad(heat)} redBand={[85, 100]} cost={[heat, Math.min(100, heat + spec.heat)]} compact />
        <Gauge label={`ENERGY · NEXT -${spec.energy}`} value={energy} color={lowIsBad(energy)} cost={[Math.max(0, energy - spec.energy), energy]} compact />
      </div>

      <AnimatePresence>
        {banner && (
          <motion.div
            key={banner.id}
            className={`pointer-events-none absolute inset-x-2 top-[26px] z-20 flex items-center justify-center border py-1 ${
              banner.tone === "red" ? "border-mfd-red/70 bg-mfd-red/15" : banner.tone === "amber" ? "border-mfd-amber/60 bg-mfd-glass/95" : "border-mfd-phosphor/50 bg-mfd-glass/95"
            }`}
            initial={{ opacity: 0, scaleY: 0.2 }}
            animate={{ opacity: [0, 1, 0.7, 1], scaleY: 1 }}
            exit={{ opacity: 0, scaleY: 0.4 }}
            transition={{ duration: 0.28 }}
            style={{ boxShadow: "0 0 14px rgba(134,207,159,0.25)" }}
          >
            <span className={`mfd-num font-mono text-[10px] font-bold tracking-[0.2em] ${toneClass(banner.tone)}`}>{bannerText}</span>
          </motion.div>
        )}
      </AnimatePresence>
    </div>
  );
}
