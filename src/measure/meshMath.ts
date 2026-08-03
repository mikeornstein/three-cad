/**
 * Mesh geometry helpers for measure (world-space mm).
 */

import {
  BufferAttribute,
  Box3,
  Vector3,
  type Mesh,
} from "three";
import type { SolidTopology, TopologyEdge, TopologyFace } from "../selection/topology";

/** Planarity: max |point·n - d| / characteristic size. */
export const PLANAR_TOL_MM = 0.05;
/** Normals considered parallel if |n1·n2| >= this (≈ cos 2°). */
export const PARALLEL_DOT = 0.9994;
/** Edge treated as linear if max mid-deviation from chord ≤ this (mm). */
export const LINEAR_EDGE_TOL_MM = 0.15;

const _a = new Vector3();
const _b = new Vector3();
const _c = new Vector3();
const _ab = new Vector3();
const _ac = new Vector3();
const _cross = new Vector3();
const _tmp = new Vector3();

export interface TriangleSoup {
  /** Flat array: [x0,y0,z0, x1,y1,z1, x2,y2,z2, ...] per triangle */
  positions: Float32Array;
  triCount: number;
}

export function faceTriangleSoup(
  solid: SolidTopology,
  face: TopologyFace,
): TriangleSoup {
  const mesh = solid.mesh;
  const pos = mesh.geometry.getAttribute("position") as BufferAttribute;
  const index = mesh.geometry.getIndex();
  const world = mesh.matrixWorld;
  const n = face.triangleIndices.length;
  const positions = new Float32Array(n * 9);
  let w = 0;
  for (const t of face.triangleIndices) {
    for (let c = 0; c < 3; c++) {
      const vi = index ? index.getX(t * 3 + c) : t * 3 + c;
      _tmp.fromBufferAttribute(pos, vi).applyMatrix4(world);
      positions[w++] = _tmp.x;
      positions[w++] = _tmp.y;
      positions[w++] = _tmp.z;
    }
  }
  return { positions, triCount: n };
}

export function solidTriangleSoup(solid: SolidTopology): TriangleSoup {
  const mesh = solid.mesh;
  return meshToTriangleSoup(mesh);
}

export function meshToTriangleSoup(mesh: Mesh): TriangleSoup {
  const pos = mesh.geometry.getAttribute("position") as BufferAttribute;
  const index = mesh.geometry.getIndex();
  const world = mesh.matrixWorld;
  const triCount = index ? index.count / 3 : pos.count / 3;
  const positions = new Float32Array(triCount * 9);
  let w = 0;
  for (let t = 0; t < triCount; t++) {
    for (let c = 0; c < 3; c++) {
      const vi = index ? index.getX(t * 3 + c) : t * 3 + c;
      _tmp.fromBufferAttribute(pos, vi).applyMatrix4(world);
      positions[w++] = _tmp.x;
      positions[w++] = _tmp.y;
      positions[w++] = _tmp.z;
    }
  }
  return { positions, triCount };
}

export function triangleAreaSum(soup: TriangleSoup): number {
  let area = 0;
  const p = soup.positions;
  for (let t = 0; t < soup.triCount; t++) {
    const o = t * 9;
    _a.set(p[o]!, p[o + 1]!, p[o + 2]!);
    _b.set(p[o + 3]!, p[o + 4]!, p[o + 5]!);
    _c.set(p[o + 6]!, p[o + 7]!, p[o + 8]!);
    _ab.subVectors(_b, _a);
    _ac.subVectors(_c, _a);
    area += _cross.crossVectors(_ab, _ac).length() * 0.5;
  }
  return area;
}

export function soupAabb(soup: TriangleSoup): Box3 {
  const box = new Box3();
  const p = soup.positions;
  for (let i = 0; i < p.length; i += 3) {
    _tmp.set(p[i]!, p[i + 1]!, p[i + 2]!);
    box.expandByPoint(_tmp);
  }
  return box;
}

export function soupCentroidAreaWeighted(soup: TriangleSoup): Vector3 {
  const centroid = new Vector3();
  let wsum = 0;
  const p = soup.positions;
  for (let t = 0; t < soup.triCount; t++) {
    const o = t * 9;
    _a.set(p[o]!, p[o + 1]!, p[o + 2]!);
    _b.set(p[o + 3]!, p[o + 4]!, p[o + 5]!);
    _c.set(p[o + 6]!, p[o + 7]!, p[o + 8]!);
    _ab.subVectors(_b, _a);
    _ac.subVectors(_c, _a);
    const area = _cross.crossVectors(_ab, _ac).length() * 0.5;
    if (area < 1e-18) continue;
    centroid.x += area * (_a.x + _b.x + _c.x) / 3;
    centroid.y += area * (_a.y + _b.y + _c.y) / 3;
    centroid.z += area * (_a.z + _b.z + _c.z) / 3;
    wsum += area;
  }
  if (wsum > 0) centroid.multiplyScalar(1 / wsum);
  return centroid;
}

