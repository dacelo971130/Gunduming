"use client";

import { useEffect, useRef, useState } from "react";
import { motion, AnimatePresence } from "motion/react";
import { bus } from "@/lib/bus";
import { useGame } from "@/game/store";
import { SUBSYSTEMS, type Subsystem } from "@/lib/config";
import { AMBIENT_GRAVITY, BASE_DESIGNATION, BASE_SECTOR } from "./lunar";

interface SubsystemLoadProps {
  onAdvance: () => void;
  reducedMotion: boolean;
}

type Tone = "green" | "amber" | "dim";

interface SystemRowState {
  kind: "system";
  key: Subsystem;
  label: string;
  tone: Tone;
}
interface LunarRowState {
  kind: "lunar";
  key: string;
  title: string;
  label: string;
  tone: Tone;
}
type RowState = SystemRowState | LunarRowState;

interface LunarSpec {
  key: string;
  title: string;
  resolved: string;
  hesitate?: boolean;
}

/** Lunar-base context lines mixed in with the real subsystems below. Display
 * only — these never touch the store, unlike the SUBSYSTEMS entries. */
const LUNAR_BASE: LunarSpec = { key: "base", title: "BASE", resolved: BASE_DESIGNATION };
const LUNAR_SECTOR: LunarSpec = { key: "sector", title: "SECTOR", resolved: BASE_SECTOR };
const LUNAR_VACUUM: LunarSpec = { key: "vacuum", title: "VACUUM SEAL", resolved: "HOLDING", hesitate: true };
const LUNAR_GRAVITY: LunarSpec = { key: "gravity", title: "GRAVITY", resolved: AMBIENT_GRAVITY };

type RowOrderEntry = { kind: "system"; name: Subsystem } | { kind: "lunar"; spec: LunarSpec };

/** Interleave order: real subsystems (from config, unchanged behavior) with
 * lunar-base readouts. One line — VACUUM SEAL — hesitates before resolving. */
const ROW_ORDER: RowOrderEntry[] = [
  { kind: "system", name: SUBSYSTEMS[0] },
  { kind: "lunar", spec: LUNAR_BASE },
  { kind: "system", name: SUBSYSTEMS[1] },
  { kind: "lunar", spec: LUNAR_SECTOR },
  { kind: "system", name: SUBSYSTEMS[2] },
  { kind: "lunar", spec: LUNAR_VACUUM },
  { kind: "system", name: SUBSYSTEMS[3] },
  { kind: "system", name: SUBSYSTEMS[4] },
  { kind: "lunar", spec: LUNAR_GRAVITY },
  { kind: "system", name: SUBSYSTEMS[5] },
  { kind: "system", name: SUBSYSTEMS[6] },
  { kind: "system", name: SUBSYSTEMS[7] },
];

const BAR_WIDTH = 20;
function progressBar(pct: number): string {
  const filled = Math.max(0, Math.min(BAR_WIDTH, Math.round((pct / 100) * BAR_WIDTH)));
  return "█".repeat(filled) + "░".repeat(BAR_WIDTH - filled);
}

/**
 * Stage 4 — subsystem load. Left-aligned terminal list bringing each
 * SUBSYSTEMS entry online, interleaved with lunar-base context readouts
 * (base, sector, vacuum seal, gravity), then a full-width progress bar and
 * a held beat of near-silence before handing off to COCKPIT_BOOT.
 */
