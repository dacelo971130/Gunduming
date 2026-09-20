"use client";

import { useEffect, useRef, useState } from "react";
import { motion } from "motion/react";
import { bus } from "@/lib/bus";
import { PLAYER_MECH } from "@/lib/config";
import { BASE_DESIGNATION } from "./lunar";

interface ReactorIgnitionProps {
  onAdvance: () => void;
  reducedMotion: boolean;
}

/**
 * Stage 3.5 — REACTOR. A short (<=2s) ignition beat between the letter
 * expansion and the subsystem load: power routes, a hum rises, the screen
 * brightens from the centre as the core comes online. Purely atmospheric —
 * no store writes, nothing here is read by other stages.
 */
export function ReactorIgnition({ onAdvance, reducedMotion }: ReactorIgnitionProps) {
  const [surge, setSurge] = useState(false);
  const timersRef = useRef<number[]>([]);

  useEffect(() => {
    bus.emit("audio:cue", { cue: "PANEL_ON" });
    const total = reducedMotion ? 1100 : 2000;
    const surgeAt = reducedMotion ? 500 : 900;

    const t1 = window.setTimeout(() => {
      setSurge(true);
      bus.emit("audio:cue", { cue: "BEEP" });
    }, surgeAt);
    const t2 = window.setTimeout(onAdvance, total);
    timersRef.current = [t1, t2];

    return () => {
      timersRef.current.forEach((id) => window.clearTimeout(id));
      timersRef.current = [];
    };
  }, [onAdvance, reducedMotion]);

  return (
    <div className="relative flex h-full w-full flex-col items-center justify-center overflow-hidden bg-hud-void">
      <style>{`
        @keyframes reactor-bloom {
          0% { opacity: 0; transform: scale(0.15); }
          65% { opacity: 0.95; }
          100% { opacity: 0.55; transform: scale(1); }
        }
        .reactor-bloom {
          animation: reactor-bloom ${reducedMotion ? 0.6 : 1.15}s ease-out forwards;
        }
        @keyframes reactor-ring-spin {
          from { transform: rotate(0deg); }
          to { transform: rotate(360deg); }
        }
        .reactor-ring {
          animation: reactor-ring-spin ${reducedMotion ? 2.4 : 4}s linear infinite;
        }
      `}</style>

      <div
        aria-hidden
        className="reactor-bloom pointer-events-none absolute h-[60vmin] w-[60vmin] rounded-full"
        style={{
          background:
            "radial-gradient(circle, rgba(78,245,167,0.85) 0%, rgba(78,245,167,0.25) 45%, transparent 72%)",
          filter: "blur(2px)",
        }}
      />

      <div
        aria-hidden
        className="reactor-ring pointer-events-none absolute h-[34vmin] w-[34vmin] rounded-full border border-hud-green-dim"
        style={{ opacity: 0.5 }}
      />

      <motion.div
        initial={{ opacity: 0 }}
        animate={{ opacity: 1 }}
        transition={{ duration: 0.3 }}
        className="hud-label z-10 text-hud-dim"
        style={{ letterSpacing: "0.35em" }}
      >
        REACTOR IGNITION
      </motion.div>

      <motion.div
        animate={{ opacity: surge ? 1 : 0.4, scale: surge ? 1.04 : 1 }}
        transition={{ duration: 0.25 }}
        className="z-10 mt-2 text-center font-bold text-hud-green text-glow"
        style={{ fontSize: "5vw", letterSpacing: "0.1em" }}
      >
        {PLAYER_MECH} CORE {surge ? "ONLINE" : "SPOOLING"}
      </motion.div>

      <div
        className="hud-label z-10 mt-2 text-hud-dim opacity-50"
        style={{ letterSpacing: "0.28em", fontSize: "9px" }}
      >
        {BASE_DESIGNATION} REACTOR BAY
      </div>
    </div>
  );
}