export function soupAverageNormal(soup: TriangleSoup): Vector3 {
  const n = new Vector3();
  const p = soup.positions;
  for (let t = 0; t < soup.triCount; t++) {
    const o = t * 9;
    _a.set(p[o]!, p[o + 1]!, p[o + 2]!);
    _b.set(p[o + 3]!, p[o + 4]!, p[o + 5]!);
    _c.set(p[o + 6]!, p[o + 7]!, p[o + 8]!);
    _ab.subVectors(_b, _a);
    _ac.subVectors(_c, _a);
    n.add(_cross.crossVectors(_ab, _ac));
  }
  if (n.lengthSq() > 1e-20) n.normalize();
  else n.set(0, 0, 1);
  return n;
}

/** True if all soup vertices lie near the plane through `point` with unit `normal`. */
export function isPlanarSoup(
  soup: TriangleSoup,
  normal: Vector3,
  point: Vector3,
  tolMm: number = PLANAR_TOL_MM,
): boolean {
  const d = normal.dot(point);
  const p = soup.positions;
  for (let i = 0; i < p.length; i += 3) {
    const dist = Math.abs(normal.x * p[i]! + normal.y * p[i + 1]! + normal.z * p[i + 2]! - d);
    if (dist > tolMm) return false;
  }
  return true;
}

export interface MeshVolumeResult {
  volume: number;
  centroid: Vector3;
}

/** Signed volume + centroid of a closed triangle mesh (world space). */
export function meshVolumeCentroid(soup: TriangleSoup): MeshVolumeResult {
  let volume6 = 0;
  let cx = 0;
  let cy = 0;
  let cz = 0;
  const p = soup.positions;

  for (let t = 0; t < soup.triCount; t++) {
    const o = t * 9;
    const ax = p[o]!,
      ay = p[o + 1]!,
      az = p[o + 2]!;
    const bx = p[o + 3]!,
      by = p[o + 4]!,
      bz = p[o + 5]!;
    const cx0 = p[o + 6]!,
      cy0 = p[o + 7]!,
      cz0 = p[o + 8]!;
    // Scalar triple product a·(b×c)
    const crossX = by * cz0 - bz * cy0;
    const crossY = bz * cx0 - bx * cz0;
    const crossZ = bx * cy0 - by * cx0;
    const det = ax * crossX + ay * crossY + az * crossZ;
    volume6 += det;
    cx += det * (ax + bx + cx0);
    cy += det * (ay + by + cy0);
    cz += det * (az + bz + cz0);
  }

  const volume = volume6 / 6;
  const absV = Math.abs(volume);
  const centroid = new Vector3();
  if (absV > 1e-18) {
    // Centroid integrals: factor det/24 for each coord sum, divide by volume = det_sum/6
    // => centroid = (sum det*(a+b+c)) / (4 * sum det) = sum/(4*volume6)
    const inv = 1 / (4 * volume6);
    centroid.set(cx * inv, cy * inv, cz * inv);
  } else {
    // Degenerate — fall back to AABB center of samples
    const box = soupAabb(soup);
    box.getCenter(centroid);
  }
  return { volume: absV, centroid };
}

export function polylineLength(points: readonly Vector3[]): number {
  let len = 0;
  for (let i = 1; i < points.length; i++) {
    len += points[i]!.distanceTo(points[i - 1]!);
  }
  return len;
}

/** Point at arc-length fraction t ∈ [0,1] along polyline. */
export function polylinePointAt(points: readonly Vector3[], t: number): Vector3 {
  if (points.length === 0) return new Vector3();
  if (points.length === 1) return points[0]!.clone();
  const total = polylineLength(points);
  if (total < 1e-18) return points[0]!.clone();
  let target = Math.min(1, Math.max(0, t)) * total;
  for (let i = 1; i < points.length; i++) {
    const a = points[i - 1]!;
    const b = points[i]!;
    const seg = a.distanceTo(b);
    if (target <= seg || i === points.length - 1) {
      const u = seg > 1e-18 ? target / seg : 0;
      return new Vector3().lerpVectors(a, b, Math.min(1, Math.max(0, u)));
    }
    target -= seg;
  }
  return points[points.length - 1]!.clone();
}

