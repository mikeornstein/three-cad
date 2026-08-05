import type { FieldSolid } from "./types";

/**
 * Resolve the CSG leaf / material id that owns a world point.
 * Used for material ownership and future feature identity.
 */
export function leafAt(
  solid: FieldSolid,
  x: number,
  y: number,
  z: number,
): string | undefined {
  if (solid.leafAt) return solid.leafAt(x, y, z);
  return solid.leafId;
}

/**
 * Finite-difference gradient of the field (approx surface normal direction).
 * Default eps is 0.25 mm — more stable than tiny steps on mm-scale solids.
 */
export function fieldGradient(
  solid: FieldSolid,
  x: number,
  y: number,
  z: number,
  eps = 0.25,
): [number, number, number] {
  const dx =
    solid.evaluate(x + eps, y, z) - solid.evaluate(x - eps, y, z);
  const dy =
    solid.evaluate(x, y + eps, z) - solid.evaluate(x, y - eps, z);
  const dz =
    solid.evaluate(x, y, z + eps) - solid.evaluate(x, y, z - eps);
  const inv = 1 / (2 * eps);
  return [dx * inv, dy * inv, dz * inv];
}

/** Unit gradient, or null if nearly zero. */
export function fieldNormal(
  solid: FieldSolid,
  x: number,
  y: number,
  z: number,
  eps = 0.25,
): [number, number, number] | null {
  const [gx, gy, gz] = fieldGradient(solid, x, y, z, eps);
  const len = Math.hypot(gx, gy, gz);
  if (len < 1e-12) return null;
  return [gx / len, gy / len, gz / len];
}
