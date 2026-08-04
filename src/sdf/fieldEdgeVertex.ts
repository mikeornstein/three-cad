/**
 * Field-native edge / vertex pick (mesh-free).
 * Cube edges + curved CSG creases (sphere∩cube).
 */

import { featureScore, planeBasis } from "./fieldFeatures";
import {
  measureEdgeOnField,
  projectToCrease,
  type EdgeMeasure,
} from "./fieldMeasure";
import { fieldNormal } from "./leaf";
import { projectToSurface } from "./fieldProject";
import type { FieldSolid, Vec3 } from "./types";

export interface FieldVertexHit {
  readonly kind: "vertex";
  readonly position: Vec3;
  readonly score: number;
}

export interface FieldEdgeHit {
  readonly kind: "edge";
  readonly measure: EdgeMeasure;
  readonly a: Vec3;
  readonly b: Vec3;
}

/** Minimum feature score to stay on a crease while walking. */
const ON_CREASE = 0.2;

/**
 * Lateral snap radius for walk steps.
 * Must stay small: large projectToCrease radii collapse every step back onto
 * a local featureScore peak (mid-arc) and the walk never advances.
 */
const WALK_SNAP_MM = 0.6;

/**
 * Split polyline when consecutive segments turn more than this (radians).
 * Sphere∩cube T-junctions often show ~45° steps (corner-cutting); cube
 * corners are ~90°. Stay below 45° so multi-arc walks split cleanly.
 */
const SPLIT_TURN_RAD = (40 * Math.PI) / 180;

/** Soft forward preference while walking (still allows circle curvature). */
const MIN_FORWARD_DOT = 0.25;

export function classifyCreaseFeature(
  field: FieldSolid,
  hit: Vec3,
): FieldVertexHit | FieldEdgeHit | null {
  let surface = projectToSurface(field, hit[0], hit[1], hit[2], {
    tol: 1e-6,
  });
  if (!surface) return null;

  // Prefer the *nearest* crease within a moderate radius. Maximizing
  // featureScore (projectToCrease) can jump from a sphere∩cube arc onto a
  // higher-score cube edge several mm away.
  const nearest = snapToNearestCrease(field, surface, 8);
  if (nearest) surface = nearest;

  const score = featureScore(field, surface);
  if (score < 0.12) return null;

  // True orthant vertex: three large equal normal components (cube corner).
  // Do NOT use a low |nx·ny·nz| threshold — sphere∩cube arc samples often
  // have noisy three-component FD normals with product ~0.1.
  const n = fieldNormal(field, surface[0], surface[1], surface[2]);
  if (n) {
    const an = [Math.abs(n[0]), Math.abs(n[1]), Math.abs(n[2])];
    const product = an[0]! * an[1]! * an[2]!;
    if (product > 0.14 && score > 0.5) {
      return { kind: "vertex", position: surface, score };
    }
  }

  const rawPoly = walkCreaseBothWays(field, surface);
  // Walk may chain multiple creases through cube corners / T-junctions.
  // Keep only the segment containing the seed, then drop low-score tips
  // (walk can overshoot a T-junction by a step or two).
  const poly = trimLowScoreEnds(
    segmentThroughSeed(rawPoly, surface),
    field,
  );
  if (poly.length < 2) return null;

  // Authoritative length/polyline when seeds are clean single-crease.
  const measured = measureEdgeOnField(
    field,
    poly.map((p) => ({ x: p[0], y: p[1], z: p[2] })),
  );
  if (measured && measured.length >= 0.5) {
    // Guard: measureEdgeOnField treats short circular chords as linear
    // (sagitta < linearTol). Prefer the walk length when it is clearly
    // longer and curved.
    const walkLen = polylineLength(poly);
    const walkRes = chordResidual(poly);
    if (
      !measured.linear ||
      walkRes <= 2.5 ||
      measured.length >= walkLen * 0.85
    ) {
      return {
        kind: "edge",
        a: measured.a,
        b: measured.b,
        measure: measured,
      };
    }
    // Short false-linear measure on a longer curved walk — keep walk.
    if (walkLen >= 0.5 && walkRes > 2.5) {
      return {
        kind: "edge",
        a: poly[0]!,
        b: poly[poly.length - 1]!,
        measure: {
          points: poly,
          a: poly[0]!,
          b: poly[poly.length - 1]!,
          length: walkLen,
          linear: false,
        },
      };
    }
  }

  const length = polylineLength(poly);
  if (length < 0.5) return null;
  const a = poly[0]!;
  const b = poly[poly.length - 1]!;
  const maxRes = chordResidual(poly);
  return {
    kind: "edge",
    a,
    b,
    measure: {
      points: poly,
      a,
      b,
      length,
      linear: maxRes <= 2.5,
    },
  };
}

/** Drop leading/trailing samples that left the crease (score collapsed). */
/**
 * Find the closest high-score crease sample in a surface disk around seed.
 * Unlike projectToCrease, does not prefer distant higher-score ridges.
 */
