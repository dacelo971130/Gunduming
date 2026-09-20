"use client";

import { useEffect, useRef, useState } from "react";
import { LegacyBattleViewport } from "./legacy/LegacyBattleViewport";
import { createBattleScene, type BattleScene } from "./three/scene";

function supportsWebGL2(): boolean {
  try {
    const c = document.createElement("canvas");
    return !!c.getContext("webgl2");
  } catch {
    return false;
  }
}

/**
 * The canopy view — a three.js scene of the lunar battlefield seen from the
 * round cockpit, with the AETHER FRAME's own arms/weapon and ECHO-01 inside.
 * Reads the store imperatively each frame; subscribes to the fx/phase/cmd bus.
 * Falls back to the legacy 2D canvas renderer when WebGL2 is unavailable or
 * the WebGL renderer fails to initialise (or keeps failing frames).
 */
export function BattleViewport() {
  const wrapRef = useRef<HTMLDivElement | null>(null);
  const [fallback, setFallback] = useState(false);

  useEffect(() => {
    if (fallback) return;
    const wrap = wrapRef.current;
    if (!wrap) return;
    let scene: BattleScene | null = null;
    let cancelled = false;
    const fail = (err: unknown) => {
      console.warn("[viewport] WebGL viewport unavailable — using legacy canvas renderer", err);
      queueMicrotask(() => {
        if (!cancelled) setFallback(true);
      });
    };
    if (!supportsWebGL2()) {
      fail("WebGL2 not supported");
      return;
    }
    try {
      scene = createBattleScene(wrap, fail);
    } catch (err) {
      fail(err);
    }
    return () => {
      cancelled = true;
      scene?.dispose();
      scene = null;
    };
  }, [fallback]);

  if (fallback) return <LegacyBattleViewport />;
  return <div ref={wrapRef} className="absolute inset-0 h-full w-full overflow-hidden bg-hud-void" />;
}
