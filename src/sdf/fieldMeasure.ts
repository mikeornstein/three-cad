/**
 * Field-based measurement queries (authority = SDF, not mesh / op-tree).
 *
 * Mesh is only a seed for “where is this face”; reported mm come from
 * evaluating / projecting on the field to a tolerance.
 */

import { fieldNormal, leafAt } from "./leaf";
import type { FieldSolid, Vec3 } from "./types";

/** Default linear tolerance for projection / extent search (1 µm). */
export const FIELD_LINEAR_TOL_MM = 1e-3;

export type Vec3Mut = [number, number, number];

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

export interface PlanarFaceMeasure {
  area: number;
  /** Recovered plane normal (unit). */
  normal: Vec3;
  centroid: Vec3;
  /** True when area came from axis-aligned rectangle extents (w×h). */
  rectangular: boolean;
  width?: number;
  height?: number;
}

export interface PlanarFaceMeasureOpts {
  /** Require this CSG leaf on the face (when present on the field). */
  leafId?: string;
  /** Hint normal (e.g. from mesh face); refined from field. */
  normalHint?: Vec3;
  /** Half-extent search cap from seed (mm). */
  maxExtent?: number;
  /** Linear search tolerance (mm). */
  tol?: number;
}

/**
 * Measure a planar face region of a field solid.
 *
 * Seed should lie near the face (mesh centroid is fine). Membership is
 * field-based: on surface, normal aligned, optional leaf match.
 *
 * - If the region is a rectangle in the plane (full cube faces), returns w×h
 *   from binary-searched extents (µm linear tol → sub-mm² area).
 * - Otherwise adaptive grid integration on the plane (sphere-cut faces, etc.).
 */
export function measurePlanarFaceFromField(
  field: FieldSolid,
  seed: Vec3,
  opts: PlanarFaceMeasureOpts = {},
): PlanarFaceMeasure | null {
  const tol = opts.tol ?? FIELD_LINEAR_TOL_MM;
  const maxExtent = opts.maxExtent ?? 1e5;

  const projected = projectToSurface(field, seed[0], seed[1], seed[2], {
    tol: tol * 0.1,
  });
  if (!projected) return null;

  const n0 = fieldNormal(field, projected[0], projected[1], projected[2]);
  if (!n0) return null;
  let n: Vec3 = n0;
  if (opts.normalHint) {
    const d =
      n[0] * opts.normalHint[0] +
      n[1] * opts.normalHint[1] +
      n[2] * opts.normalHint[2];
    if (d < 0) n = [-n[0], -n[1], -n[2]];
  }
  // Snap near-axis normals for stable plane axes (mechanical faces).
  n = snapNearAxis(n, 0.995);

  const [u, v] = planeBasis(n);
  let origin: Vec3 = projected;

  const onFace = (p: Vec3): boolean =>
    isOnPlanarFace(field, p, origin, n, opts.leafId, tol);

  // Extents along ±u, ±v from origin (rays). Re-center once so mesh-inset
  // seeds still recover full face width/height.
  let sMax = searchExtent(origin, u, 1, onFace, maxExtent, tol);
  let sMin = searchExtent(origin, u, -1, onFace, maxExtent, tol);
  let tMax = searchExtent(origin, v, 1, onFace, maxExtent, tol);
  let tMin = searchExtent(origin, v, -1, onFace, maxExtent, tol);
  {
    const su = 0.5 * (sMax - sMin);
    const tv = 0.5 * (tMax - tMin);
    const recentered = planePoint(origin, u, v, su, tv);
    if (onFace(recentered)) {
      origin = recentered;
      sMax = searchExtent(origin, u, 1, onFace, maxExtent, tol);
      sMin = searchExtent(origin, u, -1, onFace, maxExtent, tol);
      tMax = searchExtent(origin, v, 1, onFace, maxExtent, tol);
      tMin = searchExtent(origin, v, -1, onFace, maxExtent, tol);
    }
  }

  const width = sMax + sMin;
  const height = tMax + tMin;
  if (!(width > tol && height > tol)) return null;

  // Rectangle test: inset corners (exact corners have multi-face normals /
  // ambiguous inside tests) + interior samples.
  const inset = Math.max(tol * 10, 1e-3);
  const corners: Vec3[] = [
    planePoint(origin, u, v, -sMin + inset, -tMin + inset),
    planePoint(origin, u, v, sMax - inset, -tMin + inset),
    planePoint(origin, u, v, sMax - inset, tMax - inset),
    planePoint(origin, u, v, -sMin + inset, tMax - inset),
  ];
  const rectangular =
    width > 2 * inset &&
    height > 2 * inset &&
    corners.every((c) => onFace(c)) &&
    onFace(planePoint(origin, u, v, 0, 0)) &&
    onFace(planePoint(origin, u, v, 0.25 * (sMax - sMin), 0.25 * (tMax - tMin)));

  if (rectangular) {
    // Parameter domain s ∈ [-sMin, sMax], t ∈ [-tMin, tMax]
    const su = 0.5 * (sMax - sMin);
    const tv = 0.5 * (tMax - tMin);
    const centroid = planePoint(origin, u, v, su, tv);
    return {
      area: width * height,
      normal: n,
      centroid,
      rectangular: true,
      width,
      height,
    };
  }

  // Non-rectangular (notches, sphere cuts): plane-grid integration.
  const area = integrateFaceAreaGrid(
    origin,
    u,
    v,
    -sMin,
    sMax,
    -tMin,
    tMax,
    onFace,
  );
  const centroid = estimateCentroid(
    origin,
    u,
    v,
    -sMin,
    sMax,
    -tMin,
    tMax,
    onFace,
  );
  return {
    area,
    normal: n,
    centroid,
    rectangular: false,
    width,
    height,
  };
}

