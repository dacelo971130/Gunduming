"use client";

import { useGame } from "@/game/store";
import type { Aperture } from "./layout";

/* Etched-glass markings hugging the inside of the canopy rim. Everything here
   lives between 0.94r and r so it never intrudes on the view. */

const RIM_INNER = 0.94;

function polar(cx: number, cy: number, r: number, deg: number) {
  const rad = (deg * Math.PI) / 180;
  return { x: cx + r * Math.sin(rad), y: cy - r * Math.cos(rad) };
}

function norm360(deg: number) {
  return ((deg % 360) + 360) % 360;
}

/** Arc path from `from` to `to` degrees (0 = up, clockwise positive) at radius R. */
function arcPath(cx: number, cy: number, R: number, from: number, to: number) {
  const a = polar(cx, cy, R, from);
  const b = polar(cx, cy, R, to);
  const sweep = to > from ? 1 : 0;
  const large = Math.abs(to - from) > 180 ? 1 : 0;
  return `M ${a.x.toFixed(2)} ${a.y.toFixed(2)} A ${R} ${R} 0 ${large} ${sweep} ${b.x.toFixed(2)} ${b.y.toFixed(2)}`;
}

interface ArcGaugeProps {
  ap: Aperture;
  /** Degrees at 0% and at 100%. */
  from: number;
  to: number;
  value: number; // 0..100
  label: string;
  /** Percent at which the red over-limit band starts (null = none). */
  redFrom: number | null;
  color: string;
}

function ArcGauge({ ap, from, to, value, label, redFrom, color }: ArcGaugeProps) {
  const { cx, cy, r } = ap;
  const R = r * 0.965;
  const v = Math.max(0, Math.min(100, value));
  const lerp = (p: number) => from + (to - from) * (p / 100);
  const mid = lerp(50);
  const labelPos = polar(cx, cy, r * (RIM_INNER + 0.008), mid);
  // Text tangent to the rim; flip on the lower half so it never reads upside down.
  const labelRot = mid > 90 && mid < 270 ? mid + 180 : mid;
  const ticks = [0, 25, 50, 75, 100];
  const over = redFrom !== null && v >= redFrom;

  return (
    <g className="rim-etch">
      <path d={arcPath(cx, cy, R, from, to)} stroke="rgba(134,207,159,0.18)" strokeWidth={3} fill="none" />
      {redFrom !== null && (
        <path d={arcPath(cx, cy, R, lerp(redFrom), to)} stroke="rgba(217,80,90,0.45)" strokeWidth={3} fill="none" />
      )}
      {v > 0.5 && (
        <path
          d={arcPath(cx, cy, R, from, lerp(v))}
          stroke={over ? "var(--color-mfd-red)" : color}
          strokeWidth={3}
          fill="none"
          style={{ transition: "d 200ms" }}
        />
      )}
      {ticks.map((t) => {
        const a = lerp(t);
        const p1 = polar(cx, cy, r * 0.95, a);
        const p2 = polar(cx, cy, r * 0.98, a);
        return <line key={t} x1={p1.x} y1={p1.y} x2={p2.x} y2={p2.y} stroke="rgba(199,211,205,0.45)" strokeWidth={1} />;
      })}
      <text
        x={labelPos.x}
        y={labelPos.y}
        textAnchor="middle"
        dominantBaseline="middle"
        fontFamily="var(--font-instrument)"
        fontSize={8}
        fontWeight={700}
        letterSpacing={1.2}
        fill={over ? "var(--color-mfd-red)" : "rgba(199,211,205,0.7)"}
        transform={`rotate(${labelRot} ${labelPos.x} ${labelPos.y})`}
      >
        {label} {Math.round(v).toString().padStart(3, "0")}
      </text>
    </g>
  );
}

/** Bearing tape along the top of the rim: ±40° of the pilot's heading, 0 dead ahead. */
function BearingTape({ ap, heading }: { ap: Aperture; heading: number }) {
  const { cx, cy, r } = ap;
  const items: React.ReactNode[] = [];
  for (let off = -40; off <= 40; off += 5) {
    const major = off % 10 === 0;
    const p1 = polar(cx, cy, r * (major ? 0.962 : 0.972), off);
    const p2 = polar(cx, cy, r * 0.99, off);
    items.push(
      <line
        key={`t${off}`}
        x1={p1.x}
        y1={p1.y}
        x2={p2.x}
        y2={p2.y}
        stroke={off === 0 ? "var(--color-mfd-phosphor)" : "rgba(199,211,205,0.5)"}
        strokeWidth={off === 0 ? 1.6 : 1}
      />,
    );
    if (off % 20 === 0 && off !== 0) {
      const lp = polar(cx, cy, r * 0.945, off);
      items.push(
        <text
          key={`l${off}`}
          x={lp.x}
          y={lp.y}
          textAnchor="middle"
          dominantBaseline="middle"
          fontFamily="var(--font-instrument)"
          fontSize={8}
          fill="rgba(199,211,205,0.65)"
          transform={`rotate(${off} ${lp.x} ${lp.y})`}
        >
          {norm360(heading + off).toFixed(0).padStart(3, "0")}
        </text>,
      );
    }
  }
  const hp = polar(cx, cy, r * 0.945, 0);
  return (
    <g className="rim-etch">
      {items}
      <text
        x={hp.x}
        y={hp.y}
        textAnchor="middle"
        dominantBaseline="middle"
        fontFamily="var(--font-instrument)"
        fontSize={8.5}
        fontWeight={700}
        fill="var(--color-mfd-phosphor)"
      >
        HDG {norm360(heading).toFixed(0).padStart(3, "0")}
      </text>
    </g>
  );
}

/** Full-frame SVG overlay; only the rim band carries any ink. */
export function ApertureGauges({ ap, width, height }: { ap: Aperture; width: number; height: number }) {
  const heat = useGame((s) => s.player.heat);
  const energy = useGame((s) => s.player.energy);
  const heading = useGame((s) => s.player.bearing);
  const online = useGame((s) => s.panelsOnline.includes("system"));
  if (!online || width <= 0 || height <= 0) return null;

  return (
    <svg
      className="pointer-events-none absolute inset-0"
      width={width}
      height={height}
      viewBox={`0 0 ${width} ${height}`}
      aria-hidden
    >
      {/* faint inner rim line — where the etchings sit */}
      <circle cx={ap.cx} cy={ap.cy} r={ap.r * 0.992} fill="none" stroke="rgba(134,207,159,0.08)" strokeWidth={1} />
      <BearingTape ap={ap} heading={heading} />
      {/* HEAT fills upward on the left rim; ENERGY upward on the right rim */}
      <ArcGauge ap={ap} from={200} to={240} value={heat} label="HEAT" redFrom={85} color="var(--color-mfd-amber)" />
      <ArcGauge ap={ap} from={160} to={120} value={energy} label="ENERGY" redFrom={null} color="var(--color-mfd-phosphor)" />
    </svg>
  );
}
