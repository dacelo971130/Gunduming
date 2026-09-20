"use client";

import { useEffect, useRef, type ReactNode } from "react";
import { bus } from "@/lib/bus";
import { CockpitFrame } from "./CockpitFrame";
import { HUD_GUTTER_PX, HUD_LEFT_COLUMN_PX, HUD_RIGHT_COLUMN_PX } from "./layout";
import { PanelFrame } from "./PanelFrame";
import { TopBar } from "./TopBar";
import { PilotStatus } from "./PilotStatus";
import { SystemStatus } from "./SystemStatus";
import { WeaponStatus } from "./WeaponStatus";
import { MissionControl } from "./MissionControl";
import { CommsLog } from "./CommsLog";
import { AlertOverlay } from "./AlertOverlay";
import { Radar } from "@/components/radar/Radar";
import { AiCore } from "@/components/ai-core/AiCore";

interface CockpitProps {
  /** The battle viewport — another agent's canvas. Fills the whole frame. */
  viewport: ReactNode;
  /** Slot for the voice module's bottom bar. */
  voiceBar?: ReactNode;
}

/**
 * Full-viewport canopy HUD. The viewport sits underneath as glass; every
 * panel here overlays its edges rather than boxing it into a rectangle.
 */
export function Cockpit({ viewport, voiceBar }: CockpitProps) {
  const shellRef = useRef<HTMLDivElement>(null);

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

  return (
    <div ref={shellRef} className="relative h-full w-full overflow-hidden bg-hud-void">
      {/* battle viewport — fills the frame; HUD panels overlay its edges */}
      <div className="absolute inset-0 z-0">{viewport}</div>

      {/* physical cockpit structure — canopy struts, console deck, warning lamps */}
      <CockpitFrame />

      <div
        className="pointer-events-none absolute inset-0 z-10 grid"
        style={{
          gap: HUD_GUTTER_PX,
          padding: HUD_GUTTER_PX,
          gridTemplateColumns: `${HUD_LEFT_COLUMN_PX}px 1fr ${HUD_RIGHT_COLUMN_PX}px`,
          gridTemplateRows: "auto 1fr auto",
          gridTemplateAreas: '"top top top" "left mid right" "bottom bottom bottom"',
        }}
      >
        <div style={{ gridArea: "top" }} className="pointer-events-auto">
          <TopBar />
        </div>

        <div style={{ gridArea: "left", perspective: "1400px" }} className="min-h-0">
          <div
            className="flex h-full min-h-0 flex-col gap-3"
            style={{ transform: "rotateY(-6deg)", transformOrigin: "right center" }}
          >
            <div className="pointer-events-auto min-h-0 flex-1">
              <PanelFrame id="pilot" title="PILOT STATUS">
                <PilotStatus />
              </PanelFrame>
            </div>
            <div className="pointer-events-auto min-h-0 flex-1">
              <PanelFrame id="system" title="SYSTEM STATUS">
                <SystemStatus />
              </PanelFrame>
            </div>
            <div className="pointer-events-auto min-h-0 flex-1">
              <PanelFrame id="weapons" title="WEAPONS">
                <WeaponStatus />
              </PanelFrame>
            </div>
          </div>
        </div>

        <div
          style={{ gridArea: "mid" }}
          className="flex min-h-0 flex-col items-center justify-end pb-6"
        >
          <div className="pointer-events-auto">
            <AiCore />
          </div>
        </div>

        <div style={{ gridArea: "right", perspective: "1400px" }} className="min-h-0">
          <div
            className="flex h-full min-h-0 flex-col gap-3"
            style={{ transform: "rotateY(6deg)", transformOrigin: "left center" }}
          >
            <div className="pointer-events-auto h-[270px] shrink-0">
              <PanelFrame id="radar" title="RADAR">
                <Radar />
              </PanelFrame>
            </div>
            <div className="pointer-events-auto min-h-0 flex-1">
              <PanelFrame id="mission" title="MISSION CONTROL">
                <MissionControl />
              </PanelFrame>
            </div>
            <div className="pointer-events-auto min-h-0 flex-1">
              <PanelFrame id="comms" title="COMMS LOG">
                <CommsLog />
              </PanelFrame>
            </div>
          </div>
        </div>

        <div style={{ gridArea: "bottom" }} className="pointer-events-auto">
          {voiceBar}
        </div>
      </div>

      <AlertOverlay />
    </div>
  );
}
