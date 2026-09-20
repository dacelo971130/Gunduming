"use client";

import { useEffect, useRef, useState, type ReactNode } from "react";
import { motion, AnimatePresence } from "motion/react";
import { useGame } from "@/game/store";

/** True once the director has pushed this panel id into `panelsOnline`. */
export function usePanelOnline(id: string): boolean {
  return useGame((s) => s.panelsOnline.includes(id));
}

interface PanelFrameProps {
  id: string;
  title: string;
  className?: string;
  children: ReactNode;
}

/**
 * Shared cockpit panel chrome: dark empty frame until the director brings the
 * panel online, then a fast scanline wipe + flicker before content settles.
 */
export function PanelFrame({ id, title, className = "", children }: PanelFrameProps) {
  const online = usePanelOnline(id);
  const [booted, setBooted] = useState(online);
  const wasOnline = useRef(online);

  useEffect(() => {
    if (online && !wasOnline.current) {
      setBooted(false);
      const t = window.setTimeout(() => setBooted(true), 520);
      wasOnline.current = true;
      return () => window.clearTimeout(t);
    }
    wasOnline.current = online;
  }, [online]);

  return (
    <div className={`hud-panel hud-bracket relative flex h-full flex-col overflow-hidden ${className}`}>
      <div className="hud-label shrink-0 border-b border-hud-line px-2.5 py-1.5">
        {title}
      </div>

      <div className="relative min-h-0 flex-1">
        {!online && (
          <div className="absolute inset-0 flex items-center justify-center">
            <span className="hud-label opacity-25">OFFLINE</span>
          </div>
        )}

        <AnimatePresence>
          {online && !booted && (
            <motion.div
              key="wipe"
              className="absolute inset-0 z-20 bg-hud-green-glow"
              style={{ boxShadow: "0 0 24px 4px var(--color-hud-green-glow)" }}
              initial={{ x: "-100%", opacity: 0.9 }}
              animate={{ x: "100%", opacity: 0.9 }}
              exit={{ opacity: 0 }}
              transition={{ duration: 0.42, ease: "easeIn" }}
            />
          )}
        </AnimatePresence>

        {online && (
          <motion.div
            className="absolute inset-0"
            initial={{ opacity: 0 }}
            animate={booted ? { opacity: 1 } : { opacity: [0, 1, 0.25, 1, 0.4, 1] }}
            transition={
              booted
                ? { duration: 0.2 }
                : { duration: 0.5, delay: 0.32, times: [0, 0.2, 0.4, 0.6, 0.8, 1] }
            }
          >
            {children}
          </motion.div>
        )}
      </div>
    </div>
  );
}
