/**
 * Surface regions ("faces") on a FieldSolid via flood-fill to creases.
 *
 * Planar plateaus are the degenerate case of a smooth region (stable normal).
 * Freeform patches grow by connectivity until a sharp feature.
 * Blends: piece-1 stops only on sharp creases; high-κ blend bands come later.
 */

import {
  axisFaceBin,
  featureScore,
  FEATURE_MIN,
  planeBasis,
} from "./fieldFeatures";
import { projectToSurface } from "./fieldProject";
import { fieldNormal, leafAt } from "./leaf";
import type { FieldSolid, Vec3 } from "./types";

export interface SurfaceRegion {
  readonly seed: Vec3;
  /** Sparse samples covering the region (for highlight / diagnostics). */
  readonly samples: readonly Vec3[];
  readonly meanNormal: Vec3;
  /** True when the seed neighborhood is planar (degenerate smooth region). */
  readonly planar: boolean;
  readonly leafId?: string;
  /**
   * Stable local key for ids, e.g. `demo-cube/+x` or `demo-sphere/curved`.
   */
  readonly regionKey: string;
  readonly centroid: Vec3;
}

export interface GrowSurfaceRegionOpts {
  /** Tangent step for neighbor walk (mm). Default 1.0. */
  readonly stepMm?: number;
  /** Safety cap on accepted samples. Default 400. */
  readonly maxSamples?: number;
  /** Sharp-feature threshold (featureScore). Default FEATURE_MIN. */
  readonly sharpFeatureMin?: number;
  /** Max normal angle from seed for planar grow (degrees). Default 18. */
  readonly planarAngleDeg?: number;
  /** Quantization for visited set (mm). Default stepMm. */
  readonly gridMm?: number;
}

/**
 * Grow a surface region from a seed already near f=0.
 * Returns null if seed cannot be projected to the surface.
 */