export function edgeIsLinear(
  edge: TopologyEdge,
  tolMm: number = LINEAR_EDGE_TOL_MM,
): boolean {
  const pts = edge.points;
  if (pts.length <= 2) return true;
  const a = pts[0]!;
  const b = pts[pts.length - 1]!;
  const ab = _ab.subVectors(b, a);
  const abLenSq = ab.lengthSq();
  if (abLenSq < 1e-18) return true;
  for (let i = 1; i < pts.length - 1; i++) {
    const p = pts[i]!;
    // Distance from p to segment ab
    const t = Math.max(0, Math.min(1, _tmp.subVectors(p, a).dot(ab) / abLenSq));
    const proj = _c.copy(a).addScaledVector(ab, t);
    if (proj.distanceTo(p) > tolMm) return false;
  }
  return true;
}

export function edgeDirection(edge: TopologyEdge): Vector3 {
  const a = edge.points[0]!;
  const b = edge.points[edge.points.length - 1]!;
  const d = new Vector3().subVectors(b, a);
  if (d.lengthSq() > 1e-20) d.normalize();
  else d.set(1, 0, 0);
  return d;
}

// --- distances ---

export function pointSegmentDistanceSq(
  p: Vector3,
  a: Vector3,
  b: Vector3,
): number {
  _ab.subVectors(b, a);
  const abLenSq = _ab.lengthSq();
  if (abLenSq < 1e-24) return p.distanceToSquared(a);
  let t = _tmp.subVectors(p, a).dot(_ab) / abLenSq;
  t = Math.max(0, Math.min(1, t));
  _c.copy(a).addScaledVector(_ab, t);
  return p.distanceToSquared(_c);
}

/** Min distance between two line segments (robust). */
export function segmentSegmentDistance(
  a0: Vector3,
  a1: Vector3,
  b0: Vector3,
  b1: Vector3,
): number {
  // Clamp both endpoints of each segment against the other segment; also check closest approach.
  let min = Infinity;
  min = Math.min(min, Math.sqrt(pointSegmentDistanceSq(a0, b0, b1)));
  min = Math.min(min, Math.sqrt(pointSegmentDistanceSq(a1, b0, b1)));
  min = Math.min(min, Math.sqrt(pointSegmentDistanceSq(b0, a0, a1)));
  min = Math.min(min, Math.sqrt(pointSegmentDistanceSq(b1, a0, a1)));

  // Interior closest for skew segments
  const d1 = _ab.subVectors(a1, a0);
  const d2 = _ac.subVectors(b1, b0);
  const r = _tmp.subVectors(a0, b0);
  const a = d1.dot(d1);
  const e = d2.dot(d2);
  const f = d2.dot(r);
  if (a < 1e-24 || e < 1e-24) return min;
  const b = d1.dot(d2);
  const c = d1.dot(r);
  const denom = a * e - b * b;
  let s: number;
  let t: number;
  if (denom < 1e-24) {
    s = 0;
    t = f / e;
  } else {
    s = (b * f - c * e) / denom;
    t = (a * f - b * c) / denom;
  }
  if (s >= 0 && s <= 1 && t >= 0 && t <= 1) {
    const pa = new Vector3().copy(a0).addScaledVector(d1, s);
    const pb = new Vector3().copy(b0).addScaledVector(d2, t);
    min = Math.min(min, pa.distanceTo(pb));
  }
  return min;
}

export function polylinePairDistance(
  a: readonly Vector3[],
  b: readonly Vector3[],
): { min: number; maxEndpoint: number } {
  let min = Infinity;
  for (let i = 0; i < a.length - 1; i++) {
    for (let j = 0; j < b.length - 1; j++) {
      min = Math.min(
        min,
        segmentSegmentDistance(a[i]!, a[i + 1]!, b[j]!, b[j + 1]!),
      );
    }
  }
  if (!Number.isFinite(min)) min = 0;

  // Max of endpoint-to-polyline distances (finite curves have no single "max distance";
  // use max endpoint separation as a readable span metric).
  let maxEndpoint = 0;
  for (const p of a) {
    for (const q of b) {
      maxEndpoint = Math.max(maxEndpoint, p.distanceTo(q));
    }
  }
  return { min, maxEndpoint };
}

