/**
 * Field-based measurement queries (authority = SDF, not mesh / op-tree).
 *
 * Mesh is only a seed for “where is this face”; reported mm come from
 * evaluating / projecting on the field to a tolerance.
 */

import {
  cross,
  edgeness,
  EDGENESS_MIN,
  featureScore,
  FEATURE_MIN,
  pairDihedral,
  planeBasis,
} from "./fieldFeatures";
import {
  FIELD_LINEAR_TOL_MM,
  MICRON_MM,
  projectPointOnField,
  projectToSurface,
} from "./fieldProject";
import { fieldNormal, leafAt } from "./leaf";
import type { FieldSolid, Vec3 } from "./types";

export { FIELD_LINEAR_TOL_MM, MICRON_MM, projectPointOnField, projectToSurface };

export function nearlyEqual(a: number, b: number, tol = MICRON_MM): boolean {
  return Math.abs(a - b) <= tol;
}

export function nearlyEqualVec(a: Vec3, b: Vec3, tol = MICRON_MM): boolean {
  return Math.hypot(a[0] - b[0], a[1] - b[1], a[2] - b[2]) <= tol;
}

export type Vec3Mut = [number, number, number];

/** Measured surface patch (planar or freeform) from the field. */
export interface SurfaceMeasure {
  area: number;
  normal: Vec3;
  centroid: Vec3;
  planar: boolean;
  /** True when planar and the face is a filled rectangle (area = w×h). */
  rectangular: boolean;
  width?: number;
  height?: number;
}

/** @deprecated Use SurfaceMeasure — kept for call-site clarity on planar-only APIs. */
export type PlanarFaceMeasure = SurfaceMeasure;

/** Fast plane frame for paint/highlight — extents only, no area. */
export interface PlanarFaceFrame {
  readonly normal: Vec3;
  readonly centroid: Vec3;
  readonly u: Vec3;
  readonly v: Vec3;
  /** Domain s ∈ [s0, s1], t ∈ [t0, t1] in (u,v) from centroid. */
  readonly s0: number;
  readonly s1: number;
  readonly t0: number;
  readonly t1: number;
  readonly width: number;
  readonly height: number;
  readonly rectangular: boolean;
}

export interface SurfaceMeasureOpts {
  /** Require this CSG leaf on the face (when present on the field). */
  leafId?: string;
  /** Hint normal (e.g. from mesh face); refined from field. */
  normalHint?: Vec3;
  /** Half-extent search cap from seed (mm). */
  maxExtent?: number;
  /** Linear search tolerance (mm). */
  tol?: number;
  /**
   * Force planar chart path when true, freeform solid-angle when false.
   * When omitted, planarity is detected from the field around the seed.
   */
  planar?: boolean;
}

/** @deprecated Use SurfaceMeasureOpts. */
export type PlanarFaceMeasureOpts = SurfaceMeasureOpts;

/**
 * Fast plane frame (extents only) for highlight / paint — no area integration.
 */
export function planarFaceFrameFromField(
  field: FieldSolid,
  seed: Vec3,
  opts: PlanarFaceMeasureOpts = {},
): PlanarFaceFrame | null {
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
  n = snapNearAxis(n, 0.995);

  const [u, v] = planeBasis(n);
  let origin: Vec3 = projected;

  const onFace = (p: Vec3): boolean =>
    isOnPlanarFace(field, p, origin, n, opts.leafId, tol);

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
    onFace(
      planePoint(origin, u, v, 0.25 * (sMax - sMin), 0.25 * (tMax - tMin)),
    );

  // Express domain relative to centroid (center of extent box).
  const su = 0.5 * (sMax - sMin);
  const tv = 0.5 * (tMax - tMin);
  const centroid = planePoint(origin, u, v, su, tv);
  return {
    normal: n,
    centroid,
    u,
    v,
    s0: -sMin - su,
    s1: sMax - su,
    t0: -tMin - tv,
    t1: tMax - tv,
    width,
    height,
    rectangular,
  };
}

/**
 * Universal surface-area measure on a FieldSolid (planar or freeform).
 *
 * Authority is the field, not a mesh. One seed on the surface → the crease-
 * bounded / leaf-bounded patch containing that seed.
 *
 * - **Planar** (detected or forced): chart extents + adaptive membership
 *   integral in the face plane. Full rectangles use exact w×h.
 * - **Freeform**: equal-solid-angle rays from an interior point; each hit on
 *   the same leaf (and off hard creases) contributes R² dΩ / |r̂·n|.
 *
 * No bbox-area shortcuts — cut planar faces get true membership area.
 */
export function measureSurfaceFromField(
  field: FieldSolid,
  seedIn: Vec3,
  opts: SurfaceMeasureOpts = {},
): SurfaceMeasure | null {
  const seed = projectToSurface(field, seedIn[0], seedIn[1], seedIn[2], {
    tol: 1e-6,
  });
  if (!seed) return null;

  let n0 = fieldNormal(field, seed[0], seed[1], seed[2]);
  if (!n0) return null;
  if (opts.normalHint) {
    const d =
      n0[0] * opts.normalHint[0] +
      n0[1] * opts.normalHint[1] +
      n0[2] * opts.normalHint[2];
    if (d < 0) n0 = [-n0[0], -n0[1], -n0[2]];
  }

  const leafId =
    opts.leafId !== undefined && opts.leafId !== ""
      ? opts.leafId
      : leafAt(field, seed[0], seed[1], seed[2]);

  const planar =
    opts.planar !== undefined
      ? opts.planar
      : surfaceLooksPlanar(field, seed, n0);

  if (planar) {
    const frame = planarFaceFrameFromField(field, seed, {
      leafId,
      normalHint: n0,
      maxExtent: opts.maxExtent,
      tol: opts.tol,
    });
    if (!frame) return null;

    if (frame.rectangular) {
      return {
        area: frame.width * frame.height,
        normal: frame.normal,
        centroid: frame.centroid,
        planar: true,
        rectangular: true,
        width: frame.width,
        height: frame.height,
      };
    }

    const tol = opts.tol ?? FIELD_LINEAR_TOL_MM;
    const onFace = (p: Vec3): boolean =>
      isOnPlanarFace(field, p, frame.centroid, frame.normal, leafId, tol);

    const { area, centroid } = adaptiveChartArea(
      frame.centroid,
      frame.u,
      frame.v,
      frame.s0,
      frame.s1,
      frame.t0,
      frame.t1,
      onFace,
      // Plane chart: Jacobian = 1 (surface is the plane).
      () => 1,
    );
    return {
      area,
      normal: frame.normal,
      centroid,
      planar: true,
      rectangular: false,
      width: frame.width,
      height: frame.height,
    };
  }

  return measureFreeformLeafArea(field, seed, n0, leafId);
}