export function growSurfaceRegion(
  field: FieldSolid,
  seedIn: Vec3,
  opts: GrowSurfaceRegionOpts = {},
): SurfaceRegion | null {
  const step = opts.stepMm ?? 1.0;
  const maxSamples = opts.maxSamples ?? 400;
  const sharpMin = opts.sharpFeatureMin ?? FEATURE_MIN;
  const planarCos = Math.cos(
    ((opts.planarAngleDeg ?? 18) * Math.PI) / 180,
  );
  const grid = opts.gridMm ?? step;

  const seed = projectToSurface(field, seedIn[0], seedIn[1], seedIn[2], {
    tol: 1e-6,
  });
  if (!seed) return null;

  // Don't grow from a crease seed — snap is for edges (later).
  if (featureScore(field, seed) >= sharpMin) {
    // Still return a tiny region so face filter near an edge can soft-fail
    // to solid or edge later; classification uses local normal.
    const n = fieldNormal(field, seed[0], seed[1], seed[2]);
    if (!n) return null;
    const leafId = leafAt(field, seed[0], seed[1], seed[2]);
    const planar = axisFaceBin(n) !== null;
    const regionKey = makeRegionKey(leafId, n, planar);
    return {
      seed,
      samples: [seed],
      meanNormal: n,
      planar,
      leafId,
      regionKey,
      centroid: seed,
    };
  }

  const seedN = fieldNormal(field, seed[0], seed[1], seed[2]);
  if (!seedN) return null;
  const seedLeaf = leafAt(field, seed[0], seed[1], seed[2]);
  const planar = isPlanarSeed(field, seed, seedN, planarCos);

  const samples: Vec3[] = [];
  const visited = new Set<string>();
  const queue: Vec3[] = [seed];
  visited.add(quantize(seed, grid));

  let nx = 0;
  let ny = 0;
  let nz = 0;

  while (queue.length > 0 && samples.length < maxSamples) {
    const p = queue.shift()!;
    samples.push(p);
    const n = fieldNormal(field, p[0], p[1], p[2]);
    if (n) {
      nx += n[0];
      ny += n[1];
      nz += n[2];
    }

    const basisN = n ?? seedN;
    const [u, v] = planeBasis(basisN);
    const dirs: Vec3[] = [
      u,
      [-u[0], -u[1], -u[2]],
      v,
      [-v[0], -v[1], -v[2]],
    ];
    for (const extra of [
      normalize3(u[0] + v[0], u[1] + v[1], u[2] + v[2]),
      normalize3(u[0] - v[0], u[1] - v[1], u[2] - v[2]),
      normalize3(-u[0] + v[0], -u[1] + v[1], -u[2] + v[2]),
      normalize3(-u[0] - v[0], -u[1] - v[1], -u[2] - v[2]),
    ]) {
      if (extra) dirs.push(extra);
    }

    for (const d of dirs) {
      const raw: Vec3 = [
        p[0] + d[0] * step,
        p[1] + d[1] * step,
        p[2] + d[2] * step,
      ];
      const q = projectToSurface(field, raw[0], raw[1], raw[2], {
        tol: 1e-5,
      });
      if (!q) continue;
      const key = quantize(q, grid);
      if (visited.has(key)) continue;

      // Sharp crease boundary.
      if (featureScore(field, q) >= sharpMin) {
        visited.add(key); // mark so we don't re-test forever
        continue;
      }

      const qn = fieldNormal(field, q[0], q[1], q[2]);
      if (!qn) continue;

      // Planar plateau: stay normal-coherent with seed.
      if (planar) {
        const dot =
          qn[0] * seedN[0] + qn[1] * seedN[1] + qn[2] * seedN[2];
        if (dot < planarCos) {
          visited.add(key);
          continue;
        }
      }

      // Hard CSG leaf change on planar plateaus (cube face stops at sphere cut).
      if (planar && seedLeaf) {
        const qLeaf = leafAt(field, q[0], q[1], q[2]);
        if (qLeaf && qLeaf !== seedLeaf) {
          visited.add(key);
          continue;
        }
      }

      visited.add(key);
      queue.push(q);
    }
  }

  const nlen = Math.hypot(nx, ny, nz);
  const meanNormal: Vec3 =
    nlen > 1e-12
      ? [nx / nlen, ny / nlen, nz / nlen]
      : seedN;

  let cx = 0;
  let cy = 0;
  let cz = 0;
  for (const s of samples) {
    cx += s[0];
    cy += s[1];
    cz += s[2];
  }
  const inv = 1 / samples.length;
  const centroid: Vec3 = [cx * inv, cy * inv, cz * inv];

  const regionKey = makeRegionKey(seedLeaf, meanNormal, planar);

  return {
    seed,
    samples,
    meanNormal,
    planar,
    leafId: seedLeaf,
    regionKey,
    centroid,
  };
}

function isPlanarSeed(
  field: FieldSolid,
  seed: Vec3,
  seedN: Vec3,
  _planarCos: number,
): boolean {
  // Mean normal alignment over a several-mm ring. Small rings look planar on
  // large spheres (r≥50); require nearly constant n (meanDot ≳ 0.998).
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
    // Skip if we walked onto a crease (cube edge) — not evidence of curvature.
    if (featureScore(field, proj) >= FEATURE_MIN) continue;
    const n = fieldNormal(field, proj[0], proj[1], proj[2]);
    if (!n) continue;
    total++;
    sumDot += n[0] * seedN[0] + n[1] * seedN[1] + n[2] * seedN[2];
  }
  if (total < 4) return false;
  const meanDot = sumDot / total;
  return meanDot >= 0.998;
}

function makeRegionKey(
  leafId: string | undefined,
  n: Vec3,
  planar: boolean,
): string {
  const leaf = leafId ?? "body";
  if (planar) {
    const bin = axisFaceBin(n) ?? "planar";
    return `${leaf}/${bin}`;
  }
  return `${leaf}/curved`;
}

function quantize(p: Vec3, grid: number): string {
  const g = grid > 0 ? grid : 1;
  const ix = Math.round(p[0] / g);
  const iy = Math.round(p[1] / g);
  const iz = Math.round(p[2] / g);
  return `${ix},${iy},${iz}`;
}

function normalize3(
  x: number,
  y: number,
  z: number,
): Vec3 | null {
  const len = Math.hypot(x, y, z);
  if (len < 1e-12) return null;
  return [x / len, y / len, z / len];
}