/** Point to triangle distance (squared). */
export function pointTriangleDistanceSq(
  p: Vector3,
  a: Vector3,
  b: Vector3,
  c: Vector3,
): number {
  // Ericson — Real-Time Collision Detection style
  const ab = _ab.subVectors(b, a);
  const ac = _ac.subVectors(c, a);
  const ap = _tmp.subVectors(p, a);
  const d1 = ab.dot(ap);
  const d2 = ac.dot(ap);
  if (d1 <= 0 && d2 <= 0) return p.distanceToSquared(a);

  const bp = new Vector3().subVectors(p, b);
  const d3 = ab.dot(bp);
  const d4 = ac.dot(bp);
  if (d3 >= 0 && d4 <= d3) return p.distanceToSquared(b);

  const vc = d1 * d4 - d3 * d2;
  if (vc <= 0 && d1 >= 0 && d3 <= 0) {
    const v = d1 / (d1 - d3);
    return p.distanceToSquared(_c.copy(a).addScaledVector(ab, v));
  }

  const cp = new Vector3().subVectors(p, c);
  const d5 = ab.dot(cp);
  const d6 = ac.dot(cp);
  if (d6 >= 0 && d5 <= d6) return p.distanceToSquared(c);

  const vb = d5 * d2 - d1 * d6;
  if (vb <= 0 && d2 >= 0 && d6 <= 0) {
    const w = d2 / (d2 - d6);
    return p.distanceToSquared(_c.copy(a).addScaledVector(ac, w));
  }

  const va = d3 * d6 - d5 * d4;
  if (va <= 0 && d4 - d3 >= 0 && d5 - d6 >= 0) {
    const w = (d4 - d3) / (d4 - d3 + d5 - d6);
    return p.distanceToSquared(_c.copy(b).addScaledVector(_tmp.subVectors(c, b), w));
  }

  const denom = 1 / (va + vb + vc);
  const v = vb * denom;
  const w = vc * denom;
  return p.distanceToSquared(
    _c.copy(a).addScaledVector(ab, v).addScaledVector(ac, w),
  );
}

export function soupVertices(soup: TriangleSoup): Vector3[] {
  const verts: Vector3[] = [];
  const p = soup.positions;
  const seen = new Set<string>();
  for (let i = 0; i < p.length; i += 3) {
    const x = p[i]!,
      y = p[i + 1]!,
      z = p[i + 2]!;
    const key = `${x.toFixed(5)},${y.toFixed(5)},${z.toFixed(5)}`;
    if (seen.has(key)) continue;
    seen.add(key);
    verts.push(new Vector3(x, y, z));
  }
  return verts;
}

/**
 * Approximate min distance between two triangle soups:
 * min of vertex→other-surface distances both ways.
 */
export function soupMinDistance(a: TriangleSoup, b: TriangleSoup): number {
  let min = Infinity;
  const va = soupVertices(a);
  const vb = soupVertices(b);
  min = Math.min(min, vertsToSoupMin(va, b));
  min = Math.min(min, vertsToSoupMin(vb, a));
  return Number.isFinite(min) ? min : 0;
}

function vertsToSoupMin(verts: Vector3[], soup: TriangleSoup): number {
  let min = Infinity;
  const p = soup.positions;
  for (const v of verts) {
    for (let t = 0; t < soup.triCount; t++) {
      const o = t * 9;
      _a.set(p[o]!, p[o + 1]!, p[o + 2]!);
      _b.set(p[o + 3]!, p[o + 4]!, p[o + 5]!);
      _c.set(p[o + 6]!, p[o + 7]!, p[o + 8]!);
      min = Math.min(min, Math.sqrt(pointTriangleDistanceSq(v, _a, _b, _c)));
    }
  }
  return min;
}

/** Max pairwise vertex distance (span) between two soups. */
export function soupMaxVertexDistance(a: TriangleSoup, b: TriangleSoup): number {
  const va = soupVertices(a);
  const vb = soupVertices(b);
  let max = 0;
  for (const p of va) {
    for (const q of vb) {
      max = Math.max(max, p.distanceTo(q));
    }
  }
  return max;
}

/** Signed plane distance of point: n·(p - originPoint). n should be unit. */
export function planeSignedDistance(
  point: Vector3,
  planePoint: Vector3,
  normal: Vector3,
): number {
  return normal.dot(_tmp.subVectors(point, planePoint));
}

export function planeAngleDeg(n0: Vector3, n1: Vector3): number {
  const d = Math.min(1, Math.max(-1, Math.abs(n0.dot(n1))));
  return (Math.acos(d) * 180) / Math.PI;
}

export function areNormalsParallel(n0: Vector3, n1: Vector3): boolean {
  return Math.abs(n0.dot(n1)) >= PARALLEL_DOT;
}
