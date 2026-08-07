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
  /**
   * leafId → WGSL parameter name for a live sphere center (`vec3<f32>`).
   * When set, that sphere's center is not baked — callers pass the param each sample.
   */
  readonly liveSphereCenters?: Readonly<Record<string, string>>;
  /**
   * leafId → WGSL parameter name for a live sphere radius (`f32`).
   * When set, that sphere's radius is not baked.
   */
  readonly liveSphereRadii?: Readonly<Record<string, string>>;
}

/** Extra sampleField parameter (after `p`) for live / animated leaves. */
export interface LiveFieldParam {
  readonly name: string;
  readonly wgslType: "vec3<f32>" | "f32";
  readonly leafId: string;
  readonly role: "sphereCenter" | "sphereRadius";
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
  /**
   * Ordered live params appended to `sampleField(p, …)` / `map` / `matWeight`.
   * Empty when every leaf is fully baked.
   */
  readonly liveParams: readonly LiveFieldParam[];
  /**
   * WGSL parameter-list suffix for live params, e.g.
   * `, liveSphereCenter: vec3<f32>, liveSphereRadius: f32` or `""`.
   */
  readonly liveDeclSuffix: string;
  /**
   * WGSL argument-list suffix for live params, e.g.
   * `, liveSphereCenter, liveSphereRadius` or `""`.
   */
  readonly liveCallSuffix: string;
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
  const liveCenters = options.liveSphereCenters ?? {};
  const liveRadii = options.liveSphereRadii ?? {};
  const liveParams = collectLiveParams(liveCenters, liveRadii);
  const liveDeclSuffix = liveParams
    .map((p) => `, ${p.name}: ${p.wgslType}`)
    .join("");
  const liveCallSuffix = liveParams.map((p) => `, ${p.name}`).join("");

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
        const centerExpr = liveCenterExpr(node.leafId, node.center, liveCenters);
        const radiusExpr = liveRadiusExpr(node.leafId, node.radius, liveRadii);
        lines.push(
          `let ${d} = sdSphere((${pointExpr}) - ${centerExpr}, ${radiusExpr});`,
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
    `fn sampleField(p: vec3<f32>${liveDeclSuffix}) -> vec2<f32> {`,
    ...body,
    `  return vec2<f32>(${rootPair.d}, ${rootPair.w});`,
    "}",
    "",
    `fn map(p: vec3<f32>${liveDeclSuffix}) -> f32 {`,
    `  return sampleField(p${liveCallSuffix}).x;`,
    "}",
    "",
    `fn matWeight(p: vec3<f32>${liveDeclSuffix}) -> f32 {`,
    `  return sampleField(p${liveCallSuffix}).y;`,
    "}",
  ].join("\n");

  return {
    mapSource,
    bounds: boundsOf(root),
    tempCount: nextId,
    liveParams,
    liveDeclSuffix,
    liveCallSuffix,
  };
}

function collectLiveParams(
  centers: Readonly<Record<string, string>>,
  radii: Readonly<Record<string, string>>,
): LiveFieldParam[] {
  const leafIds = new Set([
    ...Object.keys(centers),
    ...Object.keys(radii),
  ]);
  const sorted = [...leafIds].sort();
  const params: LiveFieldParam[] = [];
  const usedNames = new Set<string>();

  for (const leafId of sorted) {
    const cName = centers[leafId];
    if (cName) {
      assertValidParamName(cName, usedNames);
      usedNames.add(cName);
      params.push({
        name: cName,
        wgslType: "vec3<f32>",
        leafId,
        role: "sphereCenter",
      });
    }
    const rName = radii[leafId];
    if (rName) {
      assertValidParamName(rName, usedNames);
      usedNames.add(rName);
      params.push({
        name: rName,
        wgslType: "f32",
        leafId,
        role: "sphereRadius",
      });
    }
  }
  return params;
}

function assertValidParamName(name: string, used: Set<string>): void {
  if (!/^[A-Za-z_][A-Za-z0-9_]*$/.test(name)) {
    throw new Error(`fieldNodeToWgsl: invalid live param name "${name}"`);
  }
  if (used.has(name)) {
    throw new Error(`fieldNodeToWgsl: duplicate live param name "${name}"`);
  }
}

function liveCenterExpr(
  leafId: string | undefined,
  center: Vec3,
  liveCenters: Readonly<Record<string, string>>,
): string {
  if (leafId && liveCenters[leafId]) {
    return liveCenters[leafId]!;
  }
  const [cx, cy, cz] = center;
  return `vec3<f32>(${f(cx)}, ${f(cy)}, ${f(cz)})`;
}

function liveRadiusExpr(
  leafId: string | undefined,
  radius: number,
  liveRadii: Readonly<Record<string, string>>,
): string {
  if (leafId && liveRadii[leafId]) {
    return liveRadii[leafId]!;
  }
  return f(radius);
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
