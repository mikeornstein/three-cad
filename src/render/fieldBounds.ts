/**
 * Conservative AABB for FieldNode trees (mm).
 * Shared by CPU evaluator bounds, GLSL/WGSL compilers, and display padding.
 */

import type { FieldNode } from "../document/fieldDef";
import type { Vec3 } from "../sdf/types";

export function orderedMin(a: Vec3, b: Vec3): Vec3 {
  return [
    Math.min(a[0], b[0]),
    Math.min(a[1], b[1]),
    Math.min(a[2], b[2]),
  ];
}

export function orderedMax(a: Vec3, b: Vec3): Vec3 {
  return [
    Math.max(a[0], b[0]),
    Math.max(a[1], b[1]),
    Math.max(a[2], b[2]),
  ];
}

/** Bounds matching CPU buildField / primitive bounds (mm). */
export function boundsOf(node: FieldNode): { min: Vec3; max: Vec3 } {
  switch (node.op) {
    case "box":
      return {
        min: orderedMin(node.min, node.max),
        max: orderedMax(node.min, node.max),
      };
    case "sphere": {
      const [cx, cy, cz] = node.center;
      const r = node.radius;
      return {
        min: [cx - r, cy - r, cz - r],
        max: [cx + r, cy + r, cz + r],
      };
    }
    case "cylinder": {
      const [c0, c1] = node.centerXy;
      const r = node.radius;
      const lo = Math.min(node.zMin, node.zMax);
      const hi = Math.max(node.zMin, node.zMax);
      const axis = node.axis ?? "z";
      if (axis === "x") {
        return {
          min: [lo, c0 - r, c1 - r],
          max: [hi, c0 + r, c1 + r],
        };
      }
      if (axis === "y") {
        return {
          min: [c0 - r, lo, c1 - r],
          max: [c0 + r, hi, c1 + r],
        };
      }
      return {
        min: [c0 - r, c1 - r, lo],
        max: [c0 + r, c1 + r, hi],
      };
    }
    case "union":
    case "smoothUnion":
      return unionBounds(boundsOf(node.a), boundsOf(node.b));
    case "intersection":
      return intersectBounds(boundsOf(node.a), boundsOf(node.b));
    case "difference":
      return boundsOf(node.a);
    case "translate": {
      const b = boundsOf(node.solid);
      const [tx, ty, tz] = node.offset;
      return {
        min: [b.min[0] + tx, b.min[1] + ty, b.min[2] + tz],
        max: [b.max[0] + tx, b.max[1] + ty, b.max[2] + tz],
      };
    }
    case "offset": {
      const b = boundsOf(node.solid);
      const pad = Math.abs(node.delta);
      return {
        min: [b.min[0] - pad, b.min[1] - pad, b.min[2] - pad],
        max: [b.max[0] + pad, b.max[1] + pad, b.max[2] + pad],
      };
    }
    default: {
      const _exhaustive: never = node;
      throw new Error(`boundsOf: unsupported ${JSON.stringify(_exhaustive)}`);
    }
  }
}

function unionBounds(
  a: { min: Vec3; max: Vec3 },
  b: { min: Vec3; max: Vec3 },
): { min: Vec3; max: Vec3 } {
  return {
    min: [
      Math.min(a.min[0], b.min[0]),
      Math.min(a.min[1], b.min[1]),
      Math.min(a.min[2], b.min[2]),
    ],
    max: [
      Math.max(a.max[0], b.max[0]),
      Math.max(a.max[1], b.max[1]),
      Math.max(a.max[2], b.max[2]),
    ],
  };
}

function intersectBounds(
  a: { min: Vec3; max: Vec3 },
  b: { min: Vec3; max: Vec3 },
): { min: Vec3; max: Vec3 } {
  return {
    min: [
      Math.max(a.min[0], b.min[0]),
      Math.max(a.min[1], b.min[1]),
      Math.max(a.min[2], b.min[2]),
    ],
    max: [
      Math.min(a.max[0], b.max[0]),
      Math.min(a.max[1], b.max[1]),
      Math.min(a.max[2], b.max[2]),
    ],
  };
}
