"use client";

import { useEffect, useRef } from "react";
import { createRevealScene, type RevealScene } from "./three/reveal";

function supportsWebGL2(): boolean {
  try {
    return !!document.createElement("canvas").getContext("webgl2");
  } catch {
    return false;
  }
}

/**
 * ~6 s third-person reveal of the AETHER FRAME in its lunar hangar: camera
 * starts at the feet, tilts up, orbits past shield and rifle to the face as
 * the eyes light up, then pushes into the open cockpit hatch and calls
 * `onDone`. Self-contained renderer; disposes on unmount (no lingering RAF).
 * Without WebGL2 (or if init throws) `onDone` fires immediately.
 *
 * Escape skips the reveal (calls `onDone` once). Unmounting early (the parent
 * skipping the beat itself) does NOT call `onDone` — the parent already moved
 * on; calling it again would double-advance.
 */
export function MechReveal({ onDone, freezeAt }: { onDone: () => void; freezeAt?: number }) {
  const wrapRef = useRef<HTMLDivElement | null>(null);
  const onDoneRef = useRef(onDone);

  useEffect(() => {
    onDoneRef.current = onDone;
  }, [onDone]);

  useEffect(() => {
    const wrap = wrapRef.current;
    if (!wrap) return;
    let fired = false;
    const done = () => {
      if (fired) return;
      fired = true;
      onDoneRef.current();
    };
    if (!supportsWebGL2()) {
      done();
      return;
    }
    let scene: RevealScene | null = null;
    try {
      scene = createRevealScene(wrap, done, { freezeAt });
    } catch (err) {
      console.warn("[reveal] WebGL reveal unavailable — skipping", err);
      done();
      return;
    }
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") {
        e.preventDefault();
        scene?.dispose();
        scene = null;
        done();
      }
    };
    window.addEventListener("keydown", onKey);
    return () => {
      window.removeEventListener("keydown", onKey);
      scene?.dispose();
      scene = null;
    };
  }, [freezeAt]);

  return <div ref={wrapRef} className="absolute inset-0 h-full w-full overflow-hidden bg-black" />;
}
