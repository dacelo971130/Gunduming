"use client";

import { useGame } from "@/game/store";

/* ------------------------------------------------------------------------
 * The physical cockpit structure is now drawn in 3D by the viewport. What
 * remains here is the one piece of hardware that must stay wired to store
 * state: the annunciator cluster — MASTER CAUTION / ARMOR / HEAT / LOCK /
 * LINK — a row of lensed lamps mounted in the top status rail.
 * ---------------------------------------------------------------------- */

export type LampState = "OFF" | "GREEN" | "AMBER" | "RED";

function worse(a: LampState, b: LampState): LampState {
  const rank: Record<LampState, number> = { OFF: 0, GREEN: 1, AMBER: 2, RED: 3 };
  return rank[b] > rank[a] ? b : a;
}

const LAMP_CLASS: Record<LampState, string> = {
  OFF: "",
  GREEN: "lamp-green",
  AMBER: "lamp-amber",
  RED: "lamp-red animate-blink",
};

export function Annunciator({ label, state, wide = false }: { label: string; state: LampState; wide?: boolean }) {
  return (
    <div className="flex flex-col items-center gap-[3px]" title={`${label}: ${state}`}>
      <span
        className={`lamp ${wide ? "!w-[22px] !rounded-[3px]" : ""} ${LAMP_CLASS[state]}`}
        style={{ height: 8 }}
      />
      <span className="mfd-engraved whitespace-nowrap text-[6px] leading-none tracking-[0.12em]">{label}</span>
    </div>
  );
}

/** Derive lamp states from live store fields; pure, cheap, no effects. */
export function useWarningLamps() {
  const phase = useGame((s) => s.phase);
  const armor = useGame((s) => s.player.armor);
  const heat = useGame((s) => s.player.heat);
  const targetId = useGame((s) => s.targetId);
  const hostileClose = useGame((s) =>
    s.enemies.some((e) => e.state !== "DESTROYED" && e.distance > 0 && e.distance < 250),
  );
  const hostileCount = useGame((s) => s.enemies.filter((e) => e.state !== "DESTROYED").length);
  const neuralOnline = useGame((s) => s.neuralOnline);
  const voiceLink = useGame((s) => s.voiceLink);

  const active = phase !== "STANDBY" && phase !== "WAKE";

  const armorState: LampState = armor < 20 ? "RED" : armor < 50 ? "AMBER" : "OFF";
  const heatState: LampState = heat >= 90 ? "RED" : heat >= 60 ? "AMBER" : "OFF";
  const lockState: LampState =
    targetId != null ? "GREEN" : hostileClose ? "RED" : hostileCount > 0 ? "AMBER" : "OFF";
  const linkState: LampState =
    voiceLink === "ERROR"
      ? "RED"
      : !neuralOnline || voiceLink === "MUTED" || voiceLink === "OFFLINE"
        ? "AMBER"
        : "GREEN";

  const cautions: LampState[] = [
    armorState,
    heatState,
    lockState === "GREEN" ? "OFF" : lockState,
    linkState === "GREEN" ? "OFF" : linkState,
  ];
  const worst = cautions.reduce<LampState>(worse, "OFF");
  const masterState: LampState = worst === "RED" ? "RED" : worst === "AMBER" ? "AMBER" : "OFF";

  const off: LampState = "OFF";
  return {
    master: active ? masterState : off,
    armor: active ? armorState : off,
    heat: active ? heatState : off,
    lock: active ? lockState : off,
    link: active ? linkState : off,
  };
}

/** The annunciator cluster — mounted in the top rail by TopBar. */
export function WarningLamps() {
  const lamps = useWarningLamps();
  return (
    <div className="flex items-start gap-[10px]">
      <Annunciator label="MASTER CAUTION" state={lamps.master} wide />
      <Annunciator label="ARMOR" state={lamps.armor} />
      <Annunciator label="HEAT" state={lamps.heat} />
      <Annunciator label="LOCK" state={lamps.lock} />
      <Annunciator label="LINK" state={lamps.link} />
    </div>
  );
}

/** @deprecated the struts/console are 3D now; kept as an alias for the lamp cluster. */
export const CockpitFrame = WarningLamps;
