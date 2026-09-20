"use client";

import { useEffect, useRef, useState, type ReactNode } from "react";
import { bus } from "@/lib/bus";
import { HUD_GUTTER_PX, canopyAperture, hudSideColumnWidth } from "./layout";
import { PanelFrame } from "./PanelFrame";
import { TopBar } from "./TopBar";
import { PilotStatus } from "./PilotStatus";
import { SystemStatus } from "./SystemStatus";
import { WeaponStatus } from "./WeaponStatus";
import { MissionControl } from "./MissionControl";
import { CommsLog } from "./CommsLog";
import { AlertOverlay } from "./AlertOverlay";
import { ApertureGauges } from "./ApertureGauges";
import { Radar } from "@/components/radar/Radar";
import { AiCore } from "@/components/ai-core/AiCore";

interface CockpitProps {
  /** The battle viewport — another module's renderer. Fills the whole frame. */
  viewport: ReactNode;
  /** Slot for the voice module's bottom console strip. */
  voiceBar?: ReactNode;
}

const AI_STRIP_H = 46;

function clamp(v: number, lo: number, hi: number) {
  return Math.max(lo, Math.min(hi, v));
}

function initialSize() {
  if (typeof window === "undefined") return { w: 1440, h: 900 };
  return { w: window.innerWidth, h: window.innerHeight };
}

/**
 * Glass cockpit HUD built around the circular canopy aperture. The viewport
 * fills the frame; the MFDs live in the two columns left and right of the
 * circle; a slim status rail caps the top and the voice console the bottom.
 * Only the etched rim gauges and ECHO-01's caption strip enter the circle.
 */
export function Cockpit({ viewport, voiceBar }: CockpitProps) {
  const shellRef = useRef<HTMLDivElement>(null);
  const [size, setSize] = useState(initialSize);

  useEffect(() => {
    const el = shellRef.current;
    if (!el || typeof ResizeObserver === "undefined") return;
    const ro = new ResizeObserver((entries) => {
      const rect = entries[0]?.contentRect;
      if (!rect) return;
      const w = Math.round(rect.width);
      const h = Math.round(rect.height);
      setSize((s) => (s.w === w && s.h === h ? s : { w, h }));
    });
    ro.observe(el);
    return () => ro.disconnect();
  }, []);

  // Screen shake is a whole-cockpit reaction; panels only render the text.
  useEffect(() => {
    return bus.on("hud:shake", () => {
      const el = shellRef.current;
      if (!el) return;
      el.classList.remove("animate-shake");
      void el.offsetWidth; // restart the animation if it fires again quickly
      el.classList.add("animate-shake");
    });
  }, []);

  const { w, h } = size;
  const ap = canopyAperture(w, h);
  const col = hudSideColumnWidth(w, h);
  const G = HUD_GUTTER_PX;

  const capTop = ap.cy - ap.r; // free band above the circle
  const capBottom = h - (ap.cy + ap.r); // free band below the circle
  const topH = clamp(Math.floor(capTop) - 6, 28, 46);
  const botH = clamp(Math.floor(capBottom) - 6, 34, 52);

  const columnTop = topH + G;
  const columnBottom = botH + G;
  const columnH = Math.max(120, h - columnTop - columnBottom);

  // Radar scope is square-ish; cap it so mission + comms keep room below.
  const radarH = Math.round(Math.min(col + 26, columnH * 0.42));

  // Left column budget: pilot and system are content-sized, weapons takes the rest.
  const pilotH = columnH >= 720 ? 150 : 132;
  const systemH = columnH >= 720 ? 182 : 164;
  const weaponsH = columnH - pilotH - systemH - G * 2;
  const compact = weaponsH < 340;

  // ECHO-01 caption strip: bottom centre, inside the circle's lower cap.
  const aiInset = 10;
  const d = ap.r - aiInset - AI_STRIP_H; // distance from centre to the strip's top edge
  const chord = d < ap.r ? 2 * Math.sqrt(ap.r * ap.r - d * d) : ap.r;
  const aiW = clamp(Math.floor(chord) - 28, 240, 440);
  const aiTop = ap.cy + ap.r - aiInset - AI_STRIP_H;

  return (
    <div ref={shellRef} className="relative h-full w-full overflow-hidden bg-hud-void">
      {/* battle viewport — fills the frame; the 3D frame ring sits on the aperture */}
      <div className="absolute inset-0 z-0">{viewport}</div>

      {/* etched rim gauges — bearing tape, heat/energy arcs, all within 6% of the rim */}
      <div className="pointer-events-none absolute inset-0 z-10">
        <ApertureGauges ap={ap} width={w} height={h} />
      </div>

      {/* top status rail */}
      <div className="pointer-events-auto absolute inset-x-0 top-0 z-20">
        <TopBar height={topH} />
      </div>

      {/* LEFT column: pilot / system / weapons */}
      <div
        className="pointer-events-auto absolute z-20 flex flex-col"
        style={{ left: G, top: columnTop, width: col, height: columnH, gap: G }}
      >
        <div className="min-h-0 shrink-0" style={{ height: pilotH }}>
          <PanelFrame id="pilot" title="PILOT STATUS">
            <PilotStatus />
          </PanelFrame>
        </div>
        <div className="min-h-0 shrink-0" style={{ height: systemH }}>
          <PanelFrame id="system" title="SYSTEM STATUS">
            <SystemStatus />
          </PanelFrame>
        </div>
        <div className="min-h-0 flex-1">
          <PanelFrame id="weapons" title="WEAPON SELECT">
            <WeaponStatus compact={compact} />
          </PanelFrame>
        </div>
      </div>

      {/* RIGHT column: radar / mission / comms */}
      <div
        className="pointer-events-auto absolute z-20 flex flex-col"
        style={{ right: G, top: columnTop, width: col, height: columnH, gap: G }}
      >
        <div className="min-h-0 shrink-0" style={{ height: radarH }}>
          <PanelFrame id="radar" title="TACTICAL SCOPE">
            <Radar />
          </PanelFrame>
        </div>
        <div className="min-h-0" style={{ flex: "0 0 auto", height: Math.round(columnH * 0.24) }}>
          <PanelFrame id="mission" title="MISSION">
            <MissionControl />
          </PanelFrame>
        </div>
        <div className="min-h-0 flex-1">
          <PanelFrame id="comms" title="COMMS PRINTER">
            <CommsLog />
          </PanelFrame>
        </div>
      </div>

      {/* ECHO-01 caption strip — bottom centre of the aperture */}
      <div
        className="pointer-events-auto absolute z-20"
        style={{ left: ap.cx - aiW / 2, top: aiTop, width: aiW, height: AI_STRIP_H }}
      >
        <PanelFrame id="ai-core" title="ECHO-01" variant="strip">
          <AiCore />
        </PanelFrame>
      </div>

      {/* bottom voice console */}
      <div className="pointer-events-auto absolute inset-x-0 bottom-0 z-20" style={{ height: botH }}>
        {voiceBar}
      </div>

      <AlertOverlay />
    </div>
  );
}
