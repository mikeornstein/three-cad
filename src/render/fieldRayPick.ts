/**
 * CPU sphere-trace pick against FieldSolid (mesh-free hit testing).
 *
 * Used when the viewport displays ray-marched fields instead of tessellations.
 */

import {
  PerspectiveCamera,
  Vector2,
  Vector3,
  type Ray,
} from "three";
import { fieldNormal, leafAt, type FieldSolid } from "../sdf";

export interface FieldRayHit {
  readonly point: Vector3;
  readonly normal: Vector3;
  readonly distance: number;
  readonly leafId?: string;
  readonly field: FieldSolid;
}

export interface FieldPickTarget {
  readonly field: FieldSolid;
  /** Optional id for multi-solid scenes. */
  readonly solidId?: string;
}

const _ndc = new Vector2();
const _origin = new Vector3();
const _dir = new Vector3();

/**
 * Sphere-trace a world ray against a field solid.
 * Returns the nearest surface hit within the padded AABB, or null.
 */
export function sphereTraceField(
  field: FieldSolid,
  origin: Vector3,
  direction: Vector3,
  options: {
    readonly maxSteps?: number;
    readonly surfaceEpsMm?: number;
    readonly padMm?: number;
  } = {},
): FieldRayHit | null {
  const maxSteps = options.maxSteps ?? 128;
  const eps = options.surfaceEpsMm ?? 0.08;
  const pad = options.padMm ?? 1;
  const stepScale = 0.85;

  const bmin = field.bounds.min;
  const bmax = field.bounds.max;
  const aabbMin = new Vector3(
    bmin[0] - pad,
    bmin[1] - pad,
    bmin[2] - pad,
  );
  const aabbMax = new Vector3(
    bmax[0] + pad,
    bmax[1] + pad,
    bmax[2] + pad,
  );

  const dir = direction.clone().normalize();
  const hitRange = intersectAabb(origin, dir, aabbMin, aabbMax);
  if (!hitRange) return null;

  let t = Math.max(hitRange.tNear, 0);
  const tFar = hitRange.tFar;

  for (let i = 0; i < maxSteps; i++) {
    if (t > tFar) break;
    const x = origin.x + dir.x * t;
    const y = origin.y + dir.y * t;
    const z = origin.z + dir.z * t;
    const d = field.evaluate(x, y, z);
    if (d < eps) {
      const point = new Vector3(x, y, z);
      const n = fieldNormal(field, x, y, z);
      const normal = n
        ? new Vector3(n[0], n[1], n[2])
        : new Vector3(0, 0, 1);
      const leaf = leafAt(field, x, y, z);
      return {
        point,
        normal,
        distance: t,
        leafId: leaf,
        field,
      };
    }
    t += Math.max(d * stepScale, eps * 0.5);
  }
  return null;
}

/**
 * Pick the nearest field solid under a pointer (client coords).
 */
export function pickFieldAtPointer(
  clientX: number,
  clientY: number,
  camera: PerspectiveCamera,
  canvas: HTMLCanvasElement,
  targets: readonly FieldPickTarget[],
): (FieldRayHit & { solidId?: string }) | null {
  if (targets.length === 0) return null;
  const rect = canvas.getBoundingClientRect();
  if (rect.width <= 0 || rect.height <= 0) return null;

  _ndc.x = ((clientX - rect.left) / rect.width) * 2 - 1;
  _ndc.y = -((clientY - rect.top) / rect.height) * 2 + 1;

  // Unproject NDC to world ray (Three camera convention)
  _origin.setFromMatrixPosition(camera.matrixWorld);
  _dir.set(_ndc.x, _ndc.y, 0.5).unproject(camera).sub(_origin).normalize();

  let best: (FieldRayHit & { solidId?: string }) | null = null;
  for (const target of targets) {
    const hit = sphereTraceField(target.field, _origin, _dir);
    if (!hit) continue;
    if (!best || hit.distance < best.distance) {
      best = { ...hit, solidId: target.solidId };
    }
  }
  return best;
}

/**
 * Sphere-trace using an existing Three.js Ray (e.g. from Raycaster).
 */
export function sphereTraceAlongRay(
  field: FieldSolid,
  ray: Ray,
): FieldRayHit | null {
  return sphereTraceField(field, ray.origin, ray.direction);
}

function intersectAabb(
  origin: Vector3,
  dir: Vector3,
  bmin: Vector3,
  bmax: Vector3,
): { tNear: number; tFar: number } | null {
  const invX = 1 / (dir.x || 1e-12);
  const invY = 1 / (dir.y || 1e-12);
  const invZ = 1 / (dir.z || 1e-12);

  let t0x = (bmin.x - origin.x) * invX;
  let t1x = (bmax.x - origin.x) * invX;
  let t0y = (bmin.y - origin.y) * invY;
  let t1y = (bmax.y - origin.y) * invY;
  let t0z = (bmin.z - origin.z) * invZ;
  let t1z = (bmax.z - origin.z) * invZ;

  if (t0x > t1x) [t0x, t1x] = [t1x, t0x];
  if (t0y > t1y) [t0y, t1y] = [t1y, t0y];
  if (t0z > t1z) [t0z, t1z] = [t1z, t0z];

  const tNear = Math.max(t0x, t0y, t0z);
  const tFar = Math.min(t1x, t1y, t1z);
  if (tFar < Math.max(tNear, 0)) return null;
  return { tNear, tFar };
}
