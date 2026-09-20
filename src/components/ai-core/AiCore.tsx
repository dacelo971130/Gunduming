"use client";

import { useEffect, useRef, useState } from "react";
import { motion, type TargetAndTransition, type Transition } from "motion/react";
import { useGame } from "@/game/store";
import { usePanelOnline } from "@/components/cockpit/PanelFrame";
import { AI_NAME } from "@/lib/config";
import { bus } from "@/lib/bus";
import type { AiStatus } from "@/game/types";

const CAPTION_BY_STATUS: Partial<Record<AiStatus, string>> = {
  LISTENING: "VOICE INPUT / LISTENING",
  THINKING: "TACTICAL ANALYSIS / PROCESSING...",
  SPEAKING: "AI CORE / SPEAKING",
};

/** Transient reaction to a bus event — overrides the idle/status pose briefly. */
type Reaction = "HIT" | "KILL" | "ALERT" | null;
/** Everything the body layer can be posed as. */
type Pose = AiStatus | "HIT" | "KILL" | "ALERT" | "BOSS";

const SCAN_DOTS = Array.from({ length: 8 }).map((_, i) => i * 45);
const VENT_TICKS = Array.from({ length: 8 }).map((_, i) => i * 45 + 20);
const THRUSTER_ANGLES = [148, 180, 212];
const WAVE_TICKS = [110, 135, 160, 200, 225, 250];

function useTypewriter(text: string, speed = 22) {
  const [out, setOut] = useState("");
  useEffect(() => {
    setOut("");
    if (!text) return;
    let i = 0;
    const id = window.setInterval(() => {
      i += 1;
      setOut(text.slice(0, i));
      if (i >= text.length) window.clearInterval(id);
    }, speed);
    return () => window.clearInterval(id);
  }, [text, speed]);
  return out;
}

/** deg 0 = straight up, clockwise — matches the SVG viewBox's 50,50 centre. */
function polar(r: number, deg: number) {
  const rad = (deg * Math.PI) / 180;
  return { x: 50 + r * Math.sin(rad), y: 50 - r * Math.cos(rad) };
}

function bodyPose(pose: Pose): { animate: TargetAndTransition; transition: Transition } {
  switch (pose) {
    case "OFFLINE":
      return { animate: { x: 0, y: 6, scale: 0.9, rotate: 0, opacity: 0.45 }, transition: { duration: 0.5 } };
    case "LISTENING":
      return { animate: { x: 0, y: -3, scale: 1.06, rotate: 0 }, transition: { duration: 0.4, ease: "easeOut" } };
    case "THINKING":
      return { animate: { rotate: [0, -2, 2, 0], scale: 0.98 }, transition: { duration: 1.8, repeat: Infinity, ease: "easeInOut" } };
    case "SPEAKING":
      return { animate: { y: [0, -2, 0, -1.5, 0], scale: 1 }, transition: { duration: 0.9, repeat: Infinity, ease: "easeInOut" } };
    case "HIT":
      return { animate: { x: [0, -7, 4, -2, 0], rotate: [0, -4, 3, 0], scale: [1, 0.93, 1.04, 1] }, transition: { duration: 0.5, ease: "easeOut" } };
    case "KILL":
      return { animate: { y: [0, -4, 0], scale: [1, 1.12, 1], rotate: [0, 360] }, transition: { duration: 0.65, ease: "easeInOut" } };
    case "ALERT":
      return { animate: { x: [0, -4, 4, -3, 3, 0], y: 0 }, transition: { duration: 0.55, ease: "easeInOut" } };
    case "BOSS":
      return { animate: { y: -5, scale: 0.92, x: 0, rotate: 0 }, transition: { duration: 0.5, ease: "easeOut" } };
    case "IDLE":
    default:
      return { animate: { x: 0, y: 0, scale: 1, rotate: 0, opacity: 1 }, transition: { duration: 0.4 } };
  }
}

