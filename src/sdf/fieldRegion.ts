/**
 * Surface regions ("faces") on a FieldSolid.
 *
 * Planar: classify + plane frame (highlight = single PlaneGeometry).
 * Freeform: connectivity grow + surface densify for disc paint.
 */

import {
  axisFaceBin,
  featureScore,
  FEATURE_MIN,
  planeBasis,
} from "./fieldFeatures";
import { planarFaceFrameFromField } from "./fieldMeasure";
import { projectToSurface } from "./fieldProject";
import { fieldNormal, leafAt } from "./leaf";
import type { FieldSolid, Vec3 } from "./types";

export interface SurfaceRegion {
  readonly seed: Vec3;
  readonly samples: readonly Vec3[];
  readonly meanNormal: Vec3;
  readonly planar: boolean;
  readonly leafId?: string;
  readonly regionKey: string;
  readonly centroid: Vec3;
  /** Set for planar faces — full face frame for plane-mesh highlight. */
  readonly planeFrame?: {
    readonly width: number;
    readonly height: number;
    readonly centroid: Vec3;
    readonly normal: Vec3;
    readonly rectangular: boolean;
  };
}

export interface GrowSurfaceRegionOpts {
  readonly stepMm?: number;
  readonly maxSamples?: number;
  readonly sharpFeatureMin?: number;
  readonly gridMm?: number;
}

export function nudgeOffCrease(
  field: FieldSolid,
  seed: Vec3,
  opts?: { sharpMin?: number; maxSteps?: number },
): Vec3 {
  const sharpMin = opts?.sharpMin ?? FEATURE_MIN;
  const maxSteps = opts?.maxSteps ?? 12;
  let p = seed;
  if (featureScore(field, p) < sharpMin) return p;

  const n0 = fieldNormal(field, p[0], p[1], p[2]);
  if (!n0) return p;
  const [u, v] = planeBasis(n0);

  let best = p;
  let bestScore = featureScore(field, p);
  for (let step = 0; step < maxSteps && bestScore >= sharpMin; step++) {
    const dist = 0.6 + step * 0.55;
    for (let i = 0; i < 8; i++) {
      const ang = (i * Math.PI) / 4;
      const c = Math.cos(ang);
      const s = Math.sin(ang);
      const raw: Vec3 = [
        p[0] + dist * (u[0] * c + v[0] * s),
        p[1] + dist * (u[1] * c + v[1] * s),
        p[2] + dist * (u[2] * c + v[2] * s),
      ];
      const q = projectToSurface(field, raw[0], raw[1], raw[2], {
        tol: 1e-5,
      });
      if (!q) continue;
      const sc = featureScore(field, q);
      if (sc < bestScore) {
        bestScore = sc;
        best = q;
      }
    }
    p = best;
    if (bestScore < sharpMin) break;
  }
  return best;
}

