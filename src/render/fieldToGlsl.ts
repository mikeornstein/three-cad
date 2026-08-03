/**
 * Compile a serializable FieldNode tree into GLSL for GPU sphere tracing.
 *
 * Produces a `float map(vec3 p)` that matches CPU FieldSolid.evaluate semantics
 * (mm, f < 0 inside). Bound fields after min/max CSG are intentional.
 */

import type { FieldNode } from "../document/fieldDef";
import type { Vec3 } from "../sdf/types";

export interface FieldGlslCompileResult {
  /** Full GLSL: helpers + `float map(vec3 p)`. */
  readonly mapSource: string;
  /** Conservative AABB of the tree (mm), same rules as CPU buildField. */
  readonly bounds: {
    readonly min: Vec3;
    readonly max: Vec3;
  };
  /** Number of SSA-style temps emitted (debug / cost signal). */
  readonly tempCount: number;
}

/** Shared SDF primitives used by every compiled map(). */
export const GLSL_SDF_HELPERS = /* glsl */ `
float sdBox(vec3 p, vec3 b) {
  vec3 q = abs(p) - b;
  return length(max(q, 0.0)) + min(max(q.x, max(q.y, q.z)), 0.0);
}

float sdSphere(vec3 p, float r) {
  return length(p) - r;
}

float sdCylinderZ(vec3 p, float r, float hz) {
  vec2 d = abs(vec2(length(p.xy), p.z)) - vec2(r, hz);
  return min(max(d.x, d.y), 0.0) + length(max(d, 0.0));
}

float opSmoothUnion(float d1, float d2, float k) {
  float h = clamp(0.5 + 0.5 * (d2 - d1) / k, 0.0, 1.0);
  return mix(d2, d1, h) - k * h * (1.0 - h);
}
`.trim();

/**
 * Compile FieldNode → GLSL map function.
 * Throws if the tree is empty / unsupported (should not happen for valid docs).
 */
export function fieldNodeToGlsl(root: FieldNode): FieldGlslCompileResult {
  let nextId = 0;
  const lines: string[] = [];

  const emit = (node: FieldNode, pointExpr: string): string => {
    const id = nextId++;
    const d = `d${id}`;

    switch (node.op) {
      case "box": {
        const min = orderedMin(node.min, node.max);
        const max = orderedMax(node.min, node.max);
        const cx = (min[0] + max[0]) * 0.5;
        const cy = (min[1] + max[1]) * 0.5;
        const cz = (min[2] + max[2]) * 0.5;
        const hx = (max[0] - min[0]) * 0.5;
        const hy = (max[1] - min[1]) * 0.5;
        const hz = (max[2] - min[2]) * 0.5;
        lines.push(
          `float ${d} = sdBox((${pointExpr}) - vec3(${f(cx)}, ${f(cy)}, ${f(cz)}), vec3(${f(hx)}, ${f(hy)}, ${f(hz)}));`,
        );
        return d;
      }
      case "sphere": {
        const [cx, cy, cz] = node.center;
        lines.push(
          `float ${d} = sdSphere((${pointExpr}) - vec3(${f(cx)}, ${f(cy)}, ${f(cz)}), ${f(node.radius)});`,
        );
        return d;
      }
      case "cylinder": {
        const [cx, cy] = node.centerXy;
        const lo = Math.min(node.zMin, node.zMax);
        const hi = Math.max(node.zMin, node.zMax);
        const cz = (lo + hi) * 0.5;
        const hz = (hi - lo) * 0.5;
        lines.push(
          `float ${d} = sdCylinderZ((${pointExpr}) - vec3(${f(cx)}, ${f(cy)}, ${f(cz)}), ${f(node.radius)}, ${f(hz)});`,
        );
        return d;
      }
      case "union": {
        const a = emit(node.a, pointExpr);
        const b = emit(node.b, pointExpr);
        lines.push(`float ${d} = min(${a}, ${b});`);
        return d;
      }
      case "intersection": {
        const a = emit(node.a, pointExpr);
        const b = emit(node.b, pointExpr);
        lines.push(`float ${d} = max(${a}, ${b});`);
        return d;
      }
      case "difference": {
        const a = emit(node.a, pointExpr);
        const b = emit(node.b, pointExpr);
        lines.push(`float ${d} = max(${a}, -${b});`);
        return d;
      }
      case "translate": {
        const [tx, ty, tz] = node.offset;
        const local = `p_${id}`;
        lines.push(
          `vec3 ${local} = (${pointExpr}) - vec3(${f(tx)}, ${f(ty)}, ${f(tz)});`,
        );
        const child = emit(node.solid, local);
        lines.push(`float ${d} = ${child};`);
        return d;
      }
      case "offset": {
        const inner = emit(node.solid, pointExpr);
        lines.push(`float ${d} = ${inner} - ${f(node.delta)};`);
        return d;
      }
      case "smoothUnion": {
        const a = emit(node.a, pointExpr);
        const b = emit(node.b, pointExpr);
        lines.push(
          `float ${d} = opSmoothUnion(${a}, ${b}, ${f(node.k)});`,
        );
        return d;
      }
      default: {
        const _exhaustive: never = node;
        throw new Error(
          `fieldNodeToGlsl: unsupported op ${JSON.stringify(_exhaustive)}`,
        );
      }
    }
  };

  const rootVar = emit(root, "p");
  const mapSource = [
    GLSL_SDF_HELPERS,
    "",
    "float map(vec3 p) {",
    ...lines.map((l) => `  ${l}`),
    `  return ${rootVar};`,
    "}",
  ].join("\n");

  return {
    mapSource,
    bounds: boundsOf(root),
    tempCount: nextId,
  };
}

function f(n: number): string {
  if (!Number.isFinite(n)) {
    throw new Error(`fieldNodeToGlsl: non-finite number ${n}`);
  }
  // Ensure GLSL float literal (1 → 1.0)
  const s = String(n);
  if (!/[.eE]/.test(s)) return `${s}.0`;
  return s;
}

function orderedMin(a: Vec3, b: Vec3): Vec3 {
  return [
    Math.min(a[0], b[0]),
    Math.min(a[1], b[1]),
    Math.min(a[2], b[2]),
  ];
}

function orderedMax(a: Vec3, b: Vec3): Vec3 {
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
      const [cx, cy] = node.centerXy;
      const r = node.radius;
      const lo = Math.min(node.zMin, node.zMax);
      const hi = Math.max(node.zMin, node.zMax);
      return {
        min: [cx - r, cy - r, lo],
        max: [cx + r, cy + r, hi],
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
