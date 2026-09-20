/**
 * Cockpit geometry shared by the HUD (React) and the battle viewport (WebGL).
 *
 * The pilot looks out through a CIRCULAR canopy aperture. The viewport fills
 * the whole frame underneath; the HUD's multi-function displays live in the
 * regions left and right of the circle, and the physical cockpit frame drawn
 * by the viewport has its inner rim on the circle. Both sides derive every
 * position from `canopyAperture()` so they can never disagree.
 */

/** Aperture radius as a fraction of the viewport HEIGHT. */
export const CANOPY_RADIUS_RATIO = 0.44;
/** Aperture centre as fractions of viewport width / height. */
export const CANOPY_CENTER_X_RATIO = 0.5;
export const CANOPY_CENTER_Y_RATIO = 0.5;
/** Outer padding and inter-panel gap of the HUD grid, px. */
export const HUD_GUTTER_PX = 12;

/** @deprecated legacy rectangular layout — kept only until Cockpit.tsx moves to the aperture. */
export const HUD_LEFT_COLUMN_PX = 290;
/** @deprecated see HUD_LEFT_COLUMN_PX */
export const HUD_RIGHT_COLUMN_PX = 320;

export interface Aperture {
  cx: number;
  cy: number;
  r: number;
}

/** The visible circular canopy in CSS pixels for a given viewport size. */
export function canopyAperture(width: number, height: number): Aperture {
  const r = Math.min(height * CANOPY_RADIUS_RATIO, width * 0.46);
  return { cx: width * CANOPY_CENTER_X_RATIO, cy: height * CANOPY_CENTER_Y_RATIO, r };
}

/** Horizontal span of the aperture — what the 2D fallback viewport projects into. */
export function canopyGlass(width: number, height: number): { x: number; w: number } {
  const { cx, r } = canopyAperture(width, height);
  const w = r * 2;
  if (w < 240) return { x: 0, w: width };
  return { x: cx - r, w };
}

/** Width in px available for a HUD column on each side of the aperture. */
export function hudSideColumnWidth(width: number, height: number): number {
  const { cx, r } = canopyAperture(width, height);
  return Math.max(200, cx - r - HUD_GUTTER_PX * 2);
}
