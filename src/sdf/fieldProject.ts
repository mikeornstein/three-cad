/**
 * Project points onto the field isosurface f = 0 (mesh-free).
 */

import { fieldNormal } from "./leaf";
import type { FieldSolid, Vec3 } from "./types";

/** Default linear tolerance for projection / extent search (1 µm). */
export const FIELD_LINEAR_TOL_MM = 1e-3;

/** Alias used by tests / measure policy. */
export const MICRON_MM = FIELD_LINEAR_TOL_MM;

export function projectToSurface(
  field: FieldSolid,
  x: number,
  y: number,
  z: number,
  opts?: { maxIter?: number; tol?: number },
): Vec3 | null {
  const maxIter = opts?.maxIter ?? 32;
  const tol = opts?.tol ?? FIELD_LINEAR_TOL_MM * 0.1;
  let px = x;
  let py = y;
  let pz = z;
  for (let i = 0; i < maxIter; i++) {
    const f = field.evaluate(px, py, pz);
    if (Math.abs(f) <= tol) return [px, py, pz];
    const n = fieldNormal(field, px, py, pz);
    if (!n) return null;
    // True-SDF step: move by f along outward normal toward the surface.
    px -= n[0] * f;
    py -= n[1] * f;
    pz -= n[2] * f;
  }
  const f = field.evaluate(px, py, pz);
  return Math.abs(f) <= tol * 10 ? [px, py, pz] : null;
}

/** Project a world point onto the field surface (Three-friendly). */
export function projectPointOnField(
  field: FieldSolid,
  x: number,
  y: number,
  z: number,
): Vec3 | null {
  return projectToSurface(field, x, y, z);
}
