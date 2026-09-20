"use client";

import { useEffect, useRef, type RefObject } from "react";
import { useGame } from "@/game/store";
import { bus } from "@/lib/bus";

/* ------------------------------------------------------------------------
 * CockpitFrame — the physical structure the pilot sits inside: canopy
 * struts, corner reinforcements, a lower console deck with hand grips, and
 * a bank of warning lamps wired to real store state. Pure decoration layer:
 * pointer-events-none throughout, degrades to an inert dark frame if store
 * fields are empty or the bus never fires.
 * ---------------------------------------------------------------------- */

type LampState = "OFF" | "AMBER" | "RED";

function worse(a: LampState, b: LampState): LampState {
  const rank: Record<LampState, number> = { OFF: 0, AMBER: 1, RED: 2 };
  return rank[b] > rank[a] ? b : a;
}

function pulse(el: HTMLDivElement | null, cls: string) {
  if (!el) return;
  el.classList.remove(cls);
  void el.offsetWidth; // restart animation if it fires again quickly
  el.classList.add(cls);
}

function Bolt({ className = "" }: { className?: string }) {
  return (
    <span
      className={`inline-block h-[4px] w-[4px] shrink-0 rounded-full ${className}`}
      style={{
        background: "radial-gradient(circle at 35% 30%, var(--color-hud-gray), var(--color-hud-void) 70%)",
        boxShadow: "0 0 1px rgba(0,0,0,0.8)",
      }}
    />
  );
}

function Lamp({ label, state, wide = false }: { label: string; state: LampState; wide?: boolean }) {
  const glow =
    state === "RED"
      ? "0 0 7px 2px var(--color-hud-red)"
      : state === "AMBER"
        ? "0 0 6px 1px var(--color-hud-amber)"
        : "none";
  const fill =
    state === "RED"
      ? "bg-hud-red border-hud-red/80 animate-blink"
      : state === "AMBER"
        ? "bg-hud-amber border-hud-amber/80"
        : "bg-hud-void border-hud-line";
  return (
    <div className="flex flex-col items-center gap-[3px]">
      <div className={`${wide ? "w-[30px]" : "w-[13px]"} h-[8px] rounded-[1px] border ${fill}`} style={{ boxShadow: glow }} />
      <span className="whitespace-nowrap text-[6px] font-semibold uppercase leading-none tracking-[0.14em] text-hud-gray/80">
        {label}
      </span>
    </div>
  );
}

function MiniReadout({ label, pct }: { label: string; pct: number }) {
  const clamped = Math.max(0, Math.min(100, pct));
  const filled = Math.round((clamped / 100) * 10);
  return (
    <div className="flex flex-col gap-[2px]">
      <span className="text-[6px] uppercase leading-none tracking-[0.14em] text-hud-gray/70">{label}</span>
      <div className="flex gap-[1.5px]">
        {Array.from({ length: 10 }).map((_, i) => (
          <span
            key={i}
            className="h-[6px] w-[4px]"
            style={{ background: i < filled ? "var(--color-hud-green-dim)" : "var(--color-hud-line)" }}
          />
        ))}
      </div>
    </div>
  );
}

function MiniToggle({ label }: { label: string }) {
  return (
    <div className="flex flex-col items-center gap-[3px]">
      <div
        className="h-[10px] w-[6px] rounded-[1px] border border-hud-line bg-hud-deep"
        style={{ boxShadow: "inset 0 -3px 0 var(--color-hud-line)" }}
      />
      <span className="text-[6px] uppercase leading-none tracking-[0.1em] text-hud-gray/60">{label}</span>
    </div>
  );
}