function snapToNearestCrease(
  field: FieldSolid,
  seed: Vec3,
  maxFromSeedMm: number,
): Vec3 | null {
  const n0 = fieldNormal(field, seed[0], seed[1], seed[2]);
  if (!n0) return null;
  const [u, v] = planeBasis(n0);

  let best: Vec3 | null = null;
  let bestDist = Infinity;
  const rings = [0, 0.4, 0.9, 1.6, 2.8, 4.5, 6.5, maxFromSeedMm];
  const steps = 20;
  for (const ring of rings) {
    const count = ring < 1e-9 ? 1 : steps;
    for (let i = 0; i < count; i++) {
      const ang = (i * 2 * Math.PI) / steps;
      const c = Math.cos(ang);
      const s = Math.sin(ang);
      const raw: Vec3 = [
        seed[0] + ring * (u[0] * c + v[0] * s),
        seed[1] + ring * (u[1] * c + v[1] * s),
        seed[2] + ring * (u[2] * c + v[2] * s),
      ];
      const proj = projectToSurface(field, raw[0], raw[1], raw[2], {
        tol: 1e-6,
      });
      if (!proj) continue;
      const dist = Math.hypot(
        proj[0] - seed[0],
        proj[1] - seed[1],
        proj[2] - seed[2],
      );
      if (dist > maxFromSeedMm) continue;
      const sc = featureScore(field, proj);
      if (sc < ON_CREASE) continue;
      // Prefer closer samples; tiny score bias when distances are equal.
      const rank = dist - sc * 0.05;
      if (rank < bestDist) {
        bestDist = rank;
        best = proj;
      }
    }
  }
  if (!best) return null;
  // Local polish onto the ridge (small radius only).
  return (
    projectToCrease(field, best[0], best[1], best[2], {
      maxFromSeedMm: 1.2,
    }) ?? best
  );
}

function trimLowScoreEnds(poly: readonly Vec3[], field: FieldSolid): Vec3[] {
  if (poly.length < 2) return [...poly];
  let i0 = 0;
  let i1 = poly.length - 1;
  while (i0 < i1 && featureScore(field, poly[i0]!) < ON_CREASE) i0++;
  while (i1 > i0 && featureScore(field, poly[i1]!) < ON_CREASE) i1--;
  return poly.slice(i0, i1 + 1);
}

function polylineLength(poly: readonly Vec3[]): number {
  let length = 0;
  for (let i = 1; i < poly.length; i++) {
    const a = poly[i - 1]!;
    const b = poly[i]!;
    length += Math.hypot(b[0] - a[0], b[1] - a[1], b[2] - a[2]);
  }
  return length;
}

function chordResidual(poly: readonly Vec3[]): number {
  if (poly.length < 2) return 0;
  const a = poly[0]!;
  const b = poly[poly.length - 1]!;
  const ab: Vec3 = [b[0] - a[0], b[1] - a[1], b[2] - a[2]];
  const ab2 = ab[0] * ab[0] + ab[1] * ab[1] + ab[2] * ab[2] || 1;
  let maxRes = 0;
  for (const p of poly) {
    const t = Math.max(
      0,
      Math.min(
        1,
        ((p[0] - a[0]) * ab[0] +
          (p[1] - a[1]) * ab[1] +
          (p[2] - a[2]) * ab[2]) /
          ab2,
      ),
    );
    maxRes = Math.max(
      maxRes,
      Math.hypot(
        p[0] - (a[0] + t * ab[0]),
        p[1] - (a[1] + t * ab[1]),
        p[2] - (a[2] + t * ab[2]),
      ),
    );
  }
  return maxRes;
}

/**
 * Split a walked polyline at sharp corners and return the piece that
 * contains (or is nearest to) the seed. Prevents cube-edge walks from
 * chaining around the whole solid while still allowing full circular arcs.
 */
function segmentThroughSeed(poly: readonly Vec3[], seed: Vec3): Vec3[] {
  if (poly.length < 3) return [...poly];

  // Break indices: first point of a new segment after a sharp turn.
  const breaks: number[] = [0];
  for (let i = 1; i < poly.length - 1; i++) {
    const prev = poly[i - 1]!;
    const cur = poly[i]!;
    const next = poly[i + 1]!;
    const d0: Vec3 = [
      cur[0] - prev[0],
      cur[1] - prev[1],
      cur[2] - prev[2],
    ];
    const d1: Vec3 = [
      next[0] - cur[0],
      next[1] - cur[1],
      next[2] - cur[2],
    ];
    const l0 = Math.hypot(d0[0], d0[1], d0[2]);
    const l1 = Math.hypot(d1[0], d1[1], d1[2]);
    if (l0 < 1e-9 || l1 < 1e-9) continue;
    const dot =
      (d0[0] * d1[0] + d0[1] * d1[1] + d0[2] * d1[2]) / (l0 * l1);
    const turn = Math.acos(Math.min(1, Math.max(-1, dot)));
    if (turn > SPLIT_TURN_RAD) breaks.push(i);
  }
  breaks.push(poly.length - 1);

  // Segments are poly[breaks[k] .. breaks[k+1]] inclusive.
  let best: Vec3[] = [...poly];
  let bestDist = Infinity;
  for (let k = 0; k < breaks.length - 1; k++) {
    const i0 = breaks[k]!;
    const i1 = breaks[k + 1]!;
    if (i1 - i0 < 1) continue;
    const seg = poly.slice(i0, i1 + 1);
    let dMin = Infinity;
    for (const p of seg) {
      const d = Math.hypot(
        p[0] - seed[0],
        p[1] - seed[1],
        p[2] - seed[2],
      );
      dMin = Math.min(dMin, d);
    }
    // Prefer closer segment; tie-break on longer length.
    if (
      dMin < bestDist - 1e-6 ||
      (Math.abs(dMin - bestDist) <= 1e-6 &&
        polylineLength(seg) > polylineLength(best))
    ) {
      bestDist = dMin;
      best = seg;
    }
  }
  return best;
}

