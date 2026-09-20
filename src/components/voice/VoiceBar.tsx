"use client";

/**
 * VOICE — bottom console strip for the voice link. Shows link state, the
 * push-to-talk mode, a `● RECORDING` lamp while the key is held, a
 * procedural waveform, the live interim transcript, the last recognized
 * command + which path served it, PTT / MUTE / CMDS push-buttons, and a
 * collapsible hint panel. Also hosts the typed-command fallback input
 * (`id="voice-command-box"`, opened by the `/` key via VoiceLink's keyboard
 * handler) that runs through the exact same pipeline as a spoken command.
 */
import { useEffect, useRef, useState, useSyncExternalStore } from "react";
import { useGame } from "@/game/store";
import { bus } from "@/lib/bus";
import type { CommandAction, CommandSource } from "@/game/types";
import {
  isManualMuted,
  isPttHeld,
  isPttMode,
  onMuteChange,
  processTypedCommand,
  toggleManualMute,
  togglePttMode,
} from "@/voice/pipeline";

const STATE_LAMP: Record<string, { lamp: string; text: string }> = {
  LISTENING: { lamp: "lamp-green", text: "text-mfd-phosphor" },
  STANDBY: { lamp: "lamp-amber", text: "text-mfd-bezel-label" },
  MUTED: { lamp: "lamp-amber", text: "text-mfd-amber" },
  ERROR: { lamp: "lamp-red animate-blink", text: "text-mfd-red" },
  OFFLINE: { lamp: "", text: "text-mfd-muted" },
};

const HINTS = [
  '"LOCK NEAREST" / "LOCK RED"',
  '"FIRE" / "PRECISION" / "BARRAGE"',
  '"DEFEND" / "EVADE" / "BOOST LEFT"',
  '"RETREAT" / "ANALYZE" / "SCAN"',
  '"STATUS" / "SPECIAL"',
  '"RIFLE" / "CANNON" / "MISSILES" / "BLADE" / "NEXT WEAPON"',
];

const BAR_COUNT = 24;

function pseudoRandom(seed: number): number {
  const x = Math.sin(seed * 12.9898) * 43758.5453;
  return x - Math.floor(x);
}

/* Mute / PTT state lives outside React in the pipeline; read it as an
   external store so no effect ever has to copy it into state. */
function readMuteKey(): string {
  return `${isManualMuted() ? 1 : 0}|${isPttMode() ? 1 : 0}|${isPttHeld() ? 1 : 0}`;
}
function serverMuteKey(): string {
  return "0|1|0";
}
function subscribeMute(cb: () => void): () => void {
  const off = onMuteChange(cb);
  return () => {
    off();
  };
}

function Waveform({ active }: { active: boolean }) {
  return (
    <div className="flex h-4 items-end gap-[2px]" aria-hidden>
      {Array.from({ length: BAR_COUNT }).map((_, i) => {
        const rand = pseudoRandom(i + 1);
        const baseHeight = active ? 30 + rand * 70 : 8 + rand * 10;
        return (
          <span
            key={i}
            className={`w-[2px] ${active ? "animate-breathe" : ""}`}
            style={{
              height: `${Math.round(baseHeight)}%`,
              background: "var(--color-mfd-phosphor)",
              opacity: active ? 0.55 + rand * 0.4 : 0.3,
              animationDelay: `${i * 60}ms`,
            }}
          />
        );
      })}
    </div>
  );
}

