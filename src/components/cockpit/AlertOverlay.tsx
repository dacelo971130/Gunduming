"use client";

import { useEffect, useState } from "react";
import { motion, AnimatePresence } from "motion/react";
import { bus } from "@/lib/bus";
import type { LogLevel } from "@/game/types";

interface Alert {
  id: number;
  text: string;
  level: LogLevel;
}

let seq = 0;

const LEVEL_COLOR: Record<LogLevel, string> = {
  SYS: "text-hud-gray",
  INFO: "text-glow text-hud-green",
  WARN: "text-glow text-hud-amber",
  CRIT: "text-glow text-hud-red",
  AI: "text-glow text-hud-green-glow",
  PILOT: "text-glow text-hud-white",
};

/** Big centred HUD callouts driven by the `hud:alert` bus event. */
export function AlertOverlay() {
  const [alerts, setAlerts] = useState<Alert[]>([]);

  useEffect(() => {
    return bus.on("hud:alert", ({ text, level, ttl }) => {
      const id = ++seq;
      setAlerts((prev) => [...prev.slice(-1), { id, text, level }]);
      window.setTimeout(() => {
        setAlerts((prev) => prev.filter((a) => a.id !== id));
      }, ttl ?? 1800);
    });
  }, []);

  const redWash = alerts.some((a) => a.level === "CRIT" || a.level === "WARN");

  return (
    <div className="pointer-events-none absolute inset-0 z-40 flex flex-col items-center justify-center gap-3">
      {redWash && (
        <div className="animate-red-alert pointer-events-none absolute inset-0" aria-hidden />
      )}
      <AnimatePresence>
        {alerts.map((a) => (
          <motion.div
            key={a.id}
            initial={{ opacity: 0, scale: 1.5, letterSpacing: "0.5em" }}
            animate={{ opacity: 1, scale: 1, letterSpacing: "0.15em" }}
            exit={{ opacity: 0, scale: 0.9 }}
            transition={{ duration: 0.22, ease: "easeOut" }}
            className={`max-w-[80vw] text-center text-xl font-bold uppercase tracking-[0.15em] ${LEVEL_COLOR[a.level]}`}
            style={{ textShadow: "0 0 18px currentColor" }}
          >
            {a.text}
          </motion.div>
        ))}
      </AnimatePresence>
    </div>
  );
}
