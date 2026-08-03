/** Display formatting for measure bar (mm-based). */

const LEN = 3;
const AREA = 2;
const VOL = 2;
const ANGLE = 2;

export function formatMm(value: number): string {
  return `${trimNum(value, LEN)} mm`;
}

export function formatMm2(value: number): string {
  return `${trimNum(value, AREA)} mm²`;
}

export function formatMm3(value: number): string {
  return `${trimNum(value, VOL)} mm³`;
}

export function formatDeg(value: number): string {
  return `${trimNum(value, ANGLE)}°`;
}

export function formatVec3(v: { x: number; y: number; z: number }): string {
  return `(${trimNum(v.x, LEN)}, ${trimNum(v.y, LEN)}, ${trimNum(v.z, LEN)}) mm`;
}

/** Unit / direction vectors (no length unit). */
export function formatDir(v: { x: number; y: number; z: number }): string {
  return `(${trimNum(v.x, LEN)}, ${trimNum(v.y, LEN)}, ${trimNum(v.z, LEN)})`;
}

export function formatDelta(v: { x: number; y: number; z: number }): string {
  return `Δ(${trimNum(v.x, LEN)}, ${trimNum(v.y, LEN)}, ${trimNum(v.z, LEN)}) mm`;
}

function trimNum(value: number, digits: number): string {
  if (!Number.isFinite(value)) return "—";
  const abs = Math.abs(value);
  // Avoid "-0.000"
  if (abs < 0.5 * 10 ** -digits) return (0).toFixed(Math.min(digits, 1));
  const s = value.toFixed(digits);
  // Strip trailing zeros after decimal, keep at least one fractional if present.
  if (!s.includes(".")) return s;
  return s.replace(/(\.\d*?)0+$/, "$1").replace(/\.$/, "");
}