/** L-shaped structural corner bracket, bevelled with a faint rim light. */
function Corner({ flipX = false, flipY = false }: { flipX?: boolean; flipY?: boolean }) {
  return (
    <div
      className="absolute h-[92px] w-[92px]"
      style={{
        top: flipY ? "auto" : 0,
        bottom: flipY ? 0 : "auto",
        left: flipX ? "auto" : 0,
        right: flipX ? 0 : "auto",
        transform: `scale(${flipX ? -1 : 1}, ${flipY ? -1 : 1})`,
        transformOrigin: "top left",
      }}
    >
      <div
        className="absolute inset-0 border border-hud-line/80"
        style={{
          clipPath: "polygon(0 0, 100% 0, 100% 30%, 30% 30%, 30% 100%, 0 100%)",
          background: "linear-gradient(135deg, var(--color-hud-panel), var(--color-hud-deep) 55%, var(--color-hud-void))",
          boxShadow:
            "inset 1px 1px 0 rgba(232,244,242,0.07), inset -1px -1px 0 rgba(0,0,0,0.6), 0 0 14px rgba(0,0,0,0.5)",
        }}
      />
      <div className="absolute left-[8px] top-[8px] flex items-center gap-[26px]">
        <Bolt />
        <Bolt />
      </div>
      <div className="absolute left-[8px] top-[30px] flex flex-col items-center gap-[26px]">
        <Bolt />
      </div>
    </div>
  );
}

/** Vertical side strut with a slight inward taper — hints at canopy curvature. */
function SideStrut({ side }: { side: "left" | "right" }) {
  const isLeft = side === "left";
  return (
    <div
      className={`absolute top-[92px] bottom-[92px] w-[12px] ${isLeft ? "left-0" : "right-0"}`}
      style={{
        clipPath: isLeft
          ? "polygon(0 0, 100% 6%, 100% 94%, 0 100%)"
          : "polygon(100% 0, 0 6%, 0 94%, 100% 100%)",
        background: "linear-gradient(180deg, var(--color-hud-panel), var(--color-hud-deep) 50%, var(--color-hud-panel))",
        boxShadow: isLeft
          ? "inset 1px 0 0 rgba(232,244,242,0.06), inset -1px 0 0 rgba(0,0,0,0.6)"
          : "inset -1px 0 0 rgba(232,244,242,0.06), inset 1px 0 0 rgba(0,0,0,0.6)",
      }}
    >
      <div className="flex h-full flex-col items-center justify-between py-6">
        <Bolt />
        <Bolt />
        <Bolt />
        <Bolt />
      </div>
    </div>
  );
}

function HandGrip({ side, gripRef }: { side: "left" | "right"; gripRef: RefObject<HTMLDivElement | null> }) {
  const isLeft = side === "left";
  return (
    <div
      className={`pointer-events-none absolute bottom-[4px] ${isLeft ? "left-[10px]" : "right-[10px]"} h-[78px] w-[46px]`}
      style={{ transformOrigin: isLeft ? "bottom left" : "bottom right" }}
    >
      <div
        ref={gripRef}
        className={isLeft ? "cf-grip-idle" : "cf-grip-idle"}
        style={{ transformOrigin: isLeft ? "bottom left" : "bottom right", willChange: "transform" }}
      >
        <svg viewBox="0 0 46 78" width="46" height="78" aria-hidden>
          <defs>
            <linearGradient id={`cf-grip-${side}`} x1="0" y1="0" x2="1" y2="1">
              <stop offset="0%" stopColor="var(--color-hud-panel)" />
              <stop offset="60%" stopColor="var(--color-hud-void)" />
              <stop offset="100%" stopColor="#000" />
            </linearGradient>
          </defs>
          <path
            d={
              isLeft
                ? "M8,78 C4,60 4,44 12,30 C18,19 30,12 40,8 L40,2 L30,2 C16,6 6,16 3,32 C-1,48 1,64 4,78 Z"
                : "M38,78 C42,60 42,44 34,30 C28,19 16,12 6,8 L6,2 L16,2 C30,6 40,16 43,32 C47,48 45,64 42,78 Z"
            }
            fill={`url(#cf-grip-${side})`}
            stroke="var(--color-hud-line)"
            strokeWidth="1"
          />
        </svg>
      </div>
    </div>
  );
}