/**
 * Densify a grown region for highlight: planar → UV grid membership;
 * freeform → original samples (already surface points).
 * Returns interleaved xyz positions + normals.
 */
export function densifyRegionForHighlight(
  field: FieldSolid,
  region: SurfaceRegion,
  opts?: { cellMm?: number; maxPoints?: number },
): { positions: Float32Array; normals: Float32Array } {
  const cell = opts?.cellMm ?? 0.85;
  const maxPoints = opts?.maxPoints ?? 2500;

  if (!region.planar || region.samples.length < 3) {
    return packSamplesWithNormals(field, region.samples, maxPoints);
  }

  const n = region.meanNormal;
  const [u, v] = planeBasis(n);
  const o = region.centroid;
  let uMin = Infinity;
  let uMax = -Infinity;
  let vMin = Infinity;
  let vMax = -Infinity;
  for (const s of region.samples) {
    const dx = s[0] - o[0];
    const dy = s[1] - o[1];
    const dz = s[2] - o[2];
    const su = dx * u[0] + dy * u[1] + dz * u[2];
    const sv = dx * v[0] + dy * v[1] + dz * v[2];
    uMin = Math.min(uMin, su);
    uMax = Math.max(uMax, su);
    vMin = Math.min(vMin, sv);
    vMax = Math.max(vMax, sv);
  }
  // Slight pad so discs cover to the crease without spilling much.
  const pad = cell * 0.5;
  uMin -= pad;
  uMax += pad;
  vMin -= pad;
  vMax += pad;

  const positions: number[] = [];
  const normals: number[] = [];
  const seedLeaf = region.leafId;
  const seedN = region.meanNormal;
  const planarCos = Math.cos((18 * Math.PI) / 180);

  for (let su = uMin; su <= uMax + 1e-9; su += cell) {
    for (let sv = vMin; sv <= vMax + 1e-9; sv += cell) {
      if (positions.length / 3 >= maxPoints) break;
      const raw: Vec3 = [
        o[0] + u[0] * su + v[0] * sv,
        o[1] + u[1] * su + v[1] * sv,
        o[2] + u[2] * su + v[2] * sv,
      ];
      // Nudge slightly outside then project so we land on the surface.
      const nudged: Vec3 = [
        raw[0] + n[0] * 0.5,
        raw[1] + n[1] * 0.5,
        raw[2] + n[2] * 0.5,
      ];
      const q = projectToSurface(field, nudged[0], nudged[1], nudged[2], {
        tol: 1e-5,
      });
      if (!q) continue;
      if (featureScore(field, q) >= FEATURE_MIN) continue;
      const qn = fieldNormal(field, q[0], q[1], q[2]);
      if (!qn) continue;
      const dot =
        qn[0] * seedN[0] + qn[1] * seedN[1] + qn[2] * seedN[2];
      if (dot < planarCos) continue;
      if (seedLeaf) {
        const qLeaf = leafAt(field, q[0], q[1], q[2]);
        if (qLeaf && qLeaf !== seedLeaf) continue;
      }
      positions.push(q[0], q[1], q[2]);
      normals.push(qn[0], qn[1], qn[2]);
    }
  }

  if (positions.length < 9) {
    return packSamplesWithNormals(field, region.samples, maxPoints);
  }
  return {
    positions: new Float32Array(positions),
    normals: new Float32Array(normals),
  };
}

function packSamplesWithNormals(
  field: FieldSolid,
  samples: readonly Vec3[],
  maxPoints: number,
): { positions: Float32Array; normals: Float32Array } {
  const n = Math.min(samples.length, maxPoints);
  const positions = new Float32Array(n * 3);
  const normals = new Float32Array(n * 3);
  for (let i = 0; i < n; i++) {
    const s = samples[i]!;
    positions[i * 3] = s[0];
    positions[i * 3 + 1] = s[1];
    positions[i * 3 + 2] = s[2];
    const nn = fieldNormal(field, s[0], s[1], s[2]);
    if (nn) {
      normals[i * 3] = nn[0];
      normals[i * 3 + 1] = nn[1];
      normals[i * 3 + 2] = nn[2];
    } else {
      normals[i * 3 + 2] = 1;
    }
  }
  return { positions, normals };
}
