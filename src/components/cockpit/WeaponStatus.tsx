"use client";

import { useGame } from "@/game/store";

function weaponState(heat: number, energy: number): { label: string; color: string } {
  if (heat >= 100) return { label: "OVERHEATED", color: "animate-blink text-hud-red" };
  if (energy < 15) return { label: "CHARGING", color: "text-hud-amber" };
  return { label: "READY", color: "text-hud-green" };
}

/** Weapon readiness, current lock, and the special-move charge meter. */
export function WeaponStatus() {
  const heat = useGame((s) => s.player.heat);
  const energy = useGame((s) => s.player.energy);
  const special = useGame((s) => s.player.special);
  const target = useGame((s) =>
    s.targetId ? (s.enemies.find((e) => e.id === s.targetId) ?? null) : null,
  );

  const state = weaponState(heat, energy);
  const specialReady = special >= 100;

  return (
    <div className="flex h-full flex-col gap-3 p-3">
      <div className="flex items-center justify-between">
        <span className="hud-label">WEAPON</span>
        <span className={`text-xs font-bold tracking-[0.18em] ${state.color}`}>{state.label}</span>
      </div>

      <div className="flex flex-col gap-1 border-t border-hud-line pt-2">
        <span className="hud-label">TARGET</span>
        {target ? (
          <div className="flex items-center justify-between">
            <span className="truncate text-xs text-hud-white">{target.codename}</span>
            <span className="tabular-nums text-xs text-hud-green">{Math.round(target.bearing)}°</span>
          </div>
        ) : (
          <span className="text-xs text-hud-dim">NO LOCK</span>
        )}
      </div>

      <div className="mt-auto flex flex-col gap-1 border-t border-hud-line pt-2">
        <div className="flex items-center justify-between">
          <span className="hud-label">SPECIAL</span>
          <span
            className={`text-xs font-semibold tabular-nums ${
              specialReady ? "text-glow text-hud-green" : "text-hud-white"
            }`}
          >
            {specialReady ? "READY" : `${Math.round(special)}%`}
          </span>
        </div>
        <div className="h-2 w-full overflow-hidden bg-hud-line">
          <div
            className={`h-full transition-[width] duration-300 ${specialReady ? "bg-hud-green" : "bg-hud-amber"}`}
            style={{ width: `${Math.max(0, Math.min(100, special))}%` }}
          />
        </div>
      </div>
    </div>
  );
}
