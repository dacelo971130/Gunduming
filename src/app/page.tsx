"use client";

import { useEffect } from "react";
import { useGame } from "@/game/store";
import { BootStage } from "@/components/boot/BootStage";
import { Cockpit } from "@/components/cockpit/Cockpit";
import { BattleViewport } from "@/components/viewport/BattleViewport";
import { VoiceLink } from "@/voice/VoiceLink";
import { VoiceBar } from "@/components/voice/VoiceBar";
import { AudioLink } from "@/audio/AudioLink";
import { unlockAudio } from "@/audio/engine";
import { startEngine } from "@/game/engine";
import { runDirector, loadWeather } from "@/game/director";

const BOOT_PHASES = new Set(["STANDBY", "WAKE", "BOOT"]);

export default function Page() {
  const phase = useGame((s) => s.phase);

  // The simulation and the demo script run for the whole session, across phases.
  useEffect(() => {
    const stopEngine = startEngine();
    const stopDirector = runDirector();
    void loadWeather();
    return () => {
      stopEngine();
      stopDirector();
    };
  }, []);

  // Tell the HUD whether the neural link is available before boot draws it,
  // instead of waiting for the first command that misses the reflex matcher.
  useEffect(() => {
    let cancelled = false;
    fetch("/api/copilot")
      .then((r) => r.json())
      .then((data: { neural?: boolean }) => {
        if (!cancelled) useGame.getState().setNeuralOnline(Boolean(data.neural));
      })
      .catch(() => {
        /* No link check, no neural link — the HUD stays honest at LOCAL. */
      });
    return () => {
      cancelled = true;
    };
  }, []);

  // Browsers block audio until the pilot interacts; the wake word press counts.
  useEffect(() => {
    const unlock = () => unlockAudio();
    window.addEventListener("pointerdown", unlock, { once: true });
    window.addEventListener("keydown", unlock, { once: true });
    return () => {
      window.removeEventListener("pointerdown", unlock);
      window.removeEventListener("keydown", unlock);
    };
  }, []);

  const booting = BOOT_PHASES.has(phase);

  return (
    <main className="relative h-dvh w-screen overflow-hidden bg-hud-void crt-scan crt-vignette">
      {booting ? (
        <BootStage />
      ) : (
        <Cockpit viewport={<BattleViewport />} voiceBar={<VoiceBar />} />
      )}
      <VoiceLink />
      <AudioLink />
    </main>
  );
}
