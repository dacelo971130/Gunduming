"use client";

import { useEffect, useRef, useState } from "react";
import { motion, AnimatePresence } from "motion/react";
import { bus } from "@/lib/bus";
import { BOOT_LETTERS, PLAYER_MECH } from "@/lib/config";
import { BASE_DESIGNATION } from "./lunar";

interface LetterExpansionProps {
  onAdvance: () => void;
  reducedMotion: boolean;
}

type LetterPhase = "slam" | "expand" | "hold";
interface CurrentLetter {
  i: number;
  phase: LetterPhase;
}

/** Each letter lands heavier and slower than the last, then the beat
 * accelerates through the remaining five — weight up front, speed at the end. */
const LETTER_TIME_MULT = [1.4, 1.15, 1.0, 0.88, 0.78, 0.68] as const;
/** Big single-letter size shrinks slightly letter to letter so the first hit reads biggest. */
const LETTER_SIZE_VW = [24, 22.2, 20.6, 19.2, 17.8, 16.5] as const;

/**
 * Stage 3 — BOOT letter expansion. The signature moment: each BOOT_LETTERS
 * entry slams in as a huge single letter (chromatic-offset glitch + a
 * shockwave ripple on impact), then expands into its full word with the
 * subsystem name beneath. After the last one, "AETHER FRAME" assembles as a
 * title card before a hard wipe into the reactor beat.
 */
