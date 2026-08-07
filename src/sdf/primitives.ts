import { aabb } from "./bounds";
import type { FieldSolid, Vec3 } from "./types";

function length3(x: number, y: number, z: number): number {
  return Math.hypot(x, y, z);
}

/**
 * Axis-aligned box as a true SDF.
 * `min` / `max` are opposite corners in mm (order-independent).
 */
export function boxSolid(
  minCorner: Vec3,
  maxCorner: Vec3,
  leafId?: string,
): FieldSolid {
  const min: Vec3 = [
    Math.min(minCorner[0], maxCorner[0]),
    Math.min(minCorner[1], maxCorner[1]),
    Math.min(minCorner[2], maxCorner[2]),
  ];
  const max: Vec3 = [
    Math.max(minCorner[0], maxCorner[0]),
    Math.max(minCorner[1], maxCorner[1]),
    Math.max(minCorner[2], maxCorner[2]),
  ];
  const cx = (min[0] + max[0]) * 0.5;
  const cy = (min[1] + max[1]) * 0.5;
  const cz = (min[2] + max[2]) * 0.5;
  const hx = (max[0] - min[0]) * 0.5;
  const hy = (max[1] - min[1]) * 0.5;
  const hz = (max[2] - min[2]) * 0.5;

  return {
    leafId,
    bounds: aabb(min, max),
    leafAt: leafId ? () => leafId : undefined,
    evaluate(x, y, z) {
      const px = Math.abs(x - cx) - hx;
      const py = Math.abs(y - cy) - hy;
      const pz = Math.abs(z - cz) - hz;
      const ox = Math.max(px, 0);
      const oy = Math.max(py, 0);
      const oz = Math.max(pz, 0);
      const outside = length3(ox, oy, oz);
      const inside = Math.min(Math.max(px, py, pz), 0);
      return outside + inside;
    },
  };
}

/** Sphere as a true SDF. Center and radius in mm. */
export function sphereSolid(
  center: Vec3,
  radius: number,
  leafId?: string,
): FieldSolid {
  if (!(radius >= 0)) {
    throw new Error(`sphereSolid: radius must be non-negative, got ${radius}`);
  }
  const [cx, cy, cz] = center;
  return {
    leafId,
    bounds: aabb(
      [cx - radius, cy - radius, cz - radius],
      [cx + radius, cy + radius, cz + radius],
    ),
    leafAt: leafId ? () => leafId : undefined,
    evaluate(x, y, z) {
      return length3(x - cx, y - cy, z - cz) - radius;
    },
  };
}

/** Axis a finite cylinder is extruded along. Default `"z"`. */
export type CylinderAxis = "x" | "y" | "z";

/**
 * Finite cylinder: radius in the plane perpendicular to `axis`,
 * extent along `axis` as [axisMin, axisMax] (args still named zMin/zMax).
 * `centerXy` is the center in that perpendicular plane (XY/YZ/XZ).
 */
export function cylinderSolid(
  centerXy: readonly [number, number],
  radius: number,
  zMin: number,
  zMax: number,
  leafId?: string,
  axis: CylinderAxis = "z",
): FieldSolid {
  if (!(radius >= 0)) {
    throw new Error(`cylinderSolid: radius must be non-negative, got ${radius}`);
  }
  const lo = Math.min(zMin, zMax);
  const hi = Math.max(zMin, zMax);
  const halfLen = (hi - lo) * 0.5;
  const mid = (hi + lo) * 0.5;
  const [c0, c1] = centerXy;

  if (axis === "x") {
    // centerXy = (cy, cz); extent along X
    const cy = c0;
    const cz = c1;
    return {
      leafId,
      bounds: aabb(
        [lo, cy - radius, cz - radius],
        [hi, cy + radius, cz + radius],
      ),
      leafAt: leafId ? () => leafId : undefined,
      evaluate(x, y, z) {
        const d = Math.hypot(y - cy, z - cz) - radius;
        const da = Math.abs(x - mid) - halfLen;
        const ox = Math.max(d, 0);
        const oy = Math.max(da, 0);
        return Math.hypot(ox, oy) + Math.min(Math.max(d, da), 0);
      },
    };
  }

  if (axis === "y") {
    // centerXy = (cx, cz); extent along Y
    const cx = c0;
    const cz = c1;
    return {
      leafId,
      bounds: aabb(
        [cx - radius, lo, cz - radius],
        [cx + radius, hi, cz + radius],
      ),
      leafAt: leafId ? () => leafId : undefined,
      evaluate(x, y, z) {
        const d = Math.hypot(x - cx, z - cz) - radius;
        const da = Math.abs(y - mid) - halfLen;
        const ox = Math.max(d, 0);
        const oy = Math.max(da, 0);
        return Math.hypot(ox, oy) + Math.min(Math.max(d, da), 0);
      },
    };
  }

  // axis === "z": centerXy = (cx, cy); extent along Z
  const cx = c0;
  const cy = c1;
  return {
    leafId,
    bounds: aabb(
      [cx - radius, cy - radius, lo],
      [cx + radius, cy + radius, hi],
    ),
    leafAt: leafId ? () => leafId : undefined,
    evaluate(x, y, z) {
      const d = Math.hypot(x - cx, y - cy) - radius;
      const da = Math.abs(z - mid) - halfLen;
      const ox = Math.max(d, 0);
      const oy = Math.max(da, 0);
      return Math.hypot(ox, oy) + Math.min(Math.max(d, da), 0);
    },
  };
}
