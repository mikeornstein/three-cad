import type { FieldSolid } from "./types";

/**
 * Resolve the CSG leaf / material id that owns a world point.
 * Used for field-native face/region selection (#15).
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

/** Finite-difference gradient of the field (for crease / normal hints). */
export function fieldGradient(
  solid: FieldSolid,
  x: number,
  y: number,
  z: number,
  eps = 1e-3,
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
