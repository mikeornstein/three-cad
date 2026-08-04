/**
 * Compile a serializable FieldNode tree into WGSL for GPU sphere tracing.
 *
 * Produces helpers + `fn map(p: vec3<f32>) -> f32` matching CPU FieldSolid.evaluate
 * (mm, f < 0 inside). Bound fields after min/max CSG are intentional.
 */

import type { FieldNode } from "../document/fieldDef";
import type { Vec3 } from "../sdf/types";
import { boundsOf, orderedMax, orderedMin } from "./fieldBounds";

export interface FieldWgslCompileResult {
  /**
   * WGSL source: SDF helpers + `fn map(p: vec3<f32>) -> f32`.
   * Intended to be spliced into a larger shader / wgslFn body.
   */
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
export const WGSL_SDF_HELPERS = /* wgsl */ `
fn sdBox(p: vec3<f32>, b: vec3<f32>) -> f32 {
  let q = abs(p) - b;
  return length(max(q, vec3<f32>(0.0))) + min(max(q.x, max(q.y, q.z)), 0.0);
}

fn sdSphere(p: vec3<f32>, r: f32) -> f32 {
  return length(p) - r;
}

fn sdCylinderZ(p: vec3<f32>, r: f32, hz: f32) -> f32 {
  let d = abs(vec2<f32>(length(p.xy), p.z)) - vec2<f32>(r, hz);
  return min(max(d.x, d.y), 0.0) + length(max(d, vec2<f32>(0.0, 0.0)));
}

fn opSmoothUnion(d1: f32, d2: f32, k: f32) -> f32 {
  let h = clamp(0.5 + 0.5 * (d2 - d1) / k, 0.0, 1.0);
  return mix(d2, d1, h) - k * h * (1.0 - h);
}
`.trim();

/**
 * Compile FieldNode → WGSL map function body.
 * Throws if the tree is empty / unsupported (should not happen for valid docs).
 */
export function fieldNodeToWgsl(root: FieldNode): FieldWgslCompileResult {
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
          `let ${d} = sdBox((${pointExpr}) - vec3<f32>(${f(cx)}, ${f(cy)}, ${f(cz)}), vec3<f32>(${f(hx)}, ${f(hy)}, ${f(hz)}));`,
        );
        return d;
      }
      case "sphere": {
        const [cx, cy, cz] = node.center;
        lines.push(
          `let ${d} = sdSphere((${pointExpr}) - vec3<f32>(${f(cx)}, ${f(cy)}, ${f(cz)}), ${f(node.radius)});`,
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
          `let ${d} = sdCylinderZ((${pointExpr}) - vec3<f32>(${f(cx)}, ${f(cy)}, ${f(cz)}), ${f(node.radius)}, ${f(hz)});`,
        );
        return d;
      }
      case "union": {
        const a = emit(node.a, pointExpr);
        const b = emit(node.b, pointExpr);
        lines.push(`let ${d} = min(${a}, ${b});`);
        return d;
      }
      case "intersection": {
        const a = emit(node.a, pointExpr);
        const b = emit(node.b, pointExpr);
        lines.push(`let ${d} = max(${a}, ${b});`);
        return d;
      }
      case "difference": {
        const a = emit(node.a, pointExpr);
        const b = emit(node.b, pointExpr);
        lines.push(`let ${d} = max(${a}, -${b});`);
        return d;
      }
      case "translate": {
        const [tx, ty, tz] = node.offset;
        const local = `p_${id}`;
        lines.push(
          `let ${local} = (${pointExpr}) - vec3<f32>(${f(tx)}, ${f(ty)}, ${f(tz)});`,
        );
        const child = emit(node.solid, local);
        lines.push(`let ${d} = ${child};`);
        return d;
      }
      case "offset": {
        const inner = emit(node.solid, pointExpr);
        lines.push(`let ${d} = ${inner} - ${f(node.delta)};`);
        return d;
      }
      case "smoothUnion": {
        const a = emit(node.a, pointExpr);
        const b = emit(node.b, pointExpr);
        lines.push(`let ${d} = opSmoothUnion(${a}, ${b}, ${f(node.k)});`);
        return d;
      }
      default: {
        const _exhaustive: never = node;
        throw new Error(
          `fieldNodeToWgsl: unsupported op ${JSON.stringify(_exhaustive)}`,
        );
      }
    }
  };

  const rootVar = emit(root, "p");
  const mapSource = [
    WGSL_SDF_HELPERS,
    "",
    "fn map(p: vec3<f32>) -> f32 {",
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
    throw new Error(`fieldNodeToWgsl: non-finite number ${n}`);
  }
  // Ensure WGSL float literal (1 → 1.0)
  const s = String(n);
  if (!/[.eE]/.test(s)) return `${s}.0`;
  return s;
}
