"use client";

import { useCallback, useEffect, useState } from "react";
import { useGame } from "@/game/store";
import { StandbyScreen } from "./StandbyScreen";
import { WakeFlash } from "./WakeFlash";
import { LetterExpansion } from "./LetterExpansion";
import { ReactorIgnition } from "./ReactorIgnition";
import { SubsystemLoad } from "./SubsystemLoad";
import { MechReveal } from "@/components/viewport/MechReveal";

type BootSubStage = "LETTERS" | "REACTOR" | "REVEAL" | "SUBSYSTEMS";

function usePrefersReducedMotion(): boolean {
  const [reduced, setReduced] = useState(false);
  useEffect(() => {
    if (typeof window === "undefined" || typeof window.matchMedia !== "function") return;
    const mq = window.matchMedia("(prefers-reduced-motion: reduce)");
    setReduced(mq.matches);
    const handler = (e: MediaQueryListEvent) => setReduced(e.matches);
    mq.addEventListener("change", handler);
    return () => mq.removeEventListener("change", handler);
  }, []);
  return reduced;
}

/**
 * BOOT SEQUENCE owner. Reads `phase` from the store and renders the matching
 * stage: STANDBY -> WAKE -> BOOT (letter expansion, then subsystem load),
 * handing off to COCKPIT_BOOT itself when the sequence completes.
 *
 * If rehearsal hotkeys push `phase` past BOOT, this renders nothing rather
 * than fighting the jump — other owners take it from there.
 */
export function BootStage() {
  const phase = useGame((s) => s.phase);
  const setPhase = useGame((s) => s.setPhase);
  const reducedMotion = usePrefersReducedMotion();
  const [bootSub, setBootSub] = useState<BootSubStage>("LETTERS");

  // Re-entering BOOT (fresh mount, or a rehearsal restart) always starts at
  // the letter expansion — never resumes mid-sequence.
  useEffect(() => {
    if (phase === "BOOT") setBootSub("LETTERS");
  }, [phase]);

  const goWake = useCallback(() => setPhase("WAKE"), [setPhase]);
  const goBoot = useCallback(() => setPhase("BOOT"), [setPhase]);
  const goReactor = useCallback(() => setBootSub("REACTOR"), []);
  const goReveal = useCallback(() => setBootSub("REVEAL"), []);
  const goSubsystems = useCallback(() => setBootSub("SUBSYSTEMS"), []);

  // The full-body reveal is the one beat with no keyboard fallback of its own
  // besides Escape — Space/Enter skip it like every other boot beat, so a
  // pilot on stage is never stuck watching it if something looks wrong.
  useEffect(() => {
    if (phase !== "BOOT" || bootSub !== "REVEAL") return;
    const onKey = (e: KeyboardEvent) => {
      if (e.code === "Space" || e.key === "Enter") {
        e.preventDefault();
        setBootSub("SUBSYSTEMS");
      }
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [phase, bootSub]);
  const goCockpit = useCallback(() => setPhase("COCKPIT_BOOT"), [setPhase]);

  if (phase === "STANDBY") {
    return <StandbyScreen onAdvance={goWake} reducedMotion={reducedMotion} />;
  }

  if (phase === "WAKE") {
    return <WakeFlash onAdvance={goBoot} reducedMotion={reducedMotion} />;
  }

  if (phase === "BOOT") {
    if (bootSub === "LETTERS") {
      return <LetterExpansion onAdvance={goReactor} reducedMotion={reducedMotion} />;
    }
    if (bootSub === "REACTOR") {
      return <ReactorIgnition onAdvance={reducedMotion ? goSubsystems : goReveal} reducedMotion={reducedMotion} />;
    }
    if (bootSub === "REVEAL") {
      return <MechReveal onDone={goSubsystems} />;
    }
    return <SubsystemLoad onAdvance={goCockpit} reducedMotion={reducedMotion} />;
  }

  return null;
}
