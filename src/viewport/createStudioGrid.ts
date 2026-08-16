/**
 * Floor grid with analytic (fwidth) line AA.
 * TAAU history reject made GridHelper 1px lines alias while moving and
 * snap finer on settle — this stays ~1 px whether TAAU is accumulating or not.
 */

import {
  Color,
  DoubleSide,
  Mesh,
  PlaneGeometry,
} from "three";
import type { Node } from "three/webgpu";
import { MeshBasicNodeMaterial } from "three/webgpu";
import { Discard, Fn, If, float, positionWorld, uniform, wgslFn } from "three/tsl";

export interface StudioGridOptions {
  readonly sizeMm: number;
  readonly cellMm: number;
  readonly lineColor: number;
  readonly centerColor: number;
}

export function createStudioGrid(options: StudioGridOptions): Mesh {
  const { sizeMm, cellMm, lineColor, centerColor } = options;
  const geometry = new PlaneGeometry(sizeMm, sizeMm);

  const uCell = uniform(float(cellMm));
  const uLine = uniform(new Color(lineColor));
  const uCenter = uniform(new Color(centerColor));

  const shade = wgslFn(`
fn studioGrid(
  worldPos: vec3<f32>,
  cell: f32,
  lineRgb: vec3<f32>,
  centerRgb: vec3<f32>
) -> vec4<f32> {
  let p = worldPos.xy;
  let w = max(fwidth(p), vec2<f32>(1e-4));
  let g = abs(fract(p / cell - 0.5) - 0.5);
  let line = g / (w / cell);
  let aMinor = 1.0 - smoothstep(0.0, 1.15, min(line.x, line.y));
  let c = abs(p) / w;
  let aMajor = 1.0 - smoothstep(0.0, 1.35, min(c.x, c.y));
  let rgb = mix(lineRgb, centerRgb, saturate(aMajor));
  let a = max(aMinor * 0.8, aMajor);
  return vec4<f32>(rgb, a);
}
`);

  const shaded = shade({
    worldPos: positionWorld,
    cell: uCell,
    lineRgb: uLine,
    centerRgb: uCenter,
  }) as Node<"vec4">;

  const material = new MeshBasicNodeMaterial();
  material.transparent = true;
  material.depthWrite = false;
  material.depthTest = true;
  material.side = DoubleSide;
  material.colorNode = Fn(() => {
    If(shaded.w.lessThan(0.02), () => {
      Discard();
    });
    return shaded.xyz;
  })();
  material.opacityNode = Fn(() => shaded.w.max(float(0)))();

  const mesh = new Mesh(geometry, material);
  mesh.frustumCulled = true;
  mesh.renderOrder = -20;
  mesh.name = "studio-grid";
  return mesh;
}