function snapNearAxis(n: Vec3, thresh: number): Vec3 {
  const ax = Math.abs(n[0]);
  const ay = Math.abs(n[1]);
  const az = Math.abs(n[2]);
  const m = Math.max(ax, ay, az);
  if (m < thresh) return n;
  if (ax === m) return [n[0] >= 0 ? 1 : -1, 0, 0];
  if (ay === m) return [0, n[1] >= 0 ? 1 : -1, 0];
  return [0, 0, n[2] >= 0 ? 1 : -1];
}

function planeBasis(n: Vec3): [Vec3, Vec3] {
  const axis: Vec3 =
    Math.abs(n[0]) < 0.9 ? [1, 0, 0] : [0, 1, 0];
  const u0 = cross(n, axis);
  const uLen = Math.hypot(u0[0], u0[1], u0[2]);
  const u: Vec3 = [u0[0] / uLen, u0[1] / uLen, u0[2] / uLen];
  const v0 = cross(n, u);
  return [u, v0];
}

function cross(a: Vec3, b: Vec3): Vec3 {
  return [
    a[1] * b[2] - a[2] * b[1],
    a[2] * b[0] - a[0] * b[2],
    a[0] * b[1] - a[1] * b[0],
  ];
}

function planePoint(
  origin: Vec3,
  u: Vec3,
  v: Vec3,
  s: number,
  t: number,
): Vec3 {
  return [
    origin[0] + u[0] * s + v[0] * t,
    origin[1] + u[1] * s + v[1] * t,
    origin[2] + u[2] * s + v[2] * t,
  ];
}