export function SubsystemLoad({ onAdvance, reducedMotion }: SubsystemLoadProps) {
  const setSubsystem = useGame((s) => s.setSubsystem);
  const setBootProgress = useGame((s) => s.setBootProgress);
  const bootProgress = useGame((s) => s.bootProgress);
  const neuralOnline = useGame((s) => s.neuralOnline);

  const [visibleCount, setVisibleCount] = useState(0);
  const [rows, setRows] = useState<RowState[]>(() =>
    ROW_ORDER.map((entry) =>
      entry.kind === "system"
        ? { kind: "system", key: entry.name, label: "BOOTING", tone: "dim" as Tone }
        : { kind: "lunar", key: entry.spec.key, title: entry.spec.title, label: "READING", tone: "dim" as Tone },
    ),
  );
  const [showBar, setShowBar] = useState(false);
  const [done, setDone] = useState(false);

  const cancelledRef = useRef(false);
  const timersRef = useRef<number[]>([]);
  const neuralOnlineRef = useRef(neuralOnline);
  neuralOnlineRef.current = neuralOnline;

  useEffect(() => {
    cancelledRef.current = false;
    const mult = reducedMotion ? 0.5 : 1;
    const STEP = 180 * mult;
    const RESOLVE_DELAY = 220 * mult;
    const NEURAL_EXTRA = 420 * mult;
    const HESITATE_EXTRA = 380 * mult;

    function schedule(fn: () => void, ms: number) {
      const id = window.setTimeout(() => {
        if (!cancelledRef.current) fn();
      }, ms);
      timersRef.current.push(id);
    }

    let t = 0;
    let lastResolve = 0;
    ROW_ORDER.forEach((entry, i) => {
      const startAt = t;
      schedule(() => {
        setVisibleCount(i + 1);
        if (entry.kind === "system") setSubsystem(entry.name, "BOOTING");
        setRows((prev) =>
          prev.map((r, idx) => (idx === i ? { ...r, label: entry.kind === "system" ? "BOOTING" : "READING", tone: "dim" } : r)),
        );
      }, startAt);

      if (entry.kind === "system") {
        const resolveAt = startAt + RESOLVE_DELAY + (entry.name === "NEURAL LINK" ? NEURAL_EXTRA : 0);
        lastResolve = Math.max(lastResolve, resolveAt);
        schedule(() => {
          setSubsystem(entry.name, "ONLINE");
          const online = entry.name === "NEURAL LINK" ? neuralOnlineRef.current : true;
          setRows((prev) =>
            prev.map((r, idx) =>
              idx === i ? { ...r, label: online ? "ONLINE" : "LOCAL MODE", tone: online ? "green" : "amber" } : r,
            ),
          );
        }, resolveAt);
      } else if (entry.spec.hesitate) {
        // A real machine checking itself: pause on an amber recheck before it resolves.
        const checkAt = startAt + RESOLVE_DELAY * 0.6;
        const resolveAt = startAt + RESOLVE_DELAY + HESITATE_EXTRA;
        lastResolve = Math.max(lastResolve, resolveAt);
        schedule(() => {
          setRows((prev) => prev.map((r, idx) => (idx === i ? { ...r, label: "RECHECK", tone: "amber" } : r)));
          bus.emit("audio:cue", { cue: "BEEP" });
        }, checkAt);
        schedule(() => {
          setRows((prev) =>
            prev.map((r, idx) => (idx === i ? { ...r, label: entry.spec.resolved, tone: "green" } : r)),
          );
        }, resolveAt);
      } else {
        const resolveAt = startAt + RESOLVE_DELAY;
        lastResolve = Math.max(lastResolve, resolveAt);
        schedule(() => {
          setRows((prev) =>
            prev.map((r, idx) => (idx === i ? { ...r, label: entry.spec.resolved, tone: "green" } : r)),
          );
        }, resolveAt);
      }

      t += STEP;
    });

    const barStart = lastResolve + 220 * mult;
    schedule(() => setShowBar(true), barStart);

    const PROGRESS_DURATION = (reducedMotion ? 600 : 1100) * mult;
    const PROGRESS_STEPS = 20;
    for (let s = 1; s <= PROGRESS_STEPS; s++) {
      schedule(() => setBootProgress((s / PROGRESS_STEPS) * 100), barStart + (s / PROGRESS_STEPS) * PROGRESS_DURATION);
    }

    schedule(() => {
      setDone(true);
      bus.emit("audio:cue", { cue: "BOOT_DONE" });
    }, barStart + PROGRESS_DURATION);

    // Held beat of near-silence — the pause is what makes the cockpit reveal land.
    const holdSilence = (reducedMotion ? 500 : 900) * mult;
    schedule(() => onAdvance(), barStart + PROGRESS_DURATION + holdSilence);

    return () => {
      cancelledRef.current = true;
      timersRef.current.forEach((id) => window.clearTimeout(id));
      timersRef.current = [];
    };
    // neuralOnlineRef makes neuralOnline safe to omit; mutators are stable zustand actions.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [onAdvance, reducedMotion, setSubsystem, setBootProgress]);

  return (
    <div className="relative flex h-full w-full flex-col justify-center bg-hud-void px-[8vw]">
      <div className="hud-label mb-6 text-hud-dim" style={{ letterSpacing: "0.3em" }}>
        SUBSYSTEM INITIALIZATION
      </div>

      <div className="flex flex-col gap-2">
        {rows.slice(0, visibleCount).map((row) => (
          <motion.div
            key={row.key}
            initial={{ opacity: 0, x: -6 }}
            animate={{ opacity: 1, x: 0 }}
            transition={{ duration: 0.15 }}
            className="flex items-baseline text-sm tracking-wider"
          >
            <span className="text-hud-gray">{row.kind === "system" ? row.key : row.title}</span>
            <span className="dot-leader" />
            <span
              className={
                row.tone === "green"
                  ? "text-hud-green text-glow"
                  : row.tone === "amber"
                    ? "text-hud-amber text-glow"
                    : "text-hud-dim animate-blink"
              }
            >
              {row.label}
            </span>
          </motion.div>
        ))}
      </div>

      <AnimatePresence>
        {showBar && (
          <motion.div
            key="bar"
            initial={{ opacity: 0, y: 8 }}
            animate={{ opacity: 1, y: 0 }}
            transition={{ duration: 0.2 }}
            className="mt-10"
          >
            <div className="hud-label mb-2 text-hud-gray" style={{ letterSpacing: "0.3em" }}>
              SYSTEM INITIALIZATION
            </div>
            <div className="flex items-center gap-3 font-bold text-hud-green">
              <div className="flex-1 overflow-hidden whitespace-nowrap text-lg leading-none tracking-tighter text-glow">
                {progressBar(bootProgress)}
              </div>
              <div className="w-12 text-right text-sm">{Math.round(bootProgress)}%</div>
            </div>
            <AnimatePresence>
              {done && (
                <motion.div
                  key="done"
                  initial={{ opacity: 0 }}
                  animate={{ opacity: 1 }}
                  className="hud-label mt-3 text-center text-hud-green text-glow"
                  style={{ letterSpacing: "0.3em" }}
                >
                  ALL SYSTEMS OPERATIONAL
                </motion.div>
              )}
            </AnimatePresence>
          </motion.div>
        )}
      </AnimatePresence>
    </div>
  );
}