export function VoiceBar() {
  const voiceLink = useGame((s) => s.voiceLink);
  const transcript = useGame((s) => s.transcript);

  const muteKey = useSyncExternalStore(subscribeMute, readMuteKey, serverMuteKey);
  const [manualMuted, pttMode, pttHeld] = muteKey.split("|").map((v) => v === "1") as [boolean, boolean, boolean];

  const [hintOpen, setHintOpen] = useState(false);
  const [inputFocused, setInputFocused] = useState(false);
  const [inputValue, setInputValue] = useState("");
  const [lastCommand, setLastCommand] = useState<{ action: CommandAction; source: CommandSource } | null>(null);
  const inputRef = useRef<HTMLInputElement | null>(null);

  useEffect(() => {
    return bus.on("cmd:executed", ({ command, result }) => {
      setLastCommand({ action: command.action, source: result.source });
    });
  }, []);

  function submit(): void {
    const text = inputValue.trim();
    if (text) processTypedCommand(text);
    setInputValue("");
    inputRef.current?.blur();
  }

  const active = voiceLink === "LISTENING" || pttHeld;
  const stateStyle = STATE_LAMP[voiceLink] ?? STATE_LAMP.STANDBY;
  const sourceColor =
    lastCommand?.source === "REFLEX"
      ? "text-mfd-phosphor"
      : lastCommand?.source === "NEURAL"
        ? "text-mfd-amber"
        : "text-mfd-bezel-label";

  return (
    <div className="console-rail relative flex h-full items-center gap-3 pl-[64px] pr-[104px] font-mono text-[10px]">
      {/* link state lamp */}
      <span className="flex shrink-0 items-center gap-[6px]">
        <span className={`lamp lamp-sm ${stateStyle.lamp}`} />
        <span className={`mfd-engraved ${stateStyle.text}`}>VOICE {voiceLink}</span>
      </span>

      <span className="mfd-engraved shrink-0 whitespace-nowrap">
        MODE&nbsp;
        <span className={pttMode ? "text-mfd-amber" : "text-mfd-phosphor"}>
          {pttMode ? "PUSH-TO-TALK (HOLD M)" : "ALWAYS-ON"}
        </span>
      </span>

      {pttHeld && (
        <span className="flex shrink-0 items-center gap-[5px]">
          <span className="lamp lamp-sm lamp-red animate-blink" />
          <span className="mfd-engraved whitespace-nowrap text-mfd-red">● RECORDING</span>
        </span>
      )}

      {/* transcript channel */}
      <div className="console-channel flex h-[24px] min-w-0 flex-1 items-center gap-3 px-2">
        <Waveform active={active} />
        <span className="mfd-num min-w-0 flex-1 truncate text-[10px] text-mfd-phosphor mfd-phosphor">
          {transcript || <span className="text-mfd-muted">{active ? "…" : ""}</span>}
        </span>
        {lastCommand && (
          <span className="mfd-label shrink-0 whitespace-nowrap">
            LAST&nbsp;
            <span className={sourceColor}>{lastCommand.action}</span>
            &nbsp;
            <span className={sourceColor}>[{lastCommand.source}]</span>
          </span>
        )}
      </div>

      <input
        id="voice-command-box"
        ref={inputRef}
        value={inputValue}
        onChange={(e) => setInputValue(e.target.value)}
        onFocus={() => setInputFocused(true)}
        onBlur={() => setInputFocused(false)}
        onKeyDown={(e) => {
          if (e.key === "Enter") submit();
          if (e.key === "Escape") {
            setInputValue("");
            inputRef.current?.blur();
          }
        }}
        placeholder="/ TYPE COMMAND"
        spellCheck={false}
        autoComplete="off"
        className={`console-channel mfd-num h-[24px] px-2 font-mono text-[10px] outline-none transition-[width,color] duration-150 placeholder:text-mfd-muted ${
          inputFocused ? "w-56 text-mfd-text" : "w-32 text-mfd-muted"
        }`}
        style={inputFocused ? { boxShadow: "inset 0 0 0 1px rgba(134,207,159,0.5), inset 0 1px 3px rgba(0,0,0,0.9)" } : undefined}
      />

      <button type="button" onClick={() => togglePttMode()} className="console-btn" data-lit={pttMode ? "amber" : "true"}>
        {pttMode ? "PTT: ON" : "PTT: OFF"}
      </button>

      <button type="button" onClick={() => toggleManualMute()} className="console-btn" data-lit={manualMuted ? "amber" : "false"}>
        {manualMuted ? "UNMUTE" : "MUTE"}
      </button>

      <button type="button" onClick={() => setHintOpen((v) => !v)} className="console-btn" data-lit={hintOpen ? "true" : "false"}>
        {hintOpen ? "HIDE" : "CMDS"}
      </button>

      {hintOpen && (
        <div className="mfd-bezel absolute bottom-full right-3 z-30 mb-2 w-[340px] max-w-[calc(100vw-24px)] p-[7px]">
          <div className="mfd-glass px-3 py-2">
            <div className="mfd-label flex flex-wrap gap-x-4 gap-y-1 text-[8px] text-mfd-text/80">
              {HINTS.map((h) => (
                <span key={h}>{h}</span>
              ))}
              <span className="text-mfd-amber">
                {pttMode
                  ? "HOLD M (OR SHIFT) TO TALK · RELEASE TO SEND"
                  : "ALWAYS-ON LISTENING · CTRL+V FOR PUSH-TO-TALK"}
              </span>
              <span className="text-mfd-muted">
                KEYS: L R F D E B A S T X · Q next weapon · W previous weapon · M hold-to-talk (Shift alt) · Ctrl+V mode · N mute · /
                type · 1-7 rehearsal · 0 reset
              </span>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
