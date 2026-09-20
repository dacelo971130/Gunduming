"use client";

import { useEffect, useRef } from "react";
import { useGame } from "@/game/store";
import type { LogLevel } from "@/game/types";

const LEVEL_STYLE: Record<LogLevel, string> = {
  SYS: "text-mfd-muted",
  INFO: "text-mfd-phosphor",
  WARN: "text-mfd-amber",
  CRIT: "font-bold text-mfd-red mfd-glow-red",
  AI: "text-mfd-phosphor mfd-phosphor",
  PILOT: "text-mfd-text",
};

const LEVEL_TAG: Record<LogLevel, string> = {
  SYS: "SYS ",
  INFO: "INFO",
  WARN: "WARN",
  CRIT: "CRIT",
  AI: "ECHO",
  PILOT: "PLT ",
};

function fmtTime(at: number) {
  const d = new Date(at);
  return [d.getHours(), d.getMinutes(), d.getSeconds()].map((n) => n.toString().padStart(2, "0")).join(":");
}

/** Message printer: timestamped lines feed in at the bottom, newest last. */
export function CommsLog() {
  const log = useGame((s) => s.log);
  const scrollRef = useRef<HTMLDivElement>(null);
  const entries = log.slice(-14);

  useEffect(() => {
    const el = scrollRef.current;
    if (el) el.scrollTop = el.scrollHeight;
  }, [entries.length]);

  return (
    <div className="relative h-full min-h-0">
      <div
        ref={scrollRef}
        className="mfd-num h-full min-h-0 overflow-y-auto px-2.5 pb-4 pt-1.5 font-mono text-[9.5px] leading-[15px]"
        style={{
          backgroundImage:
            "repeating-linear-gradient(to bottom, transparent 0px, transparent 14px, rgba(134,207,159,0.05) 14px, rgba(134,207,159,0.05) 15px)",
          backgroundPosition: "0 6px",
        }}
      >
        {entries.length === 0 && <div className="text-mfd-muted">-- NO TRAFFIC --</div>}
        {entries.map((e) => (
          <div key={e.id} className="flex gap-2">
            <span className="shrink-0 text-mfd-muted">{fmtTime(e.at)}</span>
            <span className={`shrink-0 whitespace-pre font-semibold ${LEVEL_STYLE[e.level]}`}>{LEVEL_TAG[e.level]}</span>
            <span className={`min-w-0 break-words ${LEVEL_STYLE[e.level]}`}>{e.text}</span>
          </div>
        ))}
        <div className="flex gap-2 text-mfd-phosphor-dim">
          <span className="animate-blink">▍</span>
        </div>
      </div>
      {/* print-head shadow at the feed edge */}
      <div
        className="pointer-events-none absolute inset-x-0 bottom-0 h-4"
        style={{ background: "linear-gradient(180deg, transparent, rgba(0,0,0,0.6))" }}
      />
    </div>
  );
}