/**
 * Planar-only convenience wrapper (same result as measureSurfaceFromField
 * with planar detection / frame path).
 */
export function measurePlanarFaceFromField(
  field: FieldSolid,
  seed: Vec3,
  opts: SurfaceMeasureOpts = {},
): SurfaceMeasure | null {
  return measureSurfaceFromField(field, seed, { ...opts, planar: true });
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

/** Local normal agreement → planar face (vs freeform leaf). */
function surfaceLooksPlanar(
  field: FieldSolid,
  seed: Vec3,
  seedN: Vec3,
): boolean {
  const [u, v] = planeBasis(seedN);
  const ring = 8;
  let sumDot = 0;
  let total = 0;
  for (let i = 0; i < 8; i++) {
    const ang = (i * Math.PI) / 4;
    const c = Math.cos(ang);
    const s = Math.sin(ang);
    const proj = projectToSurface(
      field,
      seed[0] + ring * (u[0] * c + v[0] * s),
      seed[1] + ring * (u[1] * c + v[1] * s),
      seed[2] + ring * (u[2] * c + v[2] * s),
      { tol: 1e-5 },
    );
    if (!proj) continue;
    if (featureScore(field, proj) >= FEATURE_MIN) continue;
    const n = fieldNormal(field, proj[0], proj[1], proj[2]);
    if (!n) continue;
    total++;
    sumDot += n[0] * seedN[0] + n[1] * seedN[1] + n[2] * seedN[2];
  }
  if (total < 4) return false;
  return sumDot / total >= 0.998;
}

/**
 * Adaptive quadtree area on a (u,v) chart.
 * jac(p) is dA_surface / (ds dt); plane faces use 1.
 *
 * Interior/exterior cells exit early; only the boundary band is refined
 * down to minCell, where a single center sample decides (same bias class
 * as a uniform grid, but orders of magnitude fewer samples).
 */
function adaptiveChartArea(
  origin: Vec3,
  u: Vec3,
  v: Vec3,
  s0: number,
  s1: number,
  t0: number,
  t1: number,
  onFace: (p: Vec3) => boolean,
  jac: (p: Vec3) => number,
  minCell = 0.08,
): { area: number; centroid: Vec3 } {
  let area = 0;
  let cx = 0;
  let cy = 0;
  let cz = 0;
  let wSum = 0;

  /** Classify cell: 1 = all in, 0 = all out, -1 = mixed / uncertain. */
  const classify = (
    sa: number,
    sb: number,
    ta: number,
    tb: number,
  ): 0 | 1 | -1 => {
    // 2×2 corners + center — cheap mixed-cell detector.
    const pts: [number, number][] = [
      [sa, ta],
      [sb, ta],
      [sa, tb],
      [sb, tb],
      [0.5 * (sa + sb), 0.5 * (ta + tb)],
    ];
    let nIn = 0;
    for (const [s, t] of pts) {
      if (onFace(planePoint(origin, u, v, s, t))) nIn++;
    }
    if (nIn === 5) return 1;
    if (nIn === 0) return 0;
    return -1;
  };

  const add = (sa: number, sb: number, ta: number, tb: number, f: number): void => {
    const ds = sb - sa;
    const dt = tb - ta;
    if (f <= 0 || !(ds > 0 && dt > 0)) return;
    const sm = 0.5 * (sa + sb);
    const tm = 0.5 * (ta + tb);
    const mid = planePoint(origin, u, v, sm, tm);
    const j = Math.max(jac(mid), 1e-6);
    const dA = ds * dt * f * j;
    area += dA;
    cx += mid[0] * dA;
    cy += mid[1] * dA;
    cz += mid[2] * dA;
    wSum += dA;
  };

  const visit = (
    sa: number,
    sb: number,
    ta: number,
    tb: number,
    depth: number,
  ): void => {
    const ds = sb - sa;
    const dt = tb - ta;
    if (!(ds > 0 && dt > 0)) return;
    const kind = classify(sa, sb, ta, tb);
    if (kind === 0) return;
    if (kind === 1) {
      add(sa, sb, ta, tb, 1);
      return;
    }
    // Mixed: refine, or center-sample at resolution limit.
    if (ds <= minCell || dt <= minCell || depth >= 16) {
      const sm = 0.5 * (sa + sb);
      const tm = 0.5 * (ta + tb);
      if (onFace(planePoint(origin, u, v, sm, tm))) add(sa, sb, ta, tb, 1);
      return;
    }
    const sm = 0.5 * (sa + sb);
    const tm = 0.5 * (ta + tb);
    visit(sa, sm, ta, tm, depth + 1);
    visit(sm, sb, ta, tm, depth + 1);
    visit(sa, sm, tm, tb, depth + 1);
    visit(sm, sb, tm, tb, depth + 1);
  };

  visit(s0, s1, t0, t1, 0);
  const centroid: Vec3 =
    wSum > 1e-18 ? [cx / wSum, cy / wSum, cz / wSum] : origin;
  return { area, centroid };
}

/**
 * Freeform leaf area via equal solid-angle samples from an interior point.
 * dA = R² dΩ / |r̂ · n| for each surface hit on the same leaf (off creases).
 */
function measureFreeformLeafArea(
  field: FieldSolid,
  seed: Vec3,
  seedN: Vec3,
  leafId: string | undefined,
): SurfaceMeasure | null {
  // Interior probe: step against the outward normal until clearly inside.
  let c: Vec3 = [
    seed[0] - seedN[0] * 2,
    seed[1] - seedN[1] * 2,
    seed[2] - seedN[2] * 2,
  ];
  for (let i = 0; i < 24; i++) {
    const f = field.evaluate(c[0], c[1], c[2]);
    if (f < -1) break;
    const n = fieldNormal(field, c[0], c[1], c[2]) ?? seedN;
    c = [c[0] - n[0] * 2, c[1] - n[1] * 2, c[2] - n[2] * 2];
  }
  if (!(field.evaluate(c[0], c[1], c[2]) < 0)) {
    // Fallback: seed itself as origin of a local chart integral.
    return measureFreeformChartFallback(field, seed, seedN, leafId);
  }

  const N = 14000;
  const golden = Math.PI * (3 - Math.sqrt(5));
  let area = 0;
  let cx = 0;
  let cy = 0;
  let cz = 0;
  let nx = 0;
  let ny = 0;
  let nz = 0;
  let hits = 0;

  for (let i = 0; i < N; i++) {
    const y = 1 - (i / Math.max(1, N - 1)) * 2;
    const r = Math.sqrt(Math.max(0, 1 - y * y));
    const th = golden * i;
    const dir: Vec3 = [Math.cos(th) * r, y, Math.sin(th) * r];

    // March from interior along dir to the first surface crossing.
    let t = 0.3;
    let hit: Vec3 | null = null;
    for (let s = 0; s < 96; s++) {
      const p: Vec3 = [c[0] + dir[0] * t, c[1] + dir[1] * t, c[2] + dir[2] * t];
      const d = field.evaluate(p[0], p[1], p[2]);
      if (d >= 0) {
        hit =
          projectToSurface(field, p[0], p[1], p[2], { tol: 1e-4 }) ?? p;
        break;
      }
      t += Math.max(-d * 0.9, 0.15);
      if (t > 400) break;
    }
    if (!hit) continue;
    if (leafId) {
      const L = leafAt(field, hit[0], hit[1], hit[2]);
      if (L && L !== leafId) continue;
    }
    // Stay on the smooth freeform patch (not cube creases).
    if (featureScore(field, hit) >= FEATURE_MIN) continue;
    const nh = fieldNormal(field, hit[0], hit[1], hit[2]);
    if (!nh) continue;

    const R = Math.hypot(hit[0] - c[0], hit[1] - c[1], hit[2] - c[2]);
    if (R < 1e-9) continue;
    const rhat: Vec3 = [
      (hit[0] - c[0]) / R,
      (hit[1] - c[1]) / R,
      (hit[2] - c[2]) / R,
    ];
    const cos = Math.abs(
      nh[0] * rhat[0] + nh[1] * rhat[1] + nh[2] * rhat[2],
    );
    if (cos < 1e-4) continue;

    const dA = (R * R * (4 * Math.PI)) / N / cos;
    area += dA;
    cx += hit[0] * dA;
    cy += hit[1] * dA;
    cz += hit[2] * dA;
    nx += nh[0];
    ny += nh[1];
    nz += nh[2];
    hits++;
  }

  if (hits < 8 || area < 1e-6) {
    return measureFreeformChartFallback(field, seed, seedN, leafId);
  }
  const inv = 1 / area;
  const nlen = Math.hypot(nx, ny, nz) || 1;
  return {
    area,
    centroid: [cx * inv, cy * inv, cz * inv],
    normal: [nx / nlen, ny / nlen, nz / nlen],
    planar: false,
    rectangular: false,
  };
}

/** Local tangent-chart integral when solid-angle probing fails. */
function measureFreeformChartFallback(
  field: FieldSolid,
  seed: Vec3,
  seedN: Vec3,
  leafId: string | undefined,
): SurfaceMeasure | null {
  const [u, v] = planeBasis(seedN);
  // Walk extents on the surface chart until crease / leaf change.
  const onRegion = (raw: Vec3): boolean => {
    const q = projectToSurface(field, raw[0], raw[1], raw[2], { tol: 1e-5 });
    if (!q) return false;
    if (featureScore(field, q) >= FEATURE_MIN) return false;
    if (leafId) {
      const L = leafAt(field, q[0], q[1], q[2]);
      if (L && L !== leafId) return false;
    }
    const n = fieldNormal(field, q[0], q[1], q[2]);
    if (!n) return false;
    // Stay on the same side of the silhouette for this chart.
    return n[0] * seedN[0] + n[1] * seedN[1] + n[2] * seedN[2] > 0.15;
  };

  const maxE = 1e4;
  const tol = FIELD_LINEAR_TOL_MM;
  const sMax = searchExtent(seed, u, 1, onRegion, maxE, tol);
  const sMin = searchExtent(seed, u, -1, onRegion, maxE, tol);
  const tMax = searchExtent(seed, v, 1, onRegion, maxE, tol);
  const tMin = searchExtent(seed, v, -1, onRegion, maxE, tol);
  if (sMax + sMin < tol || tMax + tMin < tol) return null;

  const onFace = (p: Vec3): boolean => onRegion(p);
  const jac = (p: Vec3): number => {
    const q = projectToSurface(field, p[0], p[1], p[2], { tol: 1e-5 }) ?? p;
    const n = fieldNormal(field, q[0], q[1], q[2]);
    if (!n) return 1;
    const c = Math.abs(
      n[0] * seedN[0] + n[1] * seedN[1] + n[2] * seedN[2],
    );
    return c > 1e-3 ? 1 / c : 1e3;
  };

  const { area, centroid } = adaptiveChartArea(
    seed,
    u,
    v,
    -sMin,
    sMax,
    -tMin,
    tMax,
    onFace,
    jac,
    0.35,
  );
  if (area < 1e-6) return null;
  return {
    area,
    centroid,
    normal: seedN,
    planar: false,
    rectangular: false,
    width: sMax + sMin,
    height: tMax + tMin,
  };
}

// ---------------------------------------------------------------------------
// Edges (crease-aware field measure — no op-tree)
// ---------------------------------------------------------------------------

export interface EdgeMeasure {
  /** Polyline on the surface (for highlight / pick). */
  points: Vec3[];
  a: Vec3;
  b: Vec3;
  length: number;
  /** True when treated as a straight crease (chord length). */
  linear: boolean;
}

/**
 * Measure an edge from a mesh seed polyline by querying the field.
 *
 * Mesh seeds only locate the feature. Lengths and endpoints come from walking
 * the field crease (sharp normal discontinuity on \(f=0\)), not from summing
 * MC stairs or an op-tree.
 *
 * - Project seeds → snap to crease
 * - Linear crease: extend ± along principal direction while on-crease
 * - Curved crease: densify with crease snaps, arc-length sum
 */
export function measureEdgeOnField(
  field: FieldSolid,
  seedPoints: readonly { x: number; y: number; z: number }[],
  opts?: { tol?: number; linearTol?: number },
): EdgeMeasure | null {
  const tol = opts?.tol ?? FIELD_LINEAR_TOL_MM;
  /** Residual to principal axis after crease snap (mm). MC stairs are ~1–2 cell. */
  const linearTol = opts?.linearTol ?? 2.5;

  // Surface-project seeds for classification. Do **not** crease-snap first:
  // that pulls sphere∩cube arc samples onto cube edges and mis-labels arcs
  // as linear (or inflates length).
  const projected: Vec3[] = [];
  for (const s of seedPoints) {
    const p = projectToSurface(field, s.x, s.y, s.z, { tol: 1e-7 });
    if (p) projected.push(p);
  }
  if (projected.length < 2) return null;

  const pca = principalAxis(projected);
  if (!pca) return null;
  const { origin, unit, maxResidual, span } = pca;
  if (span < tol) return null;

  const linear = maxResidual <= linearTol;

  if (linear) {
    // Snap mid to crease, then extend both ways along unit while on crease.
    const mid0 = projectToCrease(field, origin[0], origin[1], origin[2]);
    if (!mid0) return null;
    // Align unit with the seed span so extension is stable.
    const seedDir = directionFromEndpoints(projected);
    let walk: Vec3 = unit;
    if (seedDir) {
      const dot =
        walk[0] * seedDir[0] + walk[1] * seedDir[1] + walk[2] * seedDir[2];
      if (dot < 0) walk = [-walk[0], -walk[1], -walk[2]];
    }
    // Prefer axis-aligned walk for mechanical edges (stable FD normals).
    walk = snapNearAxis(walk, 0.995);
    const pa = extendLinearCrease(field, mid0, walk, -1, 1e5);
    const pb = extendLinearCrease(field, mid0, walk, 1, 1e5);
    const length = Math.hypot(
      pb[0] - pa[0],
      pb[1] - pa[1],
      pb[2] - pa[2],
    );
    if (length < tol) return null;
    return {
      points: [pa, pb],
      a: pa,
      b: pb,
      length,
      linear: true,
    };
  }

  // Curved crease: if planar, circular arc via chord+sagitta; else polyline.

  const planar = fitPlane(projected);
  // Prefer circular-arc measure on planar creases (sphere∩face): chord +
  // sagitta → r, θ. Polyline sum on MC stairs overestimates badly.
  // MC stairs sit ~1 cell off the true face; allow a few mm residual.
  if (planar && planar.maxResidual <= 3.0) {
    const arc = measurePlanarCircularArc(field, projected, planar);
    if (arc) return arc;
  }

  const samples = densifySurfacePolyline(field, projected, 0.75);
  if (samples.length < 2) return null;
  let length = 0;
  for (let i = 1; i < samples.length; i++) {
    const p0 = samples[i - 1]!;
    const p1 = samples[i]!;
    length += Math.hypot(p1[0] - p0[0], p1[1] - p0[1], p1[2] - p0[2]);
  }
  return {
    points: samples,
    a: samples[0]!,
    b: samples[samples.length - 1]!,
    length,
    linear: false,
  };
}

/**
 * Circular arc through planar surface samples via chord + mean sagitta.
 * Endpoints are surface-projected extremes of the seed span.
 */
function measurePlanarCircularArc(
  field: FieldSolid,
  points: Vec3[],
  plane: { origin: Vec3; normal: Vec3; u: Vec3; v: Vec3 },
): EdgeMeasure | null {
  // Endpoints: farthest pair among samples (stable for open arcs).
  let a = points[0]!;
  let b = points[points.length - 1]!;
  let best = -1;
  for (let i = 0; i < points.length; i++) {
    for (let j = i + 1; j < points.length; j++) {
      const d = Math.hypot(
        points[j]![0] - points[i]![0],
        points[j]![1] - points[i]![1],
        points[j]![2] - points[i]![2],
      );
      if (d > best) {
        best = d;
        a = points[i]!;
        b = points[j]!;
      }
    }
  }
  a =
    projectToSurface(field, a[0], a[1], a[2], { tol: 1e-8 }) ?? a;
  b =
    projectToSurface(field, b[0], b[1], b[2], { tol: 1e-8 }) ?? b;

  const chord = Math.hypot(b[0] - a[0], b[1] - a[1], b[2] - a[2]);
  if (chord < 1e-9) return null;

  // Peak sagitta of samples from the chord. Mean is diluted by near-end
  // samples and underestimates r for circular arcs (inflates length).
  // Prefer the max among samples near mid-chord (t ∈ [0.25, 0.75]).
  let maxS = 0;
  let midS = 0;
  const abLen2 = chord * chord;
  for (const p of points) {
    const ap: Vec3 = [p[0] - a[0], p[1] - a[1], p[2] - a[2]];
    const ab: Vec3 = [b[0] - a[0], b[1] - a[1], b[2] - a[2]];
    const t = Math.min(
      1,
      Math.max(0, (ap[0] * ab[0] + ap[1] * ab[1] + ap[2] * ab[2]) / abLen2),
    );
    const s = distPointToSegment(p, a, b);
    maxS = Math.max(maxS, s);
    if (t >= 0.25 && t <= 0.75) midS = Math.max(midS, s);
  }
  const sagitta = midS > 1e-4 ? midS : maxS;
  if (sagitta < 1e-4) {
    // Degenerate flat — treat as linear chord.
    return {
      points: [a, b],
      a,
      b,
      length: chord,
      linear: true,
    };
  }

  // Circle through chord with given sagitta: r = (s² + (c/2)²) / (2s)
  const half = 0.5 * chord;
  const r = (sagitta * sagitta + half * half) / (2 * sagitta);
  if (!(r > 1e-9) || !Number.isFinite(r)) return null;
  const cosHalf = Math.min(1, Math.max(-1, half / r));
  const angle = 2 * Math.acos(cosHalf); // radians, shorter arc (≤π)
  const length = r * angle;
  if (!(length > 0) || !Number.isFinite(length)) return null;

  // Build polyline on the circle for highlight (in plane of a,b,sagitta dir).
  const midChord: Vec3 = [
    0.5 * (a[0] + b[0]),
    0.5 * (a[1] + b[1]),
    0.5 * (a[2] + b[2]),
  ];
  // Sagitta direction: from mid-chord toward the side where samples lie.
  let sx = 0;
  let sy = 0;
  let sz = 0;
  let sn = 0;
  for (const p of points) {
    const d = distPointToSegment(p, a, b);
    if (d < 1e-6) continue;
    // Foot on segment:
    const ab: Vec3 = [b[0] - a[0], b[1] - a[1], b[2] - a[2]];
    const ap: Vec3 = [p[0] - a[0], p[1] - a[1], p[2] - a[2]];
    const t = Math.min(
      1,
      Math.max(0, (ap[0] * ab[0] + ap[1] * ab[1] + ap[2] * ab[2]) / (chord * chord)),
    );
    const foot: Vec3 = [
      a[0] + t * ab[0],
      a[1] + t * ab[1],
      a[2] + t * ab[2],
    ];
    sx += p[0] - foot[0];
    sy += p[1] - foot[1];
    sz += p[2] - foot[2];
    sn++;
  }
  let dir: Vec3;
  if (sn > 0 && Math.hypot(sx, sy, sz) > 1e-9) {
    const inv = 1 / Math.hypot(sx, sy, sz);
    dir = [sx * inv, sy * inv, sz * inv];
  } else {
    // Fall back: plane normal × chord
    const abn: Vec3 = [
      (b[0] - a[0]) / chord,
      (b[1] - a[1]) / chord,
      (b[2] - a[2]) / chord,
    ];
    const cr = cross(plane.normal, abn);
    const cl = Math.hypot(cr[0], cr[1], cr[2]);
    dir = cl > 1e-12 ? [cr[0] / cl, cr[1] / cl, cr[2] / cl] : plane.u;
  }
  // Apex of arc (point at sagitta from mid-chord).
  const apex: Vec3 = [
    midChord[0] + dir[0] * sagitta,
    midChord[1] + dir[1] * sagitta,
    midChord[2] + dir[2] * sagitta,
  ];
  const apexP =
    projectToSurface(field, apex[0], apex[1], apex[2], { tol: 1e-7 }) ?? apex;

  // Circle center sits (r - sagitta) back from apex toward mid-chord.
  const center: Vec3 = [
    apexP[0] - dir[0] * r,
    apexP[1] - dir[1] * r,
    apexP[2] - dir[2] * r,
  ];
  // Orthonormal basis in arc plane.
  const ea: Vec3 = [
    a[0] - center[0],
    a[1] - center[1],
    a[2] - center[2],
  ];
  const la = Math.hypot(ea[0], ea[1], ea[2]) || r;
  const ua: Vec3 = [ea[0] / la, ea[1] / la, ea[2] / la];
  // eb projected orthogonal to ua for angle sweep toward b.
  const eb: Vec3 = [
    b[0] - center[0],
    b[1] - center[1],
    b[2] - center[2],
  ];
  // Third axis
  let hx = ua[1] * plane.normal[2] - ua[2] * plane.normal[1];
  let hy = ua[2] * plane.normal[0] - ua[0] * plane.normal[2];
  let hz = ua[0] * plane.normal[1] - ua[1] * plane.normal[0];
  let hl = Math.hypot(hx, hy, hz);
  if (hl < 1e-12) {
    const [pu] = planeBasis(ua);
    hx = pu[0];
    hy = pu[1];
    hz = pu[2];
    hl = 1;
  } else {
    hx /= hl;
    hy /= hl;
    hz /= hl;
  }
  // Sign of sweep: b should have positive component on h if angle is correct.
  const bOnH = eb[0] * hx + eb[1] * hy + eb[2] * hz;
  if (bOnH < 0) {
    hx = -hx;
    hy = -hy;
    hz = -hz;
  }
  const nSamp = Math.max(8, Math.ceil(length / 1.0));
  const poly: Vec3[] = [];
  for (let i = 0; i <= nSamp; i++) {
    const t = i / nSamp;
    const ang = t * angle;
    const q: Vec3 = [
      center[0] + r * (Math.cos(ang) * ua[0] + Math.sin(ang) * hx),
      center[1] + r * (Math.cos(ang) * ua[1] + Math.sin(ang) * hy),
      center[2] + r * (Math.cos(ang) * ua[2] + Math.sin(ang) * hz),
    ];
    const pq =
      projectToSurface(field, q[0], q[1], q[2], { tol: 1e-7 }) ?? q;
    poly.push(pq);
  }
  // Prefer analytical length (stable); endpoints from poly ends.
  return {
    points: poly,
    a: poly[0]!,
    b: poly[poly.length - 1]!,
    length,
    linear: false,
  };
}

function densifySurfacePolyline(
  field: FieldSolid,
  pts: Vec3[],
  stepMm: number,
): Vec3[] {
  const out: Vec3[] = [];
  for (let i = 0; i < pts.length; i++) {
    const p = pts[i]!;
    if (
      out.length === 0 ||
      Math.hypot(
        p[0] - out[out.length - 1]![0],
        p[1] - out[out.length - 1]![1],
        p[2] - out[out.length - 1]![2],
      ) > 1e-4
    ) {
      out.push(p);
    }
    if (i + 1 >= pts.length) continue;
    const p1 = pts[i + 1]!;
    const seg = Math.hypot(p1[0] - p[0], p1[1] - p[1], p1[2] - p[2]);
    const nMid = Math.max(0, Math.ceil(seg / stepMm) - 1);
    for (let k = 1; k <= nMid; k++) {
      const t = k / (nMid + 1);
      const raw: Vec3 = [
        p[0] + t * (p1[0] - p[0]),
        p[1] + t * (p1[1] - p[1]),
        p[2] + t * (p1[2] - p[2]),
      ];
      const q = projectToSurface(field, raw[0], raw[1], raw[2], { tol: 1e-7 });
      if (!q) continue;
      if (
        Math.hypot(
          q[0] - out[out.length - 1]![0],
          q[1] - out[out.length - 1]![1],
          q[2] - out[out.length - 1]![2],
        ) > 1e-4
      ) {
        out.push(q);
      }
    }
  }
  return out;
}

function fitPlane(points: Vec3[]): {
  origin: Vec3;
  normal: Vec3;
  u: Vec3;
  v: Vec3;
  maxResidual: number;
} | null {
  if (points.length < 3) return null;
  let cx = 0;
  let cy = 0;
  let cz = 0;
  for (const p of points) {
    cx += p[0];
    cy += p[1];
    cz += p[2];
  }
  const n = points.length;
  cx /= n;
  cy /= n;
  cz /= n;
  // Covariance → smallest eigenvector ≈ plane normal (power on inverse-ish:
  // use cross of two long in-plane spans as a robust normal estimate).
  let best = 0;
  let a = points[0]!;
  let b = points[1]!;
  for (let i = 0; i < points.length; i++) {
    for (let j = i + 1; j < points.length; j++) {
      const d = Math.hypot(
        points[j]![0] - points[i]![0],
        points[j]![1] - points[i]![1],
        points[j]![2] - points[i]![2],
      );
      if (d > best) {
        best = d;
        a = points[i]!;
        b = points[j]!;
      }
    }
  }
  const ab: Vec3 = [b[0] - a[0], b[1] - a[1], b[2] - a[2]];
  // Point farthest from line ab.
  let far = a;
  let farD = -1;
  for (const p of points) {
    const d = distPointToSegment(p, a, b);
    if (d > farD) {
      farD = d;
      far = p;
    }
  }
  if (farD < 1e-6) return null;
  const ac: Vec3 = [far[0] - a[0], far[1] - a[1], far[2] - a[2]];
  let nx = ab[1] * ac[2] - ab[2] * ac[1];
  let ny = ab[2] * ac[0] - ab[0] * ac[2];
  let nz = ab[0] * ac[1] - ab[1] * ac[0];
  let nlen = Math.hypot(nx, ny, nz);
  if (nlen < 1e-12) return null;
  nx /= nlen;
  ny /= nlen;
  nz /= nlen;
  // Refine normal by averaging open-segment cross products (do NOT wrap —
  // closing an open arc corrupts the normal and inflates residual).
  let sx = 0;
  let sy = 0;
  let sz = 0;
  for (let i = 0; i + 1 < points.length; i++) {
    const p0 = points[i]!;
    const p1 = points[i + 1]!;
    const e0: Vec3 = [p0[0] - cx, p0[1] - cy, p0[2] - cz];
    const e1: Vec3 = [p1[0] - cx, p1[1] - cy, p1[2] - cz];
    const cxn = e0[1] * e1[2] - e0[2] * e1[1];
    const cyn = e0[2] * e1[0] - e0[0] * e1[2];
    const czn = e0[0] * e1[1] - e0[1] * e1[0];
    if (cxn * nx + cyn * ny + czn * nz < 0) {
      sx -= cxn;
      sy -= cyn;
      sz -= czn;
    } else {
      sx += cxn;
      sy += cyn;
      sz += czn;
    }
  }
  nlen = Math.hypot(sx, sy, sz);
  if (nlen > 1e-12) {
    nx = sx / nlen;
    ny = sy / nlen;
    nz = sz / nlen;
  }
  // Prefer near-axis plane normals when samples hug a coordinate face
  // (sphere∩cube arcs). More stable than a zigzag triangle fan.
  {
    let maxDx = 0;
    let maxDy = 0;
    let maxDz = 0;
    for (const p of points) {
      maxDx = Math.max(maxDx, Math.abs(p[0] - cx));
      maxDy = Math.max(maxDy, Math.abs(p[1] - cy));
      maxDz = Math.max(maxDz, Math.abs(p[2] - cz));
    }
    const m = Math.min(maxDx, maxDy, maxDz);
    if (m <= 2.0) {
      if (maxDx === m) {
        nx = nx >= 0 ? 1 : -1;
        ny = 0;
        nz = 0;
      } else if (maxDy === m) {
        nx = 0;
        ny = ny >= 0 ? 1 : -1;
        nz = 0;
      } else {
        nx = 0;
        ny = 0;
        nz = nz >= 0 ? 1 : -1;
      }
    }
  }

  const normal: Vec3 = [nx, ny, nz];
  const [u, v] = planeBasis(normal);
  let maxResidual = 0;
  for (const p of points) {
    const d = Math.abs(
      (p[0] - cx) * nx + (p[1] - cy) * ny + (p[2] - cz) * nz,
    );
    maxResidual = Math.max(maxResidual, d);
  }
  return {
    origin: [cx, cy, cz],
    normal,
    u,
    v,
    maxResidual,
  };
}

function distPointToSegment(p: Vec3, a: Vec3, b: Vec3): number {
  const ab: Vec3 = [b[0] - a[0], b[1] - a[1], b[2] - a[2]];
  const ap: Vec3 = [p[0] - a[0], p[1] - a[1], p[2] - a[2]];
  const ab2 = ab[0] * ab[0] + ab[1] * ab[1] + ab[2] * ab[2];
  if (ab2 < 1e-20) return Math.hypot(ap[0], ap[1], ap[2]);
  let t = (ap[0] * ab[0] + ap[1] * ab[1] + ap[2] * ab[2]) / ab2;
  t = Math.min(1, Math.max(0, t));
  return Math.hypot(
    p[0] - (a[0] + t * ab[0]),
    p[1] - (a[1] + t * ab[1]),
    p[2] - (a[2] + t * ab[2]),
  );
}

/**
 * Project near a mesh seed onto the isosurface, then slide in the tangent
 * plane onto a nearby sharp crease (field-only — no op-tree).
 */
export function projectToCrease(
  field: FieldSolid,
  x: number,
  y: number,
  z: number,
  opts?: { maxFromSeedMm?: number },
): Vec3 | null {
  const surface = projectToSurface(field, x, y, z, { tol: 1e-7 });
  if (!surface) return null;
  let p: Vec3 = surface;

  // Multi-scale disk search: pair-dihedral pulls from face toward crease;
  // edgeness peaks *on* the true edge (not 0.2 mm beside it).
  // Larger maxFromSeed helps edge-filter clicks near sphere∩cube arcs.
  const maxFromSeed = opts?.maxFromSeedMm ?? 3.5;
  const rings =
    maxFromSeed > 6
      ? [Math.min(8, maxFromSeed * 0.6), 4, 2, 1, 0.5]
      : [2.0, 1.2, 0.7, 0.35];
  for (const ring of rings) {
    const n0 = fieldNormal(field, p[0], p[1], p[2]);
    if (!n0) break;
    const [u, v] = planeBasis(n0);
    let best: Vec3 = p;
    let bestS = featureScore(field, p);
    const steps = 16;
    for (let i = 0; i < steps; i++) {
      const ang = (i * 2 * Math.PI) / steps;
      const c = Math.cos(ang);
      const s = Math.sin(ang);
      for (const r of [ring, ring * 0.5]) {
        const proj = projectToSurface(
          field,
          p[0] + r * (u[0] * c + v[0] * s),
          p[1] + r * (u[1] * c + v[1] * s),
          p[2] + r * (u[2] * c + v[2] * s),
          { tol: 1e-7 },
        );
        if (!proj) continue;
        if (Math.hypot(proj[0] - x, proj[1] - y, proj[2] - z) > maxFromSeed) {
          continue;
        }
        const sc = featureScore(field, proj);
        if (sc > bestS) {
          bestS = sc;
          best = proj;
        }
      }
    }
    p = best;
  }

  // Fine polish: maximize edgeness with shrinking steps (µm-class).
  for (let iter = 0; iter < 40; iter++) {
    const e0 = edgeness(field, p);
    const n = fieldNormal(field, p[0], p[1], p[2]);
    if (!n) break;
    const [uu, vv] = planeBasis(n);
    let best = p;
    let bestE = e0;
    for (const step of [0.25, 0.08, 0.02, 0.005, 0.001, 0.0002]) {
      for (const [du, dv] of [
        [1, 0],
        [-1, 0],
        [0, 1],
        [0, -1],
        [0.7, 0.7],
        [-0.7, 0.7],
        [0.7, -0.7],
        [-0.7, -0.7],
      ] as const) {
        const proj = projectToSurface(
          field,
          p[0] + step * (uu[0] * du + vv[0] * dv),
          p[1] + step * (uu[1] * du + vv[1] * dv),
          p[2] + step * (uu[2] * du + vv[2] * dv),
          { tol: 1e-8 },
        );
        if (!proj) continue;
        if (Math.hypot(proj[0] - x, proj[1] - y, proj[2] - z) > maxFromSeed) {
          continue;
        }
        const e = edgeness(field, proj);
        if (e > bestE + 1e-12) {
          bestE = e;
          best = proj;
        }
      }
    }
    if (bestE <= e0 + 1e-12) break;
    p = best;
  }

  if (featureScore(field, p) < FEATURE_MIN && edgeness(field, p) < EDGENESS_MIN) {
    return null;
  }
  return p;
}

/**
 * Extend a linear crease along ±unit without re-snapping laterally.
 *
 * Origin must already lie on the crease. Walk the ray with unprojected
 * samples: stay while f≈0 **and** edgeness stays high. Face-interior
 * parallels fail edgeness; true edges continue to the vertex.
 * Endpoint refined by binary search to ~1e-9 mm along the ray.
 */
function extendLinearCrease(
  field: FieldSolid,
  origin: Vec3,
  unit: Vec3,
  sign: 1 | -1,
  maxDist: number,
): Vec3 {
  const surfaceTol = 1e-7;
  // Corners have edgeness ≈ 1/3; faces ≈ 0. Keep a margin below edge (0.5).
  const minE = Math.min(EDGENESS_MIN, 0.28);

  const at = (d: number): Vec3 => [
    origin[0] + unit[0] * sign * d,
    origin[1] + unit[1] * sign * d,
    origin[2] + unit[2] * sign * d,
  ];

  const onCrease = (p: Vec3): boolean => {
    if (Math.abs(field.evaluate(p[0], p[1], p[2])) > surfaceTol) return false;
    // Accept sharp edges and vertices; reject smooth face samples.
    const e = edgeness(field, p);
    if (e >= minE) return true;
    // Sphere∩cube-style creases may have lower edgeness but high dihedral.
    return pairDihedral(field, p, 0.3) >= 0.35;
  };

  if (!onCrease(origin)) {
    // Nudge origin onto crease if FD noise rejected it.
    const fixed = projectToCrease(field, origin[0], origin[1], origin[2]);
    if (!fixed || !onCrease(fixed)) return origin;
    return extendLinearCrease(field, fixed, unit, sign, maxDist);
  }

  let lo = 0;
  let hi = Math.min(0.5, maxDist);
  while (hi < maxDist && onCrease(at(hi))) {
    lo = hi;
    hi = Math.min(hi * 2, maxDist);
    if (hi === lo) break;
  }

  // Binary search boundary in (lo, hi).
  if (!onCrease(at(hi))) {
    for (let i = 0; i < 80; i++) {
      if (hi - lo <= 1e-10) break;
      const mid = 0.5 * (lo + hi);
      if (onCrease(at(mid))) lo = mid;
      else hi = mid;
    }
  } else {
    lo = hi;
  }

  const p = at(lo);
  // Tiny project only to kill float noise — must not leave the ray.
  const q = projectToSurface(field, p[0], p[1], p[2], { tol: 1e-10 });
  if (
    q &&
    Math.hypot(q[0] - p[0], q[1] - p[1], q[2] - p[2]) <= 1e-4
  ) {
    return q;
  }
  return p;
}

function principalAxis(points: Vec3[]): {
  origin: Vec3;
  unit: Vec3;
  maxResidual: number;
  span: number;
} | null {
  if (points.length < 2) return null;
  let cx = 0;
  let cy = 0;
  let cz = 0;
  for (const p of points) {
    cx += p[0];
    cy += p[1];
    cz += p[2];
  }
  const n = points.length;
  cx /= n;
  cy /= n;
  cz /= n;
  // Covariance (symmetric).
  let xx = 0;
  let yy = 0;
  let zz = 0;
  let xy = 0;
  let xz = 0;
  let yz = 0;
  for (const p of points) {
    const dx = p[0] - cx;
    const dy = p[1] - cy;
    const dz = p[2] - cz;
    xx += dx * dx;
    yy += dy * dy;
    zz += dz * dz;
    xy += dx * dy;
    xz += dx * dz;
    yz += dy * dz;
  }
  // Power iteration for dominant eigenvector.
  let ex = 1;
  let ey = 0;
  let ez = 0;
  // Seed with longest pair direction for faster/stabler converge.
  let best = 0;
  for (let i = 0; i < points.length; i++) {
    for (let j = i + 1; j < points.length; j++) {
      const dx = points[j]![0] - points[i]![0];
      const dy = points[j]![1] - points[i]![1];
      const dz = points[j]![2] - points[i]![2];
      const d = dx * dx + dy * dy + dz * dz;
      if (d > best) {
        best = d;
        ex = dx;
        ey = dy;
        ez = dz;
      }
    }
  }
  let len = Math.hypot(ex, ey, ez);
  if (len < 1e-12) return null;
  ex /= len;
  ey /= len;
  ez /= len;
  for (let iter = 0; iter < 24; iter++) {
    const nx = xx * ex + xy * ey + xz * ez;
    const ny = xy * ex + yy * ey + yz * ez;
    const nz = xz * ex + yz * ey + zz * ez;
    len = Math.hypot(nx, ny, nz);
    if (len < 1e-18) break;
    ex = nx / len;
    ey = ny / len;
    ez = nz / len;
  }
  const unit: Vec3 = [ex, ey, ez];
  const origin: Vec3 = [cx, cy, cz];

  let maxResidual = 0;
  let tMin = Infinity;
  let tMax = -Infinity;
  for (const p of points) {
    const dx = p[0] - cx;
    const dy = p[1] - cy;
    const dz = p[2] - cz;
    const t = dx * ex + dy * ey + dz * ez;
    tMin = Math.min(tMin, t);
    tMax = Math.max(tMax, t);
    const rx = dx - ex * t;
    const ry = dy - ey * t;
    const rz = dz - ez * t;
    maxResidual = Math.max(maxResidual, Math.hypot(rx, ry, rz));
  }
  return { origin, unit, maxResidual, span: tMax - tMin };
}

function directionFromEndpoints(points: Vec3[]): Vec3 | null {
  if (points.length < 2) return null;
  // Use PCA endpoints (min/max along principal) via longest pair.
  let best = 0;
  let a = points[0]!;
  let b = points[1]!;
  for (let i = 0; i < points.length; i++) {
    for (let j = i + 1; j < points.length; j++) {
      const d = Math.hypot(
        points[j]![0] - points[i]![0],
        points[j]![1] - points[i]![1],
        points[j]![2] - points[i]![2],
      );
      if (d > best) {
        best = d;
        a = points[i]!;
        b = points[j]!;
      }
    }
  }
  if (best < 1e-12) return null;
  const inv = 1 / best;
  return [
    (b[0] - a[0]) * inv,
    (b[1] - a[1]) * inv,
    (b[2] - a[2]) * inv,
  ];
}

