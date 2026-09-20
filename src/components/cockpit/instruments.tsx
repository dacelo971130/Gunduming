"use client";

/* Small physical-instrument primitives shared by the MFD contents. */

export type LampColor = "off" | "green" | "amber" | "red" | "white";

const LAMP_CLASS: Record<LampColor, string> = {
  off: "",
  green: "lamp-green",
  amber: "lamp-amber",
  red: "lamp-red",
  white: "lamp-white",
};

export function Lamp({
  color,
  size = "md",
  blink = false,
  className = "",
}: {
  color: LampColor;
  size?: "sm" | "md" | "lg";
  blink?: boolean;
  className?: string;
}) {
  const sz = size === "sm" ? "lamp-sm" : size === "lg" ? "lamp-lg" : "";
  return <span className={`lamp ${sz} ${LAMP_CLASS[color]} ${blink && color !== "off" ? "animate-blink" : ""} ${className}`} />;
}

/** Colour a "low is bad" quantity. */
export function lowIsBad(pct: number): LampColor {
  if (pct < 30) return "red";
  if (pct < 60) return "amber";
  return "green";
}

/** Colour a "high is bad" quantity. */
export function highIsBad(pct: number): LampColor {
  if (pct >= 85) return "red";
  if (pct >= 60) return "amber";
  return "green";
}

const FILL_VAR: Record<LampColor, string> = {
  off: "var(--color-mfd-muted)",
  green: "var(--color-mfd-phosphor)",
  amber: "var(--color-mfd-amber)",
  red: "var(--color-mfd-red)",
  white: "var(--color-mfd-text)",
};

const TEXT_CLASS: Record<LampColor, string> = {
  off: "text-mfd-muted",
  green: "text-mfd-phosphor mfd-phosphor",
  amber: "text-mfd-amber mfd-glow-amber",
  red: "text-mfd-red mfd-glow-red",
  white: "text-mfd-text",
};

export function toneClass(c: LampColor) {
  return TEXT_CLASS[c];
}

interface GaugeProps {
  label: string;
  value: number; // 0..100
  unit?: string;
  color: LampColor;
  /** Hatched red over-limit band, in percent. */
  redBand?: [number, number];
  /** Hatched amber "cost of next action" marker, in percent. */
  cost?: [number, number];
  ticks?: number;
  compact?: boolean;
}

/** Horizontal bar gauge with a tick scale, optional over-limit band and cost marker. */
export function Gauge({ label, value, unit = "%", color, redBand, cost, ticks = 5, compact = false }: GaugeProps) {
  const v = Math.max(0, Math.min(100, value));
  const digits = Math.round(v).toString().padStart(3, "0");
  return (
    <div className="flex flex-col gap-[3px]">
      <div className="flex items-baseline justify-between">
        <span className="mfd-label">{label}</span>
        <span className={`mfd-num font-mono ${compact ? "text-[10px]" : "text-[11px]"} font-semibold ${toneClass(color)}`}>
          {digits}
          <span className="ml-[2px] text-[8px] font-normal opacity-60">{unit}</span>
        </span>
      </div>
      <div className="mfd-bar" style={{ height: compact ? 5 : 6 }}>
        {redBand && (
          <div className="mfd-bar-band" style={{ left: `${redBand[0]}%`, width: `${redBand[1] - redBand[0]}%` }} />
        )}
        <div className="mfd-bar-fill" style={{ width: `calc(${v}% - 2px)`, background: FILL_VAR[color] }} />
        {cost && cost[1] > cost[0] && (
          <div className="mfd-bar-cost" style={{ left: `${Math.max(0, cost[0])}%`, width: `${Math.min(100, cost[1]) - Math.max(0, cost[0])}%` }} />
        )}
      </div>
      <div className="relative h-[3px]">
        {Array.from({ length: ticks + 1 }).map((_, i) => (
          <span
            key={i}
            className="absolute top-0 h-full w-px bg-mfd-muted/50"
            style={{ left: `${(i / ticks) * 100}%`, transform: i === ticks ? "translateX(-1px)" : undefined }}
          />
        ))}
      </div>
    </div>
  );
}

/** Label / value pair with dotted leader. */
export function Readout({ label, value, tone = "white" }: { label: string; value: string; tone?: LampColor }) {
  return (
    <div className="flex items-baseline">
      <span className="mfd-label shrink-0">{label}</span>
      <span className="mx-[6px] mb-[3px] flex-1 border-b border-dotted border-mfd-muted/40" />
      <span className={`mfd-num shrink-0 font-mono text-[10px] font-semibold ${toneClass(tone)}`}>{value}</span>
    </div>
  );
}

/** Rectangular LED pip (wave counters etc). */
export function Pip({ state }: { state: "off" | "done" | "active" }) {
  const lit = state !== "off";
  return (
    <span
      className={`inline-block h-[7px] w-[14px] rounded-[1px] border border-black ${state === "active" ? "animate-blink" : ""}`}
      style={{
        background: lit
          ? "linear-gradient(180deg, #b8ffd0, var(--color-mfd-phosphor) 45%, #2d6f47)"
          : "linear-gradient(180deg, #1a201c, #0a0d0b)",
        boxShadow: lit
          ? "0 0 5px rgba(134,207,159,0.6), inset 0 0 0 1px rgba(0,0,0,0.4)"
          : "inset 0 1px 1px rgba(0,0,0,0.9), 0 0 0 1px rgba(255,255,255,0.03)",
      }}
    />
  );
}
