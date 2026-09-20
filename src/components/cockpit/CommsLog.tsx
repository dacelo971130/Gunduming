"use client";

import { useEffect, useRef } from "react";
import { useGame } from "@/game/store";
import type { LogLevel } from "@/game/types";

const LEVEL_STYLE: Record<LogLevel, string> = {
  SYS: "text-hud-gray",
  INFO: "text-hud-green",
  WARN: "text-hud-amber",
  CRIT: "font-semibold text-hud-red",
  AI: "text-glow text-hud-green-glow",
  PILOT: "text-hud-white",
};

function fmtTime(at: number) {
  const d = new Date(at);
  return [d.getHours(), d.getMinutes(), d.getSeconds()].map((n) => n.toString().padStart(2, "0")).join(":");
}

/** Last ~10 log lines, newest at the bottom, auto-scrolled, colour-coded. */
export function CommsLog() {
  const log = useGame((s) => s.log);
  const scrollRef = useRef<HTMLDivElement>(null);
  const entries = log.slice(-10);

  useEffect(() => {
    const el = scrollRef.current;
    if (el) el.scrollTop = el.scrollHeight;
  }, [entries.length]);

  return (
    <div ref={scrollRef} className="h-full min-h-0 space-y-1 overflow-y-auto p-2.5 text-[10px] leading-relaxed">
      {entries.length === 0 && <div className="text-hud-dim">NO TRANSMISSIONS</div>}
      {entries.map((e) => (
        <div key={e.id} className="flex gap-1.5">
          <span className="shrink-0 tabular-nums text-hud-dim">{fmtTime(e.at)}</span>
          <span className={`shrink-0 font-semibold ${LEVEL_STYLE[e.level]}`}>{e.level}</span>
          <span className={LEVEL_STYLE[e.level]}>{e.text}</span>
        </div>
      ))}
    </div>
  );
}
