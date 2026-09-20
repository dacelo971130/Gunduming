"use client";

import { useEffect, useState } from "react";
import { motion } from "motion/react";
import { bus } from "@/lib/bus";
import { BASE_DESIGNATION, BASE_SECTOR } from "./lunar";

interface WakeFlashProps {
  onAdvance: () => void;
  reducedMotion: boolean;
}

/**
 * Stage 2 — WAKE. Wake word confirmed: a harder white flash, a beat of
 * overdriven scanline noise and a screen shake, then it settles and
 * "VOICE COMMAND DETECTED" / "ECHO" land before advancing itself into BOOT.
 */
export function WakeFlash({ onAdvance, reducedMotion }: WakeFlashProps) {
  const [settled, setSettled] = useState(false);

  useEffect(() => {
    bus.emit("audio:cue", { cue: "WAKE" });
    const total = reducedMotion ? 800 : 1600;
    const settleAt = reducedMotion ? 220 : 420;
    const settleTimer = window.setTimeout(() => setSettled(true), settleAt);
    const timer = window.setTimeout(onAdvance, total);
    return () => {
      window.clearTimeout(timer);
      window.clearTimeout(settleTimer);
    };
  }, [onAdvance, reducedMotion]);

  return (
    <div
      className={`relative flex h-full w-full flex-col items-center justify-center gap-6 overflow-hidden bg-hud-void ${
        settled ? "" : "animate-shake"
      }`}
    >
      <style>{`
        @keyframes wake-overdrive {
          0% { opacity: 0.95; }
          20% { opacity: 0.1; }
          38% { opacity: 0.7; }
          58% { opacity: 0.05; }
          100% { opacity: 0; }
        }
        .wake-overdrive-lines {
          background: repeating-linear-gradient(
            to bottom,
            rgba(232, 244, 242, 0.9) 0px,
            rgba(232, 244, 242, 0.9) 1px,
            transparent 1px,
            transparent 4px
          );
          animation: wake-overdrive ${reducedMotion ? 0.25 : 0.42}s steps(6, end) 1;
        }
      `}</style>

      <motion.div
        className="pointer-events-none absolute inset-0 bg-hud-white"
        initial={{ opacity: 1 }}
        animate={{ opacity: 0 }}
        transition={{ duration: reducedMotion ? 0.18 : 0.32, ease: "easeOut" }}
      />

      {!settled && (
        <div className="wake-overdrive-lines pointer-events-none absolute inset-0" aria-hidden />
      )}

      <div
        className="hud-label absolute left-4 top-4 text-hud-dim opacity-50"
        style={{ letterSpacing: "0.25em" }}
      >
        {BASE_DESIGNATION} // {BASE_SECTOR}
      </div>

      <motion.div
        initial={{ opacity: 0 }}
        animate={{ opacity: 1 }}
        transition={{ duration: 0.15, delay: reducedMotion ? 0.1 : 0.24 }}
        className="hud-label text-hud-green tracking-[0.35em]"
      >
        VOICE COMMAND DETECTED
      </motion.div>

      <motion.div
        className="animate-glitch text-center font-bold text-hud-white text-glow"
        style={{ fontSize: "14vw", letterSpacing: "0.06em" }}
        initial={{ opacity: 0, scale: 0.7 }}
        animate={{ opacity: 1, scale: 1 }}
        transition={{ duration: 0.22, delay: reducedMotion ? 0.1 : 0.24, ease: [0.2, 1, 0.2, 1] }}
      >
        GUNDAM
      </motion.div>
    </div>
  );
}