function isOnPlanarFace(
  field: FieldSolid,
  p: Vec3,
  planeOrigin: Vec3,
  n: Vec3,
  leafId: string | undefined,
  tol: number,
): boolean {
  // Stay on the seed plane (planar face assumption).
  const dx = p[0] - planeOrigin[0];
  const dy = p[1] - planeOrigin[1];
  const dz = p[2] - planeOrigin[2];
  if (Math.abs(dx * n[0] + dy * n[1] + dz * n[2]) > tol) {
    return false;
  }

  // On the isosurface. Use a tight surface band so extents don't bleed past
  // true edges by ~tol (which would inflate rectangular area).
  const surfaceTol = Math.min(1e-6, tol * 1e-3);
  const f = field.evaluate(p[0], p[1], p[2]);
  if (Math.abs(f) > surfaceTol) return false;

  if (leafId !== undefined && leafId !== "") {
    const leaf = leafAt(field, p[0], p[1], p[2]);
    if (leaf !== leafId) return false;
  }

  // Face-interior check: when ∇f aligns with the face normal, a small step
  // inward must enter the solid. Skip this on edges/corners where ∇f is
  // diagonal (would reject true boundary points and shrink area).
  const nq = fieldNormal(field, p[0], p[1], p[2]);
  if (nq) {
    const align = Math.abs(nq[0] * n[0] + nq[1] * n[1] + nq[2] * n[2]);
    if (align > 0.99) {
      const eps = Math.max(1e-3, tol);
      const fin = field.evaluate(
        p[0] - n[0] * eps,
        p[1] - n[1] * eps,
        p[2] - n[2] * eps,
      );
      if (fin >= -surfaceTol) return false;
    }
  }

  return true;
}

function searchExtent(
  origin: Vec3,
  axis: Vec3,
  sign: 1 | -1,
  onFace: (p: Vec3) => boolean,
  maxExtent: number,
  tol: number,
): number {
  // Grow until outside
  let lo = 0;
  let hi = Math.min(1, maxExtent);
  const point = (d: number): Vec3 => [
    origin[0] + axis[0] * sign * d,
    origin[1] + axis[1] * sign * d,
    origin[2] + axis[2] * sign * d,
  ];
  if (!onFace(point(0))) return 0;

  while (hi < maxExtent && onFace(point(hi))) {
    lo = hi;
    hi = Math.min(hi * 2, maxExtent);
    if (hi === lo) break;
  }
  if (onFace(point(hi))) return hi; // hit cap still inside

  // Binary search boundary in (lo, hi). Use tight stop so rectangular
  // w×h hits full face size (tol is for membership, not search precision).
  const searchTol = Math.min(1e-9, tol * 1e-3);
  for (let i = 0; i < 80; i++) {
    if (hi - lo <= searchTol) break;
    const mid = 0.5 * (lo + hi);
    if (onFace(point(mid))) lo = mid;
    else hi = mid;
  }
  return lo;
}

/**
 * Regular grid integration of face membership over a plane AABB.
 * Step size targets ~0.1 mm so cut-face error stays small vs mesh (~hundreds mm²).
 */
function integrateFaceAreaGrid(
  origin: Vec3,
  u: Vec3,
  v: Vec3,
  s0: number,
  s1: number,
  t0: number,
  t1: number,
  onFace: (p: Vec3) => boolean,
): number {
  const w = s1 - s0;
  const h = t1 - t0;
  if (!(w > 0 && h > 0)) return 0;
  const step = Math.min(0.05, Math.min(w, h) / 200);
  const nx = Math.max(1, Math.ceil(w / step));
  const ny = Math.max(1, Math.ceil(h / step));
  const ds = w / nx;
  const dt = h / ny;
  let area = 0;
  for (let i = 0; i < nx; i++) {
    for (let j = 0; j < ny; j++) {
      const s = s0 + (i + 0.5) * ds;
      const t = t0 + (j + 0.5) * dt;
      if (onFace(planePoint(origin, u, v, s, t))) area += ds * dt;
    }
  }
  return area;
}

function estimateCentroid(
  origin: Vec3,
  u: Vec3,
  v: Vec3,
  s0: number,
  s1: number,
  t0: number,
  t1: number,
  onFace: (p: Vec3) => boolean,
): Vec3 {
  let sx = 0;
  let sy = 0;
  let sz = 0;
  let n = 0;
  const steps = 24;
  for (let i = 0; i <= steps; i++) {
    for (let j = 0; j <= steps; j++) {
      const s = s0 + ((s1 - s0) * i) / steps;
      const t = t0 + ((t1 - t0) * j) / steps;
      const p = planePoint(origin, u, v, s, t);
      if (!onFace(p)) continue;
      sx += p[0];
      sy += p[1];
      sz += p[2];
      n++;
    }
  }
  if (n === 0) return origin;
  return [sx / n, sy / n, sz / n];
}