function walkCreaseBothWays(field: FieldSolid, seed: Vec3): Vec3[] {
  const start =
    projectToCrease(field, seed[0], seed[1], seed[2], {
      maxFromSeedMm: 4,
    }) ?? seed;
  if (featureScore(field, start) < ON_CREASE) return [start];

  const t0 = bestStep(field, start, null, 1.35);
  if (!t0) return [start];

  const fwd = walkDir(field, start, t0.dir, 1.35, 120);
  const back = walkDir(
    field,
    start,
    [-t0.dir[0], -t0.dir[1], -t0.dir[2]],
    1.35,
    120,
  );

  return [...back.reverse(), start, ...fwd];
}

function walkDir(
  field: FieldSolid,
  start: Vec3,
  dir0: Vec3,
  stepMm: number,
  maxSteps: number,
): Vec3[] {
  const out: Vec3[] = [];
  let p = start;
  let dir = dir0;
  for (let i = 0; i < maxSteps; i++) {
    const step = bestStep(field, p, dir, stepMm);
    if (!step) break;

    const moved = Math.hypot(
      step.p[0] - p[0],
      step.p[1] - p[1],
      step.p[2] - p[2],
    );
    if (moved < stepMm * 0.2) break;

    if (i > 6) {
      const d0 = Math.hypot(
        step.p[0] - start[0],
        step.p[1] - start[1],
        step.p[2] - start[2],
      );
      if (d0 < stepMm) break;
    }

    out.push(step.p);
    p = step.p;
    dir = step.dir;
  }
  return out;
}

/**
 * Advance one step along the crease.
 *
 * Do **not** call projectToCrease with a large radius: full crease-snap seeks
 * the global featureScore peak in the disk and collapses every candidate back
 * to the same mid-arc point. Surface-project first, then a tiny local snap.
 */
function bestStep(
  field: FieldSolid,
  p: Vec3,
  prefer: Vec3 | null,
  stepMm = 1.35,
): { p: Vec3; dir: Vec3 } | null {
  const n = fieldNormal(field, p[0], p[1], p[2]);
  if (!n) return null;
  const [u, v] = planeBasis(n);

  let bestP: Vec3 | null = null;
  let bestDir: Vec3 | null = null;
  let bestRank = -1e9;

  const nDir = prefer ? 32 : 24;
  for (let i = 0; i < nDir; i++) {
    const ang = (i * 2 * Math.PI) / nDir;
    const c = Math.cos(ang);
    const s = Math.sin(ang);
    const dir: Vec3 = [
      u[0] * c + v[0] * s,
      u[1] * c + v[1] * s,
      u[2] * c + v[2] * s,
    ];
    if (prefer) {
      const dot =
        dir[0] * prefer[0] + dir[1] * prefer[1] + dir[2] * prefer[2];
      if (dot < MIN_FORWARD_DOT) continue;
    }
    const raw: Vec3 = [
      p[0] + dir[0] * stepMm,
      p[1] + dir[1] * stepMm,
      p[2] + dir[2] * stepMm,
    ];
    const surf = projectToSurface(field, raw[0], raw[1], raw[2], {
      tol: 1e-5,
    });
    if (!surf) continue;
    const q =
      projectToCrease(field, surf[0], surf[1], surf[2], {
        maxFromSeedMm: WALK_SNAP_MM,
      }) ?? surf;
    const sc = featureScore(field, q);
    if (sc < ON_CREASE) continue;
    const move: Vec3 = [q[0] - p[0], q[1] - p[1], q[2] - p[2]];
    const mlen = Math.hypot(move[0], move[1], move[2]);
    if (mlen < stepMm * 0.25 || mlen > stepMm * 1.7) continue;
    const mdir: Vec3 = [move[0] / mlen, move[1] / mlen, move[2] / mlen];
    if (prefer) {
      const mdot =
        mdir[0] * prefer[0] + mdir[1] * prefer[1] + mdir[2] * prefer[2];
      if (mdot < MIN_FORWARD_DOT) continue;
    }
    let rank = sc + mlen * 0.02;
    if (prefer) {
      rank +=
        0.9 *
        (mdir[0] * prefer[0] + mdir[1] * prefer[1] + mdir[2] * prefer[2]);
    }
    if (rank > bestRank) {
      bestRank = rank;
      bestP = q;
      bestDir = mdir;
    }
  }
  if (!bestP || !bestDir) return null;
  return { p: bestP, dir: bestDir };
}