export function LetterExpansion({ onAdvance, reducedMotion }: LetterExpansionProps) {
  const [current, setCurrent] = useState<CurrentLetter | null>({ i: 0, phase: "slam" });
  const [assembled, setAssembled] = useState(false);
  const [wipe, setWipe] = useState(false);
  const cancelledRef = useRef(false);
  const timersRef = useRef<number[]>([]);

  useEffect(() => {
    cancelledRef.current = false;
    const rmMult = reducedMotion ? 0.55 : 1;
    const T_ASSEMBLED = (reducedMotion ? 450 : 700) * rmMult;
    const T_WIPE = (reducedMotion ? 200 : 320) * rmMult;

    function schedule(fn: () => void, ms: number) {
      const id = window.setTimeout(() => {
        if (!cancelledRef.current) fn();
      }, ms);
      timersRef.current.push(id);
    }

    let t = 0;
    BOOT_LETTERS.forEach((_, i) => {
      const mult = LETTER_TIME_MULT[i] * rmMult;
      const T_SLAM = 150 * mult;
      const T_EXPAND = 380 * mult;
      const T_HOLD = 170 * mult;

      schedule(() => {
        setCurrent({ i, phase: "slam" });
        bus.emit("audio:cue", { cue: "BOOT_TICK" });
      }, t);
      t += T_SLAM;
      schedule(() => setCurrent({ i, phase: "expand" }), t);
      t += T_EXPAND;
      schedule(() => setCurrent({ i, phase: "hold" }), t);
      t += T_HOLD;
    });
    schedule(() => {
      setCurrent(null);
      setAssembled(true);
    }, t);
    t += T_ASSEMBLED;
    schedule(() => setWipe(true), t);
    t += T_WIPE;
    schedule(() => onAdvance(), t);

    return () => {
      cancelledRef.current = true;
      timersRef.current.forEach((id) => window.clearTimeout(id));
      timersRef.current = [];
    };
  }, [onAdvance, reducedMotion]);

  return (
    <div className="crt-scan relative flex h-full w-full flex-col items-center justify-center overflow-hidden bg-hud-void">
      <style>{`
        @keyframes letter-glitch-heavy {
          0% { transform: translate(0, 0) skewX(0deg); }
          15% { transform: translate(-3px, 1px) skewX(-2deg); }
          30% { transform: translate(3px, -1px) skewX(2deg); }
          45% { transform: translate(-2px, 0) skewX(-1deg); }
          60% { transform: translate(2px, 1px) skewX(1deg); }
          75% { transform: translate(-1px, -1px) skewX(0deg); }
          100% { transform: translate(0, 0) skewX(0deg); }
        }
        .letter-glitch-heavy {
          animation: letter-glitch-heavy ${reducedMotion ? 0.22 : 0.32}s steps(3, end) infinite;
        }
        @keyframes title-card-pulse {
          0%, 100% { text-shadow: 0 0 22px #4ef5a7, 0 0 60px rgba(78,245,167,0.5); }
          50% { text-shadow: 0 0 34px #4ef5a7, 0 0 90px rgba(78,245,167,0.75); }
        }
        .title-card-pulse {
          animation: title-card-pulse ${reducedMotion ? 0.9 : 1.3}s ease-in-out 2;
        }
      `}</style>

      <AnimatePresence mode="wait">
        {current && (
          <motion.div
            key={current.i}
            className="flex flex-col items-center gap-5"
            initial={{ opacity: 1 }}
            exit={{ opacity: 0 }}
            transition={{ duration: 0.06 }}
          >
            <div className="relative flex items-baseline justify-center leading-none">
              {current.phase === "slam" ? (
                <span
                  className="letter-glitch-heavy relative inline-block font-bold"
                  style={{ fontSize: `${LETTER_SIZE_VW[current.i]}vw` }}
                >
                  <span
                    aria-hidden
                    className="absolute inset-0"
                    style={{ color: "#4ef5ff", transform: "translate(-4px, 0)", mixBlendMode: "screen", opacity: 0.7 }}
                  >
                    {BOOT_LETTERS[current.i].letter}
                  </span>
                  <span
                    aria-hidden
                    className="absolute inset-0"
                    style={{ color: "#ff4e6a", transform: "translate(4px, 0)", mixBlendMode: "screen", opacity: 0.7 }}
                  >
                    {BOOT_LETTERS[current.i].letter}
                  </span>
                  <motion.span
                    className="relative text-hud-white"
                    style={{ textShadow: "0 0 18px #4ef5a7, 0 0 56px rgba(78,245,167,0.55)" }}
                    initial={{ opacity: 0, scale: 1.5 }}
                    animate={{ opacity: 1, scale: 1 }}
                    transition={{ duration: 0.1, ease: "easeOut" }}
                  >
                    {BOOT_LETTERS[current.i].letter}
                  </motion.span>
                </span>
              ) : (
                <span
                  className="font-bold text-hud-white"
                  style={{
                    fontSize: `${LETTER_SIZE_VW[current.i]}vw`,
                    textShadow: "0 0 18px #4ef5a7, 0 0 56px rgba(78,245,167,0.55)",
                  }}
                >
                  {BOOT_LETTERS[current.i].letter}
                </span>
              )}

              {current.phase !== "slam" && (
                <>
                  <motion.div
                    aria-hidden
                    className="pointer-events-none absolute rounded-full border border-hud-green"
                    style={{
                      width: "10vmin",
                      height: "10vmin",
                      top: "50%",
                      left: "50%",
                      transform: "translate(-50%, -50%)",
                    }}
                    initial={{ opacity: 0.6, scale: 0.4 }}
                    animate={{ opacity: 0, scale: reducedMotion ? 1.8 : 3.2 }}
                    transition={{ duration: reducedMotion ? 0.35 : 0.55, ease: "easeOut" }}
                  />
                  <span
                    className="font-bold text-hud-white"
                    style={{
                      fontSize: "6vw",
                      textShadow: "0 0 12px #4ef5a7",
                    }}
                  >
                    {BOOT_LETTERS[current.i].word
                      .slice(1)
                      .split("")
                      .map((ch, idx) => (
                        <motion.span
                          key={idx}
                          initial={{ opacity: 0, x: -10 }}
                          animate={{ opacity: 1, x: 0 }}
                          transition={{ duration: 0.06, delay: idx * 0.032, ease: "linear" }}
                          style={{ display: "inline-block" }}
                        >
                          {ch}
                        </motion.span>
                      ))}
                  </span>
                </>
              )}
            </div>

            <motion.div
              className="hud-label text-hud-green-dim"
              style={{ letterSpacing: "0.35em" }}
              initial={{ opacity: 0 }}
              animate={{ opacity: current.phase === "slam" ? 0 : 1 }}
              transition={{ duration: 0.15 }}
            >
              {BOOT_LETTERS[current.i].system}
            </motion.div>
          </motion.div>
        )}

        {assembled && (
          <motion.div
            key="assembled"
            className="flex flex-col items-center gap-2"
            initial={{ opacity: 0, scale: 0.85 }}
            animate={{ opacity: 1, scale: 1 }}
            exit={{ opacity: 0 }}
            transition={{ duration: 0.2, ease: "easeOut" }}
          >
            <div
              className="title-card-pulse text-center font-bold text-hud-green text-glow"
              style={{ fontSize: "9vw", letterSpacing: "0.08em" }}
            >
              {PLAYER_MECH}
            </div>
            <div className="hud-label text-hud-dim" style={{ letterSpacing: "0.3em" }}>
              ALL SUBSYSTEMS COMPILED
            </div>
            <div
              className="hud-label text-hud-dim opacity-60"
              style={{ letterSpacing: "0.28em", fontSize: "9px" }}
            >
              {BASE_DESIGNATION} // LAUNCH READY
            </div>
          </motion.div>
        )}
      </AnimatePresence>

      <AnimatePresence>
        {wipe && (
          <motion.div
            key="wipe"
            className="pointer-events-none absolute inset-0 bg-hud-white"
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            exit={{ opacity: 0 }}
            transition={{ duration: 0.16 }}
          />
        )}
      </AnimatePresence>
    </div>
  );
}
