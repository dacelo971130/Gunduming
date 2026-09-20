"use client";

import { type ReactNode } from "react";
import { motion, useReducedMotion } from "motion/react";
import { useGame } from "@/game/store";

/** True once the director has pushed this panel id into `panelsOnline`. */
export function usePanelOnline(id: string): boolean {
  return useGame((s) => s.panelsOnline.includes(id));
}

interface PanelFrameProps {
  id: string;
  title: string;
  /** Small unit tag engraved on the bezel, e.g. "MFD-2". Defaults from id. */
  tag?: string;
  /** "mfd" = full instrument with title plate; "strip" = low-profile bezel. */
  variant?: "mfd" | "strip";
  className?: string;
  children: ReactNode;
}

const TAG_BY_ID: Record<string, string> = {
  pilot: "MFD-1",
  system: "MFD-2",
  weapons: "MFD-3",
  radar: "SCOPE",
  mission: "MFD-4",
  comms: "PRN-1",
  "ai-core": "ECHO",
};

/* Backlight warming up: cold-cathode tube stutters, then holds. Stable refs so
   motion never restarts the sequence on re-render. */
const WARM_CONTENT = { opacity: [0, 0.06, 0.02, 0.32, 0.18, 0.7, 0.5, 1] };
const WARM_CONTENT_T = { duration: 1.15, times: [0, 0.12, 0.2, 0.36, 0.44, 0.62, 0.72, 1], ease: "linear" as const };
const WARM_BACKLIGHT = { opacity: [0, 0.35, 0.12, 0.75, 0.5, 1] };
const WARM_BACKLIGHT_T = { duration: 1.0, times: [0, 0.15, 0.25, 0.5, 0.65, 1], ease: "linear" as const };
const STEADY = { opacity: 1 };
const STEADY_T = { duration: 0.3 };

function Screws() {
  return (
    <>
      <span className="mfd-screw left-[4px] top-[4px]" style={{ "--screw-rot": "22deg" } as React.CSSProperties} />
      <span className="mfd-screw right-[4px] top-[4px]" style={{ "--screw-rot": "-40deg" } as React.CSSProperties} />
      <span className="mfd-screw bottom-[4px] left-[4px]" style={{ "--screw-rot": "68deg" } as React.CSSProperties} />
      <span className="mfd-screw bottom-[4px] right-[4px]" style={{ "--screw-rot": "5deg" } as React.CSSProperties} />
    </>
  );
}

/**
 * One physical multi-function display: machined bezel, four screws, an
 * engraved title plate with a power lamp, and a recessed matte glass face.
 * Dark glass until the director brings the panel online, then the backlight
 * warms up and the phosphor content settles in.
 */
export function PanelFrame({ id, title, tag, variant = "mfd", className = "", children }: PanelFrameProps) {
  const online = usePanelOnline(id);
  const reduced = useReducedMotion();
  const strip = variant === "strip";

  return (
    <div
      className={`mfd-bezel flex h-full min-h-0 flex-col ${strip ? "p-[5px]" : "px-[9px] pb-[9px] pt-[6px]"} ${className}`}
      data-panel={id}
      data-online={online}
    >
      <Screws />

      {!strip && (
        <div className="mb-[5px] flex h-[12px] shrink-0 items-center justify-between px-[6px]">
          <span className="mfd-engraved leading-none">{title}</span>
          <div className="flex items-center gap-[6px]">
            <span className="mfd-engraved text-[7px] leading-none tracking-[0.14em] opacity-70">
              {tag ?? TAG_BY_ID[id] ?? id.toUpperCase()}
            </span>
            <span className={`lamp lamp-sm ${online ? "lamp-green" : ""}`} aria-label={online ? "power on" : "power off"} />
          </div>
        </div>
      )}

      <div className="mfd-glass min-h-0 flex-1">
        {online && (
          <motion.div
            className="mfd-backlight"
            initial={{ opacity: 0 }}
            animate={reduced ? STEADY : WARM_BACKLIGHT}
            transition={reduced ? STEADY_T : WARM_BACKLIGHT_T}
          />
        )}

        {!online && (
          <div className="absolute inset-0 flex items-end justify-end p-2">
            <span className="mfd-label text-[7px] opacity-30">STBY</span>
          </div>
        )}

        {online && (
          <motion.div
            className={`absolute inset-0 ${reduced ? "" : "mfd-refresh"}`}
            initial={{ opacity: 0 }}
            animate={reduced ? STEADY : WARM_CONTENT}
            transition={reduced ? STEADY_T : WARM_CONTENT_T}
          >
            {children}
          </motion.div>
        )}

        <div className="mfd-raster" aria-hidden />
      </div>
    </div>
  );
}
