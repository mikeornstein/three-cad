/**
 * RGB axes with analytic (fwidth) line AA — same reason as the studio grid.
 * Three planes (XY / XZ / YZ) each draw the two axes they contain so the
 * gizmo stays visible when one plane is edge-on.
 */

import { DoubleSide, Group, Mesh, PlaneGeometry } from "three";
import type { Node } from "three/webgpu";
import { MeshBasicNodeMaterial } from "three/webgpu";
import { Discard, Fn, If, float, positionWorld, uniform, wgslFn } from "three/tsl";

export function createStudioAxes(lengthMm: number): Group {
  const group = new Group();
  group.name = "studio-axes";

  const shade = wgslFn(`
fn studioAxis(
  worldPos: vec3<f32>,
  length: f32,
  plane: f32
) -> vec4<f32> {
  let p = worldPos;
  var u = 0.0;
  var v = 0.0;
  var colU = vec3<f32>(1.0, 0.15, 0.12);
  var colV = vec3<f32>(0.15, 1.0, 0.18);
  if (plane < 0.5) {
    u = p.x;
    v = p.y;
    colU = vec3<f32>(1.0, 0.15, 0.12);
    colV = vec3<f32>(0.15, 1.0, 0.18);
  } else if (plane < 1.5) {
    u = p.x;
    v = p.z;
    colU = vec3<f32>(1.0, 0.15, 0.12);
    colV = vec3<f32>(0.25, 0.45, 1.0);
  } else {
    u = p.y;
    v = p.z;
    colU = vec3<f32>(0.15, 1.0, 0.18);
    colV = vec3<f32>(0.25, 0.45, 1.0);
  }
  let w = max(fwidth(vec2<f32>(u, v)), vec2<f32>(1e-4));
  let aU = (1.0 - smoothstep(0.0, 1.25, abs(v) / w.y)) *
    smoothstep(-w.x, 0.0, u) * (1.0 - smoothstep(length, length + w.x, u));
  let aV = (1.0 - smoothstep(0.0, 1.25, abs(u) / w.x)) *
    smoothstep(-w.y, 0.0, v) * (1.0 - smoothstep(length, length + w.y, v));
  let a = max(aU, aV);
  let rgb = (colU * aU + colV * aV) / max(aU + aV, 1e-4);
  return vec4<f32>(rgb, a);
}
`);

  const specs: { plane: number; rot: [number, number, number]; pos: [number, number, number] }[] =
    [
      { plane: 0, rot: [0, 0, 0], pos: [lengthMm * 0.5, lengthMm * 0.5, 0] },
      { plane: 1, rot: [Math.PI / 2, 0, 0], pos: [lengthMm * 0.5, 0, lengthMm * 0.5] },
      { plane: 2, rot: [0, Math.PI / 2, 0], pos: [0, lengthMm * 0.5, lengthMm * 0.5] },
    ];

  for (const spec of specs) {
    const uLength = uniform(float(lengthMm));
    const uPlane = uniform(float(spec.plane));
    const shaded = shade({
      worldPos: positionWorld,
      length: uLength,
      plane: uPlane,
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

    const mesh = new Mesh(new PlaneGeometry(lengthMm, lengthMm), material);
    mesh.rotation.set(...spec.rot);
    mesh.position.set(...spec.pos);
    mesh.renderOrder = -19;
    mesh.frustumCulled = true;
    mesh.name = `studio-axes-${spec.plane}`;
    group.add(mesh);
  }

  return group;
}