function SeatHarness({ side }: { side: "left" | "right" }) {
  const isLeft = side === "left";
  return (
    <svg
      className={`pointer-events-none absolute bottom-0 ${isLeft ? "left-0" : "right-0"} h-[3vh] w-[3vw] opacity-40`}
      viewBox="0 0 60 60"
      preserveAspectRatio="none"
      aria-hidden
    >
      <path
        d={isLeft ? "M0,60 L0,10 L60,60 Z" : "M60,60 L60,10 L0,60 Z"}
        fill="var(--color-hud-void)"
        stroke="var(--color-hud-line)"
        strokeWidth="1"
      />
      <line
        x1={isLeft ? "4" : "56"}
        y1="14"
        x2={isLeft ? "50" : "10"}
        y2="56"
        stroke="var(--color-hud-dim)"
        strokeWidth="2"
      />
    </svg>
  );
}

export function CockpitFrame() {
  const phase = useGame((s) => s.phase);
  const armor = useGame((s) => s.player.armor);
  const heat = useGame((s) => s.player.heat);
  const energy = useGame((s) => s.player.energy);
  const boost = useGame((s) => s.player.boost);
  const targetId = useGame((s) => s.targetId);
  const enemies = useGame((s) => s.enemies);
  const neuralOnline = useGame((s) => s.neuralOnline);
  const voiceLink = useGame((s) => s.voiceLink);

  const leftGripRef = useRef<HTMLDivElement>(null);
  const rightGripRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    return bus.on("cmd:executed", ({ command, result }) => {
      if (!result.ok) return;
      if (command.action === "BOOST") pulse(leftGripRef.current, "cf-grip-lean");
      if (command.action === "ATTACK" || command.action === "FIRE_SPECIAL") {
        pulse(rightGripRef.current, "cf-grip-twitch");
      }
    });
  }, []);

  // Structure lights before the panels — from BOOT onward, ahead of the
  // panel-by-panel COCKPIT_BOOT sequence.
  const structureOnline = phase !== "STANDBY" && phase !== "WAKE";

  const armorState: LampState = armor < 20 ? "RED" : armor < 50 ? "AMBER" : "OFF";
  const heatState: LampState = heat >= 90 ? "RED" : heat >= 60 ? "AMBER" : "OFF";

  const hostileClose = enemies.some((e) => e.state !== "DESTROYED" && e.distance > 0 && e.distance < 250);
  const lockState: LampState =
    targetId != null ? "OFF" : hostileClose ? "RED" : enemies.length > 0 ? "AMBER" : "OFF";

  const linkState: LampState =
    voiceLink === "ERROR" ? "RED" : !neuralOnline || voiceLink === "MUTED" || voiceLink === "OFFLINE" ? "AMBER" : "OFF";

  const masterState: LampState = [armorState, heatState, lockState, linkState].reduce(worse, "OFF" as LampState) === "RED"
    ? "RED"
    : "OFF";

  const active = structureOnline;

  return (
    <>
      {/* eslint-disable-next-line react/no-unknown-property */}
      <style>{`
        @keyframes cfGripLean {
          0% { transform: rotate(0deg) translateY(0); }
          25% { transform: rotate(-10deg) translateY(-3px); }
          100% { transform: rotate(0deg) translateY(0); }
        }
        @keyframes cfGripTwitch {
          0% { transform: translate(0, 0) rotate(0deg); }
          15% { transform: translate(2px, -2px) rotate(4deg); }
          30% { transform: translate(-1px, 1px) rotate(-3deg); }
          100% { transform: translate(0, 0) rotate(0deg); }
        }
        .cf-grip-idle { transition: transform 200ms ease-out; }
        .cf-grip-lean { animation: cfGripLean 520ms ease-out 1; }
        .cf-grip-twitch { animation: cfGripTwitch 260ms ease-out 1; }
      `}</style>

      {/* ---- back layer: sits behind the HUD grid, ambient depth only ---- */}
      <div className="pointer-events-none absolute inset-0 z-[5] overflow-hidden">
        {/* lower console deck */}
        <div
          className="absolute inset-x-0 bottom-0 h-[124px] transition-opacity duration-700"
          style={{
            opacity: active ? 1 : 0.35,
            background: "linear-gradient(180deg, rgba(11,18,25,0) 0%, var(--color-hud-panel) 38%, var(--color-hud-deep) 100%)",
            boxShadow: "inset 0 18px 20px -12px rgba(0,0,0,0.7)",
            borderTop: "1px solid var(--color-hud-line)",
          }}
        >
          <div className="flex h-full items-end justify-between px-6 pb-3">
            <div className="flex items-end gap-4">
              <div className="flex gap-3">
                <div className="flex flex-col items-center gap-[3px]">
                  <div
                    className="h-[8px] w-[13px] rounded-[1px] border border-hud-green-dim/70"
                    style={{
                      background: active ? "var(--color-hud-green-dim)" : "var(--color-hud-void)",
                      boxShadow: active ? "0 0 5px 1px var(--color-hud-green-dim)" : "none",
                    }}
                  />
                  <span className="whitespace-nowrap text-[6px] font-semibold uppercase leading-none tracking-[0.14em] text-hud-gray/80">
                    PWR
                  </span>
                </div>
                <MiniToggle label="AUX" />
                <MiniToggle label="NAV" />
              </div>
              <MiniReadout label="BOOST" pct={active ? boost : 0} />
            </div>
            <div className="flex items-end gap-4">
              <MiniReadout label="ENERGY" pct={active ? energy : 0} />
              <div className="flex gap-3">
                <MiniToggle label="COM" />
                <MiniToggle label="ARM" />
              </div>
            </div>
          </div>

          <HandGrip side="left" gripRef={leftGripRef} />
          <HandGrip side="right" gripRef={rightGripRef} />
        </div>

        <SeatHarness side="left" />
        <SeatHarness side="right" />
      </div>

      {/* ---- front layer: struts, corners, lamps, glass — in front of the screens ---- */}
      <div className="pointer-events-none absolute inset-0 z-20 overflow-hidden">
        <Corner />
        <Corner flipX />
        <Corner flipY />
        <Corner flipX flipY />

        <div
          className="absolute left-[92px] right-[92px] top-0 h-[7px]"
          style={{
            background: "linear-gradient(180deg, var(--color-hud-panel), var(--color-hud-void))",
            boxShadow: "inset 0 1px 0 rgba(232,244,242,0.06)",
          }}
        >
          <div className="flex h-full items-center justify-between px-8">
            <Bolt />
            <Bolt />
            <Bolt />
            <Bolt />
            <Bolt />
            <Bolt />
          </div>
        </div>

        <SideStrut side="left" />
        <SideStrut side="right" />

        {/* glare-shield lamp hood, hanging from the top strut, centered */}
        <div
          className="absolute left-1/2 top-0 -translate-x-1/2 transition-opacity duration-700"
          style={{
            opacity: active ? 1 : 0.3,
            width: 340,
            clipPath: "polygon(4% 0, 96% 0, 100% 100%, 0 100%)",
            background: "linear-gradient(180deg, var(--color-hud-panel), var(--color-hud-deep) 80%)",
            boxShadow: "inset 0 -1px 0 rgba(0,0,0,0.6), 0 4px 10px rgba(0,0,0,0.5)",
          }}
        >
          <div className="flex items-center justify-center gap-4 pb-2 pt-1.5">
            <Lamp label="CAUTION" state={active ? masterState : "OFF"} wide />
            <Lamp label="ARMOR" state={active ? armorState : "OFF"} />
            <Lamp label="HEAT" state={active ? heatState : "OFF"} />
            <Lamp label="LOCK" state={active ? lockState : "OFF"} />
            <Lamp label="LINK" state={active ? linkState : "OFF"} />
          </div>
        </div>

        {/* glass reflection sheen */}
        <div
          className="absolute inset-0"
          style={{
            background: "linear-gradient(118deg, transparent 32%, rgba(232,244,242,0.05) 47%, transparent 62%)",
          }}
        />

        {/* ambient occlusion where the frame meets the screens */}
        <div
          className="absolute inset-0"
          style={{
            boxShadow: "inset 0 0 46px rgba(0,0,0,0.55), inset 0 0 4px rgba(0,0,0,0.85)",
          }}
        />
      </div>
    </>
  );
}
