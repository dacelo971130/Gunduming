/**
 * Lunar-base flavor copy for the BOOT sequence only. `src/lib/config.ts` is a
 * frozen shared module and doesn't know about the setting, so this local file
 * holds the base designation / ambient readouts the boot screens reference.
 * Never used outside `src/components/boot/*`.
 */
export const BASE_DESIGNATION = "HYPERION BASE";
export const BASE_SECTOR = "SECTOR 7 — SHACKLETON RIM";
export const AMBIENT_PRESSURE = "0.0 kPa";
export const AMBIENT_GRAVITY = "0.16 G";
