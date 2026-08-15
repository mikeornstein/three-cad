/** Discrete TAAU input scales. Lower = fewer field pixels, TAAU reconstructs. */
export const INTERNAL_SCALE_LOW = 0.55;
export const INTERNAL_SCALE_MID = 0.72;
export const INTERNAL_SCALE_HIGH = 1;

/**
 * Pick an internal render scale from the FPS EMA.
 * Hysteresis so we do not flip tiers every 400 ms window.
 */
export function internalScaleFromFps(fpsEma: number, current: number): number {
  const fps = Math.max(0, fpsEma);
  if (fps < 24) return INTERNAL_SCALE_LOW;
  if (fps < 32) {
    return current <= INTERNAL_SCALE_MID + 0.01
      ? INTERNAL_SCALE_LOW
      : INTERNAL_SCALE_MID;
  }
  if (fps < 45) {
    return current >= INTERNAL_SCALE_HIGH - 0.01
      ? INTERNAL_SCALE_MID
      : current <= INTERNAL_SCALE_LOW + 0.01
        ? INTERNAL_SCALE_MID
        : current;
  }
  return INTERNAL_SCALE_HIGH;
}