export function growSurfaceRegion(
  field: FieldSolid,
  seedIn: Vec3,
  opts: GrowSurfaceRegionOpts = {},
): SurfaceRegion | null {
  const sharpMin = opts.sharpFeatureMin ?? FEATURE_MIN;

  let seed = projectToSurface(field, seedIn[0], seedIn[1], seedIn[2], {
    tol: 1e-6,
  });
  if (!seed) return null;
  seed = nudgeOffCrease(field, seed, { sharpMin });

  const seedN = fieldNormal(field, seed[0], seed[1], seed[2]);
  if (!seedN) return null;
  const seedLeaf = leafAt(field, seed[0], seed[1], seed[2]);
  const planar = isPlanarSeed(field, seed, seedN);

  if (planar) {
    const frame = planarFaceFrameFromField(field, seed, {
      leafId: seedLeaf,
      normalHint: seedN,
    });
    const meanNormal = frame?.normal ?? seedN;
    const centroid = frame?.centroid ?? seed;
    return {
      seed,
      samples: [seed],
      meanNormal,
      planar: true,
      leafId: seedLeaf,
      regionKey: makeRegionKey(seedLeaf, meanNormal, true),
      centroid,
      planeFrame: frame
        ? {
            width: frame.width,
            height: frame.height,
            centroid: frame.centroid,
            normal: frame.normal,
            rectangular: frame.rectangular,
          }
        : undefined,
    };
  }

  // Freeform grow
  const step = opts.stepMm ?? 1.8;
  const maxSamples = opts.maxSamples ?? 1600;
  const grid = opts.gridMm ?? step;

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
    const dirs: (Vec3 | null)[] = [
      u,
      [-u[0], -u[1], -u[2]],
      v,
      [-v[0], -v[1], -v[2]],
      normalize3(u[0] + v[0], u[1] + v[1], u[2] + v[2]),
      normalize3(u[0] - v[0], u[1] - v[1], u[2] - v[2]),
    ];
    for (const d of dirs) {
      if (!d) continue;
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
      if (featureScore(field, q) >= sharpMin) {
        visited.add(key);
        continue;
      }
      if (seedLeaf) {
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
    nlen > 1e-12 ? [nx / nlen, ny / nlen, nz / nlen] : seedN;
  let cx = 0;
  let cy = 0;
  let cz = 0;
  for (const s of samples) {
    cx += s[0];
    cy += s[1];
    cz += s[2];
  }
  const inv = 1 / Math.max(1, samples.length);

  return {
    seed,
    samples,
    meanNormal,
    planar: false,
    leafId: seedLeaf,
    regionKey: makeRegionKey(seedLeaf, meanNormal, false),
    centroid: [cx * inv, cy * inv, cz * inv],
  };
}

function isPlanarSeed(
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

function makeRegionKey(
  leafId: string | undefined,
  n: Vec3,
  planar: boolean,
): string {
  const leaf = leafId ?? "body";
  if (planar) {
    return `${leaf}/${axisFaceBin(n) ?? "planar"}`;
  }
  return `${leaf}/curved`;
}

function quantize(p: Vec3, grid: number): string {
  const g = grid > 0 ? grid : 1;
  return `${Math.round(p[0] / g)},${Math.round(p[1] / g)},${Math.round(p[2] / g)}`;
}

function normalize3(x: number, y: number, z: number): Vec3 | null {
  const len = Math.hypot(x, y, z);
  if (len < 1e-12) return null;
  return [x / len, y / len, z / len];
}

/**
 * Freeform disc paint only (planar uses BoxGeometry via planeFrame).
 *
 * Samples the **entire leaf surface** via Fibonacci sphere rays from the
 * solid bounds center (not just the grow patch) so spheres fill completely.
 */
export function densifyRegionForHighlight(
  field: FieldSolid,
  region: SurfaceRegion,
  opts?: { maxPoints?: number },
): { positions: Float32Array; normals: Float32Array } {
  if (region.planar) {
    return { positions: new Float32Array(0), normals: new Float32Array(0) };
  }
  return densifyFreeformLeaf(field, region, opts?.maxPoints ?? 5000);
}

/**
 * Cover freeform leaf by casting Fibonacci directions from bounds center
 * toward the solid and snapping each hit to the surface.
 */
function densifyFreeformLeaf(
  field: FieldSolid,
  region: SurfaceRegion,
  maxPoints: number,
): { positions: Float32Array; normals: Float32Array } {
  const seedLeaf = region.leafId;
  const b = field.bounds;
  const cx = 0.5 * (b.min[0] + b.max[0]);
  const cy = 0.5 * (b.min[1] + b.max[1]);
  const cz = 0.5 * (b.min[2] + b.max[2]);
  const rx = b.max[0] - b.min[0];
  const ry = b.max[1] - b.min[1];
  const rz = b.max[2] - b.min[2];
  // Start rays outside the AABB.
  const R = 0.5 * Math.hypot(rx, ry, rz) + 2;

  const positions: number[] = [];
  const normals: number[] = [];
  const visited = new Set<string>();
  const cell = 1.6;
  const nDir = Math.min(maxPoints, 5500);
  const golden = Math.PI * (3 - Math.sqrt(5));

  for (let i = 0; i < nDir && positions.length / 3 < maxPoints; i++) {
    // Fibonacci sphere direction
    const y = 1 - (i / Math.max(1, nDir - 1)) * 2;
    const radius = Math.sqrt(Math.max(0, 1 - y * y));
    const theta = golden * i;
    const dx = Math.cos(theta) * radius;
    const dy = y;
    const dz = Math.sin(theta) * radius;

    // March from outside toward center
    let t = R;
    let hit: Vec3 | null = null;
    for (let step = 0; step < 64; step++) {
      const px = cx + dx * t;
      const py = cy + dy * t;
      const pz = cz + dz * t;
      const d = field.evaluate(px, py, pz);
      if (Math.abs(d) < 0.15) {
        hit = projectToSurface(field, px, py, pz, { tol: 1e-4 }) ?? [
          px,
          py,
          pz,
        ];
        break;
      }
      if (d < 0) {
        // Inside: step back to surface
        hit = projectToSurface(field, px, py, pz, { tol: 1e-4 });
        break;
      }
      t -= Math.max(d * 0.85, 0.2);
      if (t < 0) break;
    }
    if (!hit) continue;
    if (seedLeaf) {
      const leaf = leafAt(field, hit[0], hit[1], hit[2]);
      if (leaf && leaf !== seedLeaf) continue;
    }
    // Skip hard creases (cube edges) — freeform leaf interior only.
    if (featureScore(field, hit) >= FEATURE_MIN) continue;
    const key = quantize(hit, cell);
    if (visited.has(key)) continue;
    const nn = fieldNormal(field, hit[0], hit[1], hit[2]);
    if (!nn) continue;
    visited.add(key);
    positions.push(hit[0], hit[1], hit[2]);
    normals.push(nn[0], nn[1], nn[2]);
  }

  // Fallback: grow samples if ray fan found little (odd freeform).
  if (positions.length / 3 < 20) {
    for (const s of region.samples) {
      if (positions.length / 3 >= maxPoints) break;
      const key = quantize(s, cell);
      if (visited.has(key)) continue;
      const nn = fieldNormal(field, s[0], s[1], s[2]);
      if (!nn) continue;
      visited.add(key);
      positions.push(s[0], s[1], s[2]);
      normals.push(nn[0], nn[1], nn[2]);
    }
  }

  if (positions.length < 3) {
    return { positions: new Float32Array(0), normals: new Float32Array(0) };
  }
  return {
    positions: new Float32Array(positions),
    normals: new Float32Array(normals),
  };
}
