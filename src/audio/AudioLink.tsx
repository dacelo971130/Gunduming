"use client";

/**
 * AUDIO — bus integration.
 *
 * Mount once at the app root. Subscribes to `audio:cue` / `audio:bgm` to
 * drive sfx.ts / bgm.ts, and to `ai:say` / `ai:spoken` to duck the music bus
 * while ECHO-01 speaks so the co-pilot's voice always reads over the BGM.
 * Renders a small mute toggle; mute state persists in localStorage.
 */
import { useEffect, useState } from "react";
import { bus } from "@/lib/bus";
import { isMuted, setMuted } from "./engine";
import { playCue } from "./sfx";
import { duckMusic, setTrack, unduckMusic } from "./bgm";

export function AudioLink() {
  const [muted, setMutedLocal] = useState(false);

  // Sync initial mute state from localStorage after mount (avoids SSR mismatch).
  useEffect(() => {
    try {
      setMutedLocal(isMuted());
    } catch {
      // ignore
    }
  }, []);

  useEffect(() => {
    const offCue = bus.on("audio:cue", ({ cue }) => {
      playCue(cue);
    });
    const offBgm = bus.on("audio:bgm", ({ track }) => {
      setTrack(track);
    });
    const offSay = bus.on("ai:say", () => {
      duckMusic();
    });
    const offSpoken = bus.on("ai:spoken", () => {
      unduckMusic();
    });

    return () => {
      offCue();
      offBgm();
      offSay();
      offSpoken();
    };
  }, []);

  function toggleMute() {
    const next = !muted;
    try {
      setMuted(next);
    } catch {
      // ignore — audio must never throw
    }
    setMutedLocal(next);
  }

  return (
    <button
      type="button"
      onClick={toggleMute}
      aria-label={muted ? "Unmute audio" : "Mute audio"}
      className="fixed bottom-2 right-2 z-50 border border-hud-line bg-hud-panel/80 px-2 py-1 font-mono text-[9px] uppercase tracking-[0.2em] text-hud-green-dim transition-colors hover:text-hud-green"
    >
      {muted ? "AUDIO MUTED" : "AUDIO ON"}
    </button>
  );
}
