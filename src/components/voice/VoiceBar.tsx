"use client";

/**
 * VOICE — thin bottom strip HUD for the voice link. Shows link state, a
 * procedural waveform, the live interim transcript, the last recognized
 * command + which path served it, a mute button, and a collapsible hint of
 * the main voice commands. Also hosts the typed-command fallback input
 * (`id="voice-command-box"`, opened by the `/` key via VoiceLink's keyboard
 * handler) that runs through the exact same pipeline as a spoken command.
 */
import { useEffect, useRef, useState } from "react";
import { useGame } from "@/game/store";
import { bus } from "@/lib/bus";
import type { CommandAction, CommandSource } from "@/game/types";
import { isManualMuted, onMuteChange, processTypedCommand, toggleManualMute } from "@/voice/pipeline";

const STATE_LABEL_COLOR: Record<string, string> = {
  LISTENING: "text-hud-green",
  STANDBY: "text-hud-gray",
  MUTED: "text-hud-amber",
  ERROR: "text-hud-red",
  OFFLINE: "text-hud-dim",
};

const HINTS = [
  '"LOCK NEAREST" / "LOCK RED"',
  '"FIRE" / "PRECISION" / "BARRAGE"',
  '"DEFEND" / "EVADE" / "BOOST LEFT"',
  '"RETREAT" / "ANALYZE" / "SCAN"',
  '"STATUS" / "SPECIAL"',
];

const BAR_COUNT = 24;

function pseudoRandom(seed: number): number {
  const x = Math.sin(seed * 12.9898) * 43758.5453;
  return x - Math.floor(x);
}

function Waveform({ active }: { active: boolean }) {
  return (
    <div className="flex h-5 items-end gap-[2px]" aria-hidden>
      {Array.from({ length: BAR_COUNT }).map((_, i) => {
        const rand = pseudoRandom(i + 1);
        const baseHeight = active ? 30 + rand * 70 : 8 + rand * 10;
        return (
          <span
            key={i}
            className={`w-[2px] bg-hud-green ${active ? "animate-breathe" : ""}`}
            style={{
              height: `${Math.round(baseHeight)}%`,
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

  const [manualMuted, setManualMutedState] = useState(false);
  const [hintOpen, setHintOpen] = useState(false);
  const [inputFocused, setInputFocused] = useState(false);
  const [inputValue, setInputValue] = useState("");
  const [lastCommand, setLastCommand] = useState<{ action: CommandAction; source: CommandSource } | null>(
    null,
  );
  const inputRef = useRef<HTMLInputElement | null>(null);

  useEffect(() => {
    setManualMutedState(isManualMuted());
    return onMuteChange(() => setManualMutedState(isManualMuted()));
  }, []);

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

  const active = voiceLink === "LISTENING";
  const stateColor = STATE_LABEL_COLOR[voiceLink] ?? "text-hud-gray";
  const sourceColor =
    lastCommand?.source === "REFLEX"
      ? "text-hud-green"
      : lastCommand?.source === "NEURAL"
        ? "text-hud-amber"
        : "text-hud-gray";

  return (
    <div className="hud-panel hud-bracket relative flex flex-col gap-1.5 px-3 py-2 font-mono text-[11px]">
      <div className="flex flex-wrap items-center gap-3">
        <span className={`hud-label ${stateColor}`}>VOICE LINK: {voiceLink}</span>

        <Waveform active={active} />

        <span className="min-w-0 flex-1 truncate text-hud-dim">{transcript || " "}</span>

        {lastCommand && (
          <span className="hud-label whitespace-nowrap">
            LAST:&nbsp;
            <span className={sourceColor}>{lastCommand.action}</span>
            &nbsp;
            <span className={sourceColor}>[{lastCommand.source}]</span>
          </span>
        )}

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
          className={`bg-transparent border px-2 py-1 font-mono outline-none transition-[width,color,border-color] duration-150 ${
            inputFocused ? "w-56 border-hud-green text-hud-white" : "w-32 border-hud-line text-hud-dim"
          }`}
        />

        <button
          type="button"
          onClick={() => toggleManualMute()}
          className="hud-label border border-hud-line px-2 py-1 hover:border-hud-green hover:text-hud-green"
        >
          {manualMuted ? "UNMUTE" : "MUTE"}
        </button>

        <button
          type="button"
          onClick={() => setHintOpen((v) => !v)}
          className="hud-label border border-hud-line px-2 py-1 hover:border-hud-green hover:text-hud-green"
        >
          {hintOpen ? "HIDE" : "CMDS"}
        </button>
      </div>

      {hintOpen && (
        <div className="hud-label flex flex-wrap gap-x-4 gap-y-1 border-t border-hud-line pt-1.5 text-hud-gray">
          {HINTS.map((h) => (
            <span key={h}>{h}</span>
          ))}
          <span className="text-hud-dim">KEYS: L R F D E B A S T X · M mute · / type · 1-7 rehearsal · 0 reset</span>
        </div>
      )}
    </div>
  );
}