function ringMotion(status: AiStatus, wary: boolean): { animate: TargetAndTransition; transition: Transition } {
  if (status === "THINKING") return { animate: { rotate: -360 }, transition: { duration: 1.1, repeat: Infinity, ease: "linear" } };
  if (status === "LISTENING") return { animate: { rotate: 360 }, transition: { duration: 3, repeat: Infinity, ease: "linear" } };
  if (status === "OFFLINE") return { animate: { rotate: 0 }, transition: { duration: 0 } };
  if (wary) return { animate: { rotate: 360 }, transition: { duration: 40, repeat: Infinity, ease: "linear" } };
  return { animate: { rotate: 360 }, transition: { duration: 16, repeat: Infinity, ease: "linear" } };
}

function irisMotion(status: AiStatus): { animate: TargetAndTransition; transition: Transition } {
  switch (status) {
    case "SPEAKING":
      return { animate: { scale: [1, 1.3, 0.85, 1.2, 1] }, transition: { duration: 0.55, repeat: Infinity, ease: "easeInOut" } };
    case "LISTENING":
      return { animate: { scale: [1, 1.08, 1] }, transition: { duration: 1, repeat: Infinity, ease: "easeInOut" } };
    case "OFFLINE":
      return { animate: { scale: 1, opacity: 0.25 }, transition: { duration: 0.4 } };
    default:
      return { animate: { scale: [1, 1.04, 1], opacity: [0.85, 1, 0.85] }, transition: { duration: 3.2, repeat: Infinity, ease: "easeInOut" } };
  }
}

function thrusterMotion(pose: Pose): { animate: TargetAndTransition; transition: Transition } {
  switch (pose) {
    case "SPEAKING":
      return { animate: { opacity: [0.3, 1, 0.3, 0.8, 0.3] }, transition: { duration: 0.6, repeat: Infinity } };
    case "LISTENING":
      return { animate: { opacity: [0.4, 1, 0.6] }, transition: { duration: 0.5, repeat: Infinity } };
    case "HIT":
      return { animate: { opacity: [1, 0.2, 0.8] }, transition: { duration: 0.4 } };
    case "KILL":
      return { animate: { opacity: [0.5, 1, 0.4] }, transition: { duration: 0.5 } };
    case "BOSS":
      return { animate: { opacity: 0.3 }, transition: { duration: 0.4 } };
    case "OFFLINE":
      return { animate: { opacity: 0.1 }, transition: { duration: 0.4 } };
    default:
      return { animate: { opacity: [0.35, 0.55, 0.35] }, transition: { duration: 3, repeat: Infinity } };
  }
}

