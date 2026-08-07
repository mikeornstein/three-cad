/**
 * Compile a serializable FieldNode tree into WGSL for GPU sphere tracing.
 *
 * Produces helpers +:
 * - `fn sampleField(p) -> vec2<f32>` — x = signed distance (mm), y = material weight
 * - `fn map(p) -> f32` — convenience wrapper
 * - `fn matWeight(p) -> f32` — convenience wrapper
 *
 * Bound fields after min/max CSG are intentional. Smooth-union blends both
 * distance (soft-min) and material weight with the same h factor so materials
 * stay continuous across the join.
 */

import type { FieldNode } from "../document/fieldDef";
import type { Vec3 } from "../sdf/types";
import { boundsOf, orderedMax, orderedMin } from "./fieldBounds";

export interface FieldWgslCompileOptions {
  /**
   * leafId → material weight in [0, 1].
   * Missing / empty leafId → 0.
   */
  readonly leafMaterialWeight?: Readonly<Record<string, number>>;
}

export interface FieldWgslCompileResult {
  /**
   * WGSL source: SDF helpers + `sampleField` / `map` / `matWeight`.
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
`.trim();

interface EmitPair {
  readonly d: string;
  readonly w: string;
}

/**
 * Compile FieldNode → WGSL sampleField / map / matWeight.
 * Throws if the tree is empty / unsupported (should not happen for valid docs).
 */
export function fieldNodeToWgsl(
  root: FieldNode,
  options: FieldWgslCompileOptions = {},
): FieldWgslCompileResult {
  const leafW = options.leafMaterialWeight ?? {};
  let nextId = 0;
  const lines: string[] = [];

  const weightOf = (leafId?: string): number => {
    if (!leafId) return 0;
    const w = leafW[leafId];
    return w === undefined ? 0 : clamp01(w);
  };

  const emit = (node: FieldNode, pointExpr: string): EmitPair => {
    const id = nextId++;
    const d = `d${id}`;
    const w = `w${id}`;

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
        lines.push(`let ${w} = ${f(weightOf(node.leafId))};`);
        return { d, w };
      }
      case "sphere": {
        const [cx, cy, cz] = node.center;
        lines.push(
          `let ${d} = sdSphere((${pointExpr}) - vec3<f32>(${f(cx)}, ${f(cy)}, ${f(cz)}), ${f(node.radius)});`,
        );
        lines.push(`let ${w} = ${f(weightOf(node.leafId))};`);
        return { d, w };
      }
      case "cylinder": {
        const [c0, c1] = node.centerXy;
        const lo = Math.min(node.zMin, node.zMax);
        const hi = Math.max(node.zMin, node.zMax);
        const mid = (lo + hi) * 0.5;
        const halfLen = (hi - lo) * 0.5;
        const axis = node.axis ?? "z";
        // Remap so the extrusion axis becomes local Z for sdCylinderZ.
        let localExpr: string;
        if (axis === "x") {
          // centerXy = (cy, cz); local = (y-cy, z-cz, x-mid)
          localExpr = `vec3<f32>((${pointExpr}).y - ${f(c0)}, (${pointExpr}).z - ${f(c1)}, (${pointExpr}).x - ${f(mid)})`;
        } else if (axis === "y") {
          // centerXy = (cx, cz); local = (x-cx, z-cz, y-mid)
          localExpr = `vec3<f32>((${pointExpr}).x - ${f(c0)}, (${pointExpr}).z - ${f(c1)}, (${pointExpr}).y - ${f(mid)})`;
        } else {
          // centerXy = (cx, cy); local = (x-cx, y-cy, z-mid)
          localExpr = `vec3<f32>((${pointExpr}).x - ${f(c0)}, (${pointExpr}).y - ${f(c1)}, (${pointExpr}).z - ${f(mid)})`;
        }
        lines.push(
          `let ${d} = sdCylinderZ(${localExpr}, ${f(node.radius)}, ${f(halfLen)});`,
        );
        lines.push(`let ${w} = ${f(weightOf(node.leafId))};`);
        return { d, w };
      }
      case "union": {
        const a = emit(node.a, pointExpr);
        const b = emit(node.b, pointExpr);
        lines.push(`let ${d} = min(${a.d}, ${b.d});`);
        lines.push(
          `let ${w} = select(${b.w}, ${a.w}, ${a.d} <= ${b.d});`,
        );
        return { d, w };
      }
      case "intersection": {
        const a = emit(node.a, pointExpr);
        const b = emit(node.b, pointExpr);
        lines.push(`let ${d} = max(${a.d}, ${b.d});`);
        lines.push(
          `let ${w} = select(${b.w}, ${a.w}, ${a.d} >= ${b.d});`,
        );
        return { d, w };
      }
      case "difference": {
        const a = emit(node.a, pointExpr);
        const b = emit(node.b, pointExpr);
        lines.push(`let ${d} = max(${a.d}, -${b.d});`);
        lines.push(`let ${w} = ${a.w};`);
        return { d, w };
      }
      case "translate": {
        const [tx, ty, tz] = node.offset;
        const local = `p_${id}`;
        lines.push(
          `let ${local} = (${pointExpr}) - vec3<f32>(${f(tx)}, ${f(ty)}, ${f(tz)});`,
        );
        const child = emit(node.solid, local);
        lines.push(`let ${d} = ${child.d};`);
        lines.push(`let ${w} = ${child.w};`);
        return { d, w };
      }
      case "offset": {
        const inner = emit(node.solid, pointExpr);
        lines.push(`let ${d} = ${inner.d} - ${f(node.delta)};`);
        lines.push(`let ${w} = ${inner.w};`);
        return { d, w };
      }
      case "smoothUnion": {
        // Soft-min: distance and material share the same h (C1-ish continuous).
        const a = emit(node.a, pointExpr);
        const b = emit(node.b, pointExpr);
        const k = Math.max(node.k, 1e-6);
        const h = `h${id}`;
        lines.push(
          `let ${h} = clamp(0.5 + 0.5 * (${b.d} - ${a.d}) / ${f(k)}, 0.0, 1.0);`,
        );
        lines.push(
          `let ${d} = mix(${b.d}, ${a.d}, ${h}) - ${f(k)} * ${h} * (1.0 - ${h});`,
        );
        // Smoothstep h slightly for material so the color ramp reads cleaner
        // without changing the geometry soft-min (geometry stays on raw h).
        const hs = `hs${id}`;
        lines.push(`let ${hs} = ${h} * ${h} * (3.0 - 2.0 * ${h});`);
        lines.push(`let ${w} = mix(${b.w}, ${a.w}, ${hs});`);
        return { d, w };
      }
      default: {
        const _exhaustive: never = node;
        throw new Error(
          `fieldNodeToWgsl: unsupported op ${JSON.stringify(_exhaustive)}`,
        );
      }
    }
  };

  const rootPair = emit(root, "p");
  const body = lines.map((l) => `  ${l}`);
  const mapSource = [
    WGSL_SDF_HELPERS,
    "",
    "fn sampleField(p: vec3<f32>) -> vec2<f32> {",
    ...body,
    `  return vec2<f32>(${rootPair.d}, ${rootPair.w});`,
    "}",
    "",
    "fn map(p: vec3<f32>) -> f32 {",
    "  return sampleField(p).x;",
    "}",
    "",
    "fn matWeight(p: vec3<f32>) -> f32 {",
    "  return sampleField(p).y;",
    "}",
  ].join("\n");

  return {
    mapSource,
    bounds: boundsOf(root),
    tempCount: nextId,
  };
}

function clamp01(n: number): number {
  return Math.min(1, Math.max(0, n));
}

function f(n: number): string {
  if (!Number.isFinite(n)) {
    throw new Error(`fieldNodeToWgsl: non-finite number ${n}`);
  }
  const s = String(n);
  if (!/[.eE]/.test(s)) return `${s}.0`;
  return s;
}
