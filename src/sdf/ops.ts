import { translateAabb, unionAabb } from "./bounds";
import { leafAt as resolveLeaf } from "./leaf";
import type { FieldSolid, Vec3 } from "./types";

/** Boolean union — bound field (min). Not always a true Euclidean SDF. */
export function union(a: FieldSolid, b: FieldSolid, leafId?: string): FieldSolid {
  return {
    leafId,
    bounds: unionAabb(a.bounds, b.bounds),
    source: { op: "union", a, b },
    evaluate(x, y, z) {
      return Math.min(a.evaluate(x, y, z), b.evaluate(x, y, z));
    },
    leafAt(x, y, z) {
      const da = a.evaluate(x, y, z);
      const db = b.evaluate(x, y, z);
      if (da <= db) return resolveLeaf(a, x, y, z);
      return resolveLeaf(b, x, y, z);
    },
  };
}

/** Boolean intersection — bound field (max). */
export function intersection(
  a: FieldSolid,
  b: FieldSolid,
  leafId?: string,
): FieldSolid {
  return {
    leafId,
    bounds: {
      min: [
        Math.max(a.bounds.min[0], b.bounds.min[0]),
        Math.max(a.bounds.min[1], b.bounds.min[1]),
        Math.max(a.bounds.min[2], b.bounds.min[2]),
      ],
      max: [
        Math.min(a.bounds.max[0], b.bounds.max[0]),
        Math.min(a.bounds.max[1], b.bounds.max[1]),
        Math.min(a.bounds.max[2], b.bounds.max[2]),
      ],
    },
    source: { op: "intersection", a, b },
    evaluate(x, y, z) {
      return Math.max(a.evaluate(x, y, z), b.evaluate(x, y, z));
    },
    leafAt(x, y, z) {
      const da = a.evaluate(x, y, z);
      const db = b.evaluate(x, y, z);
      if (da >= db) return resolveLeaf(a, x, y, z);
      return resolveLeaf(b, x, y, z);
    },
  };
}

/** Boolean difference a \ b — bound field. */
export function difference(
  a: FieldSolid,
  b: FieldSolid,
  leafId?: string,
): FieldSolid {
  return {
    leafId,
    bounds: a.bounds,
    source: { op: "difference", a, b },
    evaluate(x, y, z) {
      return Math.max(a.evaluate(x, y, z), -b.evaluate(x, y, z));
    },
    leafAt(x, y, z) {
      const da = a.evaluate(x, y, z);
      const db = b.evaluate(x, y, z);
      if (da >= -db) return resolveLeaf(a, x, y, z);
      return resolveLeaf(b, x, y, z);
    },
  };
}

/** Translate a solid by an offset in mm. Preserves leafId / leafAt. */
export function translate(solid: FieldSolid, offset: Vec3): FieldSolid {
  const [tx, ty, tz] = offset;
  return {
    leafId: solid.leafId,
    bounds: translateAabb(solid.bounds, offset),
    source: { op: "translate", solid, offset },
    evaluate(x, y, z) {
      return solid.evaluate(x - tx, y - ty, z - tz);
    },
    leafAt(x, y, z) {
      return resolveLeaf(solid, x - tx, y - ty, z - tz);
    },
  };
}

/**
 * Offset / inflate surface by `delta` mm (positive grows the solid).
 * Correct for true SDFs; approximate for bound fields after CSG.
 */
export function offset(
  solid: FieldSolid,
  delta: number,
  leafId?: string,
): FieldSolid {
  const pad = Math.abs(delta);
  return {
    leafId: leafId ?? solid.leafId,
    bounds: {
      min: [
        solid.bounds.min[0] - pad,
        solid.bounds.min[1] - pad,
        solid.bounds.min[2] - pad,
      ],
      max: [
        solid.bounds.max[0] + pad,
        solid.bounds.max[1] + pad,
        solid.bounds.max[2] + pad,
      ],
    },
    source: { op: "offset", solid, delta },
    evaluate(x, y, z) {
      return solid.evaluate(x, y, z) - delta;
    },
    leafAt(x, y, z) {
      return resolveLeaf(solid, x, y, z) ?? leafId ?? solid.leafId;
    },
  };
}

/**
 * Polynomial smooth-min union (Quilez). Global blend — not a targeted edge fillet.
 * `k` is blend radius-ish in mm (larger = softer join).
 */
export function smoothUnion(
  a: FieldSolid,
  b: FieldSolid,
  k: number,
  leafId?: string,
): FieldSolid {
  const kk = Math.max(k, 1e-6);
  return {
    leafId,
    bounds: unionAabb(a.bounds, b.bounds),
    source: { op: "smoothUnion", a, b, k: kk },
    evaluate(x, y, z) {
      const d1 = a.evaluate(x, y, z);
      const d2 = b.evaluate(x, y, z);
      const h = Math.min(Math.max(0.5 + 0.5 * (d2 - d1) / kk, 0), 1);
      return d2 * (1 - h) + d1 * h - kk * h * (1 - h);
    },
    leafAt(x, y, z) {
      const da = a.evaluate(x, y, z);
      const db = b.evaluate(x, y, z);
      if (da <= db) return resolveLeaf(a, x, y, z);
      return resolveLeaf(b, x, y, z);
    },
  };
}