/** ECHO-01's floating presence — the emotional anchor of the demo. */
export function AiCore() {
  const online = usePanelOnline("ai-core");
  const status = useGame((s) => s.aiStatus);
  const caption = useGame((s) => s.aiCaption);
  const phase = useGame((s) => s.phase);
  const hp = useGame((s) => s.player.hp);
  const maxHp = useGame((s) => s.player.maxHp);
  const typed = useTypewriter(online ? caption : "");

  const effective: AiStatus = online ? status : "OFFLINE";
  const statusLine = CAPTION_BY_STATUS[effective];
  const critical = maxHp > 0 && hp / maxHp <= 0.25;
  const wary = phase === "BOSS_INTRO";

  const [reaction, setReaction] = useState<Reaction>(null);
  const [blink, setBlink] = useState(false);
  const [glance, setGlance] = useState({ x: 0, y: 0 });
  const reactionTimer = useRef<number | null>(null);

  // Bus reactions — recoil on a hit, a satisfied spin on a kill, a shudder on a CRIT alert.
  useEffect(() => {
    const fire = (r: Exclude<Reaction, null>, ms: number) => {
      if (reactionTimer.current !== null) window.clearTimeout(reactionTimer.current);
      setReaction(r);
      reactionTimer.current = window.setTimeout(() => setReaction(null), ms);
    };
    const offHit = bus.on("fx:playerHit", () => fire("HIT", 520));
    const offKill = bus.on("fx:hit", (p) => {
      if (p.killed) fire("KILL", 900);
    });
    const offAlert = bus.on("hud:alert", (p) => {
      if (p.level === "CRIT") fire("ALERT", 700);
    });
    return () => {
      offHit();
      offKill();
      offAlert();
      if (reactionTimer.current !== null) window.clearTimeout(reactionTimer.current);
    };
  }, []);

  // Idle life: irregular blinks and the occasional glance, never perfectly still.
  useEffect(() => {
    let cancelled = false;
    let blinkTimer: number | undefined;
    let closeTimer: number | undefined;
    const scheduleBlink = () => {
      const delay = 1800 + Math.random() * 3200;
      blinkTimer = window.setTimeout(() => {
        if (cancelled) return;
        setBlink(true);
        closeTimer = window.setTimeout(() => {
          if (!cancelled) setBlink(false);
        }, 140);
        scheduleBlink();
      }, delay);
    };
    scheduleBlink();
    return () => {
      cancelled = true;
      window.clearTimeout(blinkTimer);
      window.clearTimeout(closeTimer);
    };
  }, []);

  useEffect(() => {
    let cancelled = false;
    let glanceTimer: number | undefined;
    let restTimer: number | undefined;
    const scheduleGlance = () => {
      const delay = 2600 + Math.random() * 4200;
      glanceTimer = window.setTimeout(() => {
        if (cancelled) return;
        setGlance({ x: (Math.random() - 0.5) * 6, y: (Math.random() - 0.5) * 3 });
        restTimer = window.setTimeout(() => {
          if (!cancelled) setGlance({ x: 0, y: 0 });
        }, 900);
        scheduleGlance();
      }, delay);
    };
    scheduleGlance();
    return () => {
      cancelled = true;
      window.clearTimeout(glanceTimer);
      window.clearTimeout(restTimer);
    };
  }, []);

  const pose: Pose = reaction ?? (wary ? "BOSS" : effective);
  const { animate: bodyAnimate, transition: bodyTransition } = bodyPose(pose);
  const { animate: ringAnimate, transition: ringTransition } = ringMotion(effective, wary);
  const { animate: irisScaleAnimate, transition: irisScaleTransition } = irisMotion(effective);
  const { animate: thrusterAnimate, transition: thrusterTransition } = thrusterMotion(pose);

  const ringTilt = effective === "THINKING" ? -38 : wary ? -8 : -20;

  const baseIrisR = wary ? 2.6 : effective === "LISTENING" ? 10 : 7;
  let irisRy = baseIrisR;
  if (effective === "THINKING") irisRy = baseIrisR * 0.22;
  if (blink) irisRy = Math.min(irisRy, baseIrisR * 0.08);
  const irisRx = baseIrisR;

  let irisFill = "var(--color-hud-green)";
  if (reaction === "HIT") irisFill = "var(--color-hud-red)";
  else if (critical) irisFill = "var(--color-hud-green-dim)";
  else if (effective === "OFFLINE") irisFill = "var(--color-hud-dim)";

  const seamStroke = reaction === "ALERT" ? "var(--color-hud-amber)" : "var(--color-hud-green-dim)";
  const irisCx = 50 + glance.x;
  const irisCy = 44 + glance.y;

  return (
    <div className="flex flex-col items-center gap-2 select-none">
      <style>{`
        @keyframes ec-bob { 0%, 100% { transform: translateY(0); } 50% { transform: translateY(-4px); } }
        @keyframes ec-bob-crit { 0%, 100% { transform: translateY(0); } 50% { transform: translateY(-2px); } }
        @keyframes ec-vent-flicker { 0%, 100% { opacity: 0.3; } 50% { opacity: 0.75; } }
        .ec-wrap { animation: ec-bob 3.6s ease-in-out infinite; }
        .ec-wrap[data-critical="true"] { animation: ec-bob-crit 1.5s ease-in-out infinite; }
        .ec-wrap[data-status="OFFLINE"] { animation: none; }
        .ec-vent { animation: ec-vent-flicker 2.6s ease-in-out infinite; }
      `}</style>

      <div
        className="ec-wrap relative"
        data-status={effective}
        data-critical={critical}
        style={{
          width: 128,
          height: 128,
          filter:
            effective === "OFFLINE"
              ? "none"
              : `drop-shadow(0 0 ${critical ? 10 : 14}px var(--color-hud-green)) drop-shadow(0 0 ${critical ? 16 : 28}px rgba(78,245,167,${critical ? 0.15 : 0.25}))`,
        }}
      >
        <motion.div
          className="absolute inset-0"
          style={{ transformOrigin: "50% 50%" }}
          animate={bodyAnimate}
          transition={bodyTransition}
        >
          <svg viewBox="0 0 100 100" width="100%" height="100%" style={{ overflow: "visible" }}>
            <defs>
              <filter id="ec-glow" x="-60%" y="-60%" width="220%" height="220%">
                <feGaussianBlur stdDeviation="3.2" />
              </filter>
            </defs>

            {/* orbital ring — the signature gyroscope, tilted and spinning at an angle */}
            <motion.g style={{ transformOrigin: "50px 50px" }} animate={ringAnimate} transition={ringTransition}>
              <ellipse
                cx={50}
                cy={50}
                rx={45}
                ry={12}
                fill="none"
                stroke="var(--color-hud-green)"
                strokeWidth={0.7}
                opacity={effective === "OFFLINE" ? 0.15 : 0.5}
                transform={`rotate(${ringTilt} 50 50)`}
              />
              <circle
                cx={95}
                cy={50}
                r={1.7}
                fill="var(--color-hud-green-glow)"
                opacity={effective === "OFFLINE" ? 0.15 : 0.85}
                transform={`rotate(${ringTilt} 50 50)`}
              />
            </motion.g>

            {/* segmented shell */}
            <circle
              cx={50}
              cy={50}
              r={32}
              fill="var(--color-hud-void)"
              stroke="var(--color-hud-green-dim)"
              strokeWidth={1}
              opacity={effective === "OFFLINE" ? 0.5 : 1}
            />

            {/* inner core glow, from the seams outward */}
            <circle
              cx={50}
              cy={50}
              r={20}
              fill="var(--color-hud-green)"
              opacity={critical ? 0.12 : effective === "OFFLINE" ? 0.08 : 0.22}
              filter="url(#ec-glow)"
            />

            {/* panel seams */}
            <path d="M 19,37 Q 50,28 81,37" fill="none" stroke={seamStroke} strokeWidth={0.6} opacity={0.6} />
            <path d="M 19,63 Q 50,72 81,63" fill="none" stroke={seamStroke} strokeWidth={0.6} opacity={0.6} />
            <path d="M 21,50 Q 50,44 79,50" fill="none" stroke={seamStroke} strokeWidth={0.5} opacity={0.45} />

            {/* machined equator band */}
            <ellipse cx={50} cy={50} rx={32} ry={7} fill="none" stroke="var(--color-hud-green-dim)" strokeWidth={0.6} opacity={0.5} />

            {/* small vents around the hull */}
            {VENT_TICKS.map((deg) => {
              const p1 = polar(30, deg);
              const p2 = polar(33.5, deg);
              return (
                <line
                  key={deg}
                  className="ec-vent"
                  x1={p1.x}
                  y1={p1.y}
                  x2={p2.x}
                  y2={p2.y}
                  stroke="var(--color-hud-green-dim)"
                  strokeWidth={0.7}
                  style={{ animationDelay: `${(deg % 360) / 90}s` }}
                />
              );
            })}

            {/* SPEAKING: waveform ticks along the belt, in time with speech */}
            {effective === "SPEAKING" &&
              WAVE_TICKS.map((deg, i) => {
                const p1 = polar(31, deg);
                const p2 = polar(35 + (i % 3), deg);
                return (
                  <motion.line
                    key={deg}
                    x1={p1.x}
                    y1={p1.y}
                    x2={p2.x}
                    y2={p2.y}
                    stroke="var(--color-hud-green-glow)"
                    strokeWidth={1}
                    animate={{ opacity: [0.25, 1, 0.25] }}
                    transition={{ duration: 0.4, repeat: Infinity, delay: i * 0.05 }}
                  />
                );
              })}

            {/* THINKING: scan dots skitter across the shell */}
            {effective === "THINKING" &&
              SCAN_DOTS.map((deg, i) => {
                const p = polar(24 + (i % 2) * 5, deg);
                return (
                  <motion.circle
                    key={deg}
                    cy={p.y}
                    r={1.2}
                    fill="var(--color-hud-green)"
                    animate={{ opacity: [0, 1, 0], cx: [p.x, p.x + (i % 2 === 0 ? 3 : -3), p.x] }}
                    transition={{ duration: 0.8, repeat: Infinity, delay: i * 0.09 }}
                  />
                );
              })}

            {/* LISTENING: sonar ripple */}
            {effective === "LISTENING" &&
              [0, 0.5, 1].map((delay) => (
                <motion.circle
                  key={delay}
                  cx={50}
                  cy={50}
                  r={20}
                  fill="none"
                  stroke="var(--color-hud-green)"
                  strokeWidth={0.8}
                  initial={{ opacity: 0.7, scale: 0.8 }}
                  animate={{ opacity: 0, scale: 1.9 }}
                  transition={{ duration: 1.5, repeat: Infinity, delay, ease: "easeOut" }}
                  style={{ transformOrigin: "50px 50px" }}
                />
              ))}

            {/* thruster ports — flare on movement / reactions */}
            {THRUSTER_ANGLES.map((deg, i) => {
              const p = polar(33, deg);
              return (
                <g key={deg}>
                  <circle cx={p.x} cy={p.y} r={2.6} fill="var(--color-hud-void)" stroke="var(--color-hud-green-dim)" strokeWidth={0.5} />
                  <motion.circle
                    cx={p.x}
                    cy={p.y}
                    r={1.3}
                    fill="var(--color-hud-green-glow)"
                    animate={thrusterAnimate}
                    transition={{ ...thrusterTransition, delay: i * 0.08 }}
                  />
                </g>
              );
            })}

            {/* the single expressive optical aperture — reads as attention, not a face */}
            <circle cx={50} cy={44} r={13} fill="var(--color-hud-void)" stroke="var(--color-hud-green-dim)" strokeWidth={0.8} />
            <motion.ellipse
              cx={irisCx}
              cy={irisCy}
              rx={irisRx}
              ry={irisRy}
              fill={irisFill}
              style={{ filter: "url(#ec-glow)", transformBox: "fill-box", transformOrigin: "center" }}
              animate={irisScaleAnimate}
              transition={irisScaleTransition}
            />
            <circle cx={irisCx} cy={irisCy} r={1.6} fill="var(--color-hud-void)" opacity={0.7} />
          </svg>
        </motion.div>
      </div>

      <div className="flex flex-col items-center gap-0.5">
        {statusLine && <span className="hud-label text-glow text-hud-green">{statusLine}</span>}
        <span className="hud-label text-hud-gray">{AI_NAME}</span>
        <div className="max-w-[280px] min-h-[14px] text-center text-[11px] text-hud-white">
          {online && typed}
          {online && typed.length < caption.length && <span className="animate-blink text-hud-green">▌</span>}
          {!online && <span className="text-hud-dim">OFFLINE</span>}
        </div>
      </div>
    </div>
  );
}
