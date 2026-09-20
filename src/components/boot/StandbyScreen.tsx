"use client";

import { useEffect } from "react";
import { motion } from "motion/react";

interface StandbyScreenProps {
  onAdvance: () => void;
  reducedMotion: boolean;
}

/**
 * Stage 1 — STANDBY. Pure black, near-empty. Waits for the wake word (handled
 * by the voice module elsewhere) or a keyboard fallback (SPACE / ENTER) so the
 * pilot is never blocked if the mic is unavailable.
 *
 * Deliberately minimal: one slow-breathing text block and a faint manual
 * override hint. Nothing else moves — the silence is the point.
 */
export function StandbyScreen({ onAdvance, reducedMotion }: StandbyScreenProps) {
  useEffect(() => {
    function onKey(e: KeyboardEvent) {
      if (e.code === "Space" || e.code === "Enter") {
        e.preventDefault();
        onAdvance();
      }
    }
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [onAdvance]);

  return (
    <div className="relative flex h-full w-full flex-col items-center justify-center bg-hud-void">
      <style>{`
        @keyframes standby-breathe {
          0%, 100% { opacity: 0.32; }
          50% { opacity: 1; }
        }
        .standby-breathe {
          animation: standby-breathe 6.5s ease-in-out infinite;
        }
      `}</style>

      <motion.div
        initial={{ opacity: 0 }}
        animate={{ opacity: 1 }}
        transition={{ duration: reducedMotion ? 1 : 2.6, ease: "easeOut" }}
        className={reducedMotion ? "flex flex-col items-center gap-3 opacity-80" : "standby-breathe flex flex-col items-center gap-3"}
      >
        <div
          className="text-center text-sm font-bold tracking-[0.5em] text-hud-green text-glow"
          style={{ letterSpacing: "0.5em" }}
        >
          VOICE LINK
          <br />
          STANDBY
        </div>
        <div className="hud-label text-center text-[10px] text-hud-dim">
          SAY &quot;ECHO&quot; TO INITIALIZE
        </div>
      </motion.div>

      <div className="hud-label absolute bottom-4 right-4 text-hud-dim opacity-30">
        [SPACE] MANUAL OVERRIDE
      </div>
    </div>
  );
}
