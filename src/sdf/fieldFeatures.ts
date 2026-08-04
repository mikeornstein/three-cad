/**
 * Differential surface features on a FieldSolid (mesh-free).
 *
 * Used for crease detection, surface-region face grow, and edge snap.
 * Sign convention: f < 0 inside; outward normal ≈ ∇f.
 */

import { projectToSurface } from "./fieldProject";
import { fieldNormal } from "./leaf";
import type { FieldSolid, Vec3 } from "./types";

/** On-crease threshold (edgeness on a 90° box edge is ~0.5; faces ~0). */
export const EDGENESS_MIN = 0.12;

/** Combined feature score threshold for sharp creases / corners. */
export const FEATURE_MIN = 0.25;

/**
 * Product of the two largest |n| components.
 * Peaks on sharp orthant-style edges (cube: 0.5) and corners (~0.33);
 * ~0 on planar face interiors.
 *
 * **Not safe alone as a crease detector on freeform** — on a sphere at 45°
 * normals, |nx|≈|ny|≈0.707 → product ≈ 0.5 even though the surface is smooth.
 * Prefer {@link pairDihedral} / {@link featureScore} for grow boundaries.
 */
export function edgeness(field: FieldSolid, p: Vec3): number {
  const n = fieldNormal(field, p[0], p[1], p[2]);
  if (!n) return 0;
  const a = [Math.abs(n[0]), Math.abs(n[1]), Math.abs(n[2])].sort(
    (u, v) => v - u,
  );
  return a[0]! * a[1]!;
}

/**
 * Pairwise normal disagreement on a ring around p (projected to surface).
 * High on any sharp crease (cube edge *and* sphere∩cube); ~0 on faces.
 */
export function pairDihedral(
  field: FieldSolid,
  p: Vec3,
  ringMm = 0.35,
): number {
  const n0 = fieldNormal(field, p[0], p[1], p[2]);
  if (!n0) return 0;
  const [u, v] = planeBasis(n0);
  const ns: Vec3[] = [];
  const N = 8;
  for (let i = 0; i < N; i++) {
    const ang = (i * 2 * Math.PI) / N;
    const c = Math.cos(ang);
    const s = Math.sin(ang);
    const proj = projectToSurface(
      field,
      p[0] + ringMm * (u[0] * c + v[0] * s),
      p[1] + ringMm * (u[1] * c + v[1] * s),
      p[2] + ringMm * (u[2] * c + v[2] * s),
      { tol: 1e-5 },
    );
    if (!proj) continue;
    const n = fieldNormal(field, proj[0], proj[1], proj[2]);
    if (n) ns.push(n);
  }
  let minDot = 1;
  for (let i = 0; i < ns.length; i++) {
    for (let j = i + 1; j < ns.length; j++) {
      const d =
        ns[i]![0] * ns[j]![0] +
        ns[i]![1] * ns[j]![1] +
        ns[i]![2] * ns[j]![2];
      minDot = Math.min(minDot, d);
    }
  }
  return Math.max(0, 1 - minDot);
}

/**
 * Sharp-feature score for region grow / crease pick.
 *
 * Primary signal is {@link pairDihedral} (true normal disagreement on a ring).
 * {@link edgeness} is only mixed in when dihedral already indicates a feature,
 * so smooth spheres are not treated as creases at diagonal normals.
 */
export function featureScore(field: FieldSolid, p: Vec3): number {
  const dihedral = pairDihedral(field, p);
  // Smooth freeform: dihedral ~0; stop here (do not add raw edgeness).
  if (dihedral < 0.08) return dihedral;
  // Sharp orthant edges: dihedral high + edgeness peaks on the ridge.
  return dihedral + edgeness(field, p);
}

/** Orthonormal tangent basis for a unit normal. */
export function planeBasis(n: Vec3): [Vec3, Vec3] {
  const axis: Vec3 = Math.abs(n[0]) < 0.9 ? [1, 0, 0] : [0, 1, 0];
  const u0 = cross(n, axis);
  const uLen = Math.hypot(u0[0], u0[1], u0[2]);
  if (uLen < 1e-12) {
    return [
      [1, 0, 0],
      [0, 1, 0],
    ];
  }
  const u: Vec3 = [u0[0] / uLen, u0[1] / uLen, u0[2] / uLen];
  const v0 = cross(n, u);
  return [u, v0];
}

export function cross(a: Vec3, b: Vec3): Vec3 {
  return [
    a[1] * b[2] - a[2] * b[1],
    a[2] * b[0] - a[0] * b[2],
    a[0] * b[1] - a[1] * b[0],
  ];
}

/**
 * Axis face bin for near-axis normals (+x/−x/…).
 * Returns null when normal is not axis-aligned enough (curved / freeform).
 */
export function axisFaceBin(
  n: Vec3,
  axisDot = 0.9,
): "+x" | "-x" | "+y" | "-y" | "+z" | "-z" | null {
  const ax = Math.abs(n[0]);
  const ay = Math.abs(n[1]);
  const az = Math.abs(n[2]);
  const m = Math.max(ax, ay, az);
  if (m < axisDot) return null;
  if (ax === m) return n[0] >= 0 ? "+x" : "-x";
  if (ay === m) return n[1] >= 0 ? "+y" : "-y";
  return n[2] >= 0 ? "+z" : "-z";
}
