"use client";

import { useEffect, useState } from "react";
import { useGame } from "@/game/store";
import { usePanelOnline } from "@/components/cockpit/PanelFrame";
import { Lamp, type LampColor } from "@/components/cockpit/instruments";
import { AI_NAME } from "@/lib/config";
import type { AiStatus, VoiceLinkState } from "@/game/types";

const STATUS_LAMP: Record<AiStatus, { color: LampColor; blink: boolean; word: string }> = {
  OFFLINE: { color: "off", blink: false, word: "OFFLINE" },
  IDLE: { color: "green", blink: false, word: "STANDBY" },
  LISTENING: { color: "green", blink: true, word: "LISTENING" },
  THINKING: { color: "amber", blink: true, word: "PROCESSING" },
  SPEAKING: { color: "white", blink: false, word: "SPEAKING" },
};

/** Typewriter that resets on new text without a synchronous setState in the effect. */
function useTypewriter(text: string, speed = 22) {
  const [state, setState] = useState<{ text: string; count: number }>({ text: "", count: 0 });
  useEffect(() => {
    if (!text) return;
    let i = 0;
    const id = window.setInterval(() => {
      i += 1;
      setState({ text, count: i });
      if (i >= text.length) window.clearInterval(id);
    }, speed);
    return () => window.clearInterval(id);
  }, [text, speed]);
  const count = state.text === text ? state.count : 0;
  return text.slice(0, count);
}

function linkQuality(neuralOnline: boolean, voice: VoiceLinkState): { bars: number; tone: LampColor; label: string } {
  if (voice === "ERROR") return { bars: 0, tone: "red", label: "LINK FAULT" };
  if (voice === "OFFLINE") return { bars: 0, tone: "off", label: "NO LINK" };
  const base = neuralOnline ? 3 : 1;
  const voiceBars = voice === "LISTENING" ? 2 : voice === "STANDBY" ? 1 : 0; // MUTED = 0
  const bars = Math.min(5, base + voiceBars);
  const tone: LampColor = voice === "MUTED" ? "amber" : neuralOnline ? "green" : "amber";
  const label = neuralOnline ? "NEURAL" : "REFLEX";
  return { bars, tone, label };
}

const BAR_FILL: Record<LampColor, string> = {
  off: "var(--color-mfd-muted)",
  green: "var(--color-mfd-phosphor)",
  amber: "var(--color-mfd-amber)",
  red: "var(--color-mfd-red)",
  white: "var(--color-mfd-text)",
};

/** ECHO-01's caption strip: status lamp, subtitle line, link-quality meter. The robot itself is 3D. */
export function AiCore() {
  const online = usePanelOnline("ai-core");
  const status = useGame((s) => s.aiStatus);
  const caption = useGame((s) => s.aiCaption);
  const neuralOnline = useGame((s) => s.neuralOnline);
  const voiceLink = useGame((s) => s.voiceLink);
  const typed = useTypewriter(online ? caption : "");

  const effective: AiStatus = online ? status : "OFFLINE";
  const lamp = STATUS_LAMP[effective];
  const link = linkQuality(neuralOnline, voiceLink);

  return (
    <div className="flex h-full items-center gap-3 px-2.5 select-none">
      <div className="flex shrink-0 flex-col items-start gap-[3px]">
        <span className="flex items-center gap-[6px]">
          <Lamp color={lamp.color} size="sm" blink={lamp.blink} />
          <span className="mfd-label text-[8px] text-mfd-text">{AI_NAME}</span>
        </span>
        <span className={`mfd-label text-[7px] ${effective === "OFFLINE" ? "" : "text-mfd-phosphor"}`}>{lamp.word}</span>
      </div>

      <div className="h-[24px] w-px bg-mfd-phosphor-faint" />

      <div className="mfd-num min-w-0 flex-1 font-mono text-[10.5px] leading-[13px] text-mfd-text">
        <span className="line-clamp-2 break-words">
          {typed}
          {typed.length < caption.length && <span className="animate-blink text-mfd-phosphor">▍</span>}
          {!typed && <span className="text-mfd-muted">{online ? "…" : "OFFLINE"}</span>}
        </span>
      </div>

      <div className="h-[24px] w-px bg-mfd-phosphor-faint" />

      <div className="flex shrink-0 flex-col items-end gap-[3px]" title={`link: ${voiceLink}, neural ${neuralOnline ? "online" : "offline"}`}>
        <div className="flex items-end gap-[2px]" aria-hidden>
          {Array.from({ length: 5 }).map((_, i) => (
            <span
              key={i}
              className="w-[3px]"
              style={{
                height: 4 + i * 2,
                background: i < link.bars ? BAR_FILL[link.tone] : "rgba(107,122,117,0.25)",
                boxShadow: i < link.bars ? `0 0 3px ${BAR_FILL[link.tone]}` : "none",
              }}
            />
          ))}
        </div>
        <span className="mfd-label text-[7px]">{link.label}</span>
      </div>
    </div>
  );
}
