/**
 * Build a Three.js Mesh that sphere-traces a FieldNode inside its AABB
 * via WebGPU / WGSL (MeshBasicNodeMaterial + TSL).
 *
 * Multi-material: leaf weights blend continuously through smooth-union.
 * Demo defaults: cyan resin cube + amber resin sphere (dual transparent gradient).
 *
 * Performance: depth pass is sphere-trace only; color path uses adaptive volume
 * steps and sparse light-thickness samples. Target ≥20 FPS on integrated GPUs.
 *
 * WGSL layout: shared helper FunctionNode included by both shade + depth entry
 * points so Three.js does not redeclare sampleField / sdBox / etc.
 */

import {
  BoxGeometry,
  Color,
  DoubleSide,
  Mesh,
  Vector3,
} from "three";
import type { Node } from "three/webgpu";
import { MeshBasicNodeMaterial } from "three/webgpu";
import {
  Discard,
  Fn,
  If,
  cameraFar,
  cameraNear,
  cameraPosition,
  cameraViewMatrix,
  float,
  normalize,
  positionWorld,
  uniform,
  vec3,
  vec4,
  viewZToPerspectiveDepth,
  wgslFn,
} from "three/tsl";
import type { FieldNode } from "../document/fieldDef";
import type { FieldSolid } from "../sdf";
import { fieldNodeToWgsl } from "./fieldToWgsl";
import {
  DEMO_LEAF_MATERIAL_WEIGHT,
  MAT_AMBER_RESIN,
  MAT_CYAN_RESIN,
  type FieldMaterial,
} from "./materials";

/** userData flag: this mesh is a field ray-march proxy, not a tessellation. */
export const RAY_MARCH_USER = "threeCadRayMarch";

export interface FieldRayMarchOptions {
  readonly name?: string;
  /** @deprecated Prefer material slots; kept as material-0 tint override. */
  readonly color?: number;
  readonly definitionHash?: string;
  /** Pad AABB (mm) so sphere-trace does not clip the surface. Default 1. */
  readonly padMm?: number;
  /** Max sphere-trace steps. Default 96. */
  readonly maxSteps?: number;
  /** Surface hit epsilon (mm). Default 0.05. */
  readonly surfaceEpsMm?: number;
  /** Material weight 0 slot (demo cube / cyan resin). */
  readonly material0?: FieldMaterial;
  /** Material weight 1 slot (demo sphere / amber resin). */
  readonly material1?: FieldMaterial;
  /** leafId → weight in [0,1] for matWeight(). */
  readonly leafMaterialWeight?: Readonly<Record<string, number>>;
}

export interface FieldRayMarchMesh extends Mesh {
  material: MeshBasicNodeMaterial;
}

function colorFromRgb(rgb: readonly [number, number, number]): Color {
  return new Color(rgb[0], rgb[1], rgb[2]);
}

/**
 * Create an AABB box mesh whose fragment shader sphere-traces `fieldNode`.
 * Attaches `fieldSolid` for CPU pick / measure when provided.
 */
export function createFieldRayMarchMesh(
  fieldNode: FieldNode,
  fieldSolid: FieldSolid | undefined,
  options: FieldRayMarchOptions = {},
): FieldRayMarchMesh {
  const leafWeights = options.leafMaterialWeight ?? DEMO_LEAF_MATERIAL_WEIGHT;
  const mat0 = options.material0 ?? MAT_CYAN_RESIN;
  const mat1 = options.material1 ?? MAT_AMBER_RESIN;

  const compiled = fieldNodeToWgsl(fieldNode, {
    leafMaterialWeight: leafWeights,
  });
  const pad = options.padMm ?? 1;
  const min = compiled.bounds.min;
  const max = compiled.bounds.max;

  const sx = Math.max(max[0] - min[0], 1e-3) + pad * 2;
  const sy = Math.max(max[1] - min[1], 1e-3) + pad * 2;
  const sz = Math.max(max[2] - min[2], 1e-3) + pad * 2;
  const cx = (min[0] + max[0]) * 0.5;
  const cy = (min[1] + max[1]) * 0.5;
  const cz = (min[2] + max[2]) * 0.5;

  const geometry = new BoxGeometry(sx, sy, sz);
  geometry.translate(cx, cy, cz);

  const uBoundsMin = uniform(
    new Vector3(min[0] - pad, min[1] - pad, min[2] - pad),
  );
  const uBoundsMax = uniform(
    new Vector3(max[0] + pad, max[1] + pad, max[2] + pad),
  );
  const uAmbient = uniform(new Color(0xffffff).multiplyScalar(0.32));
  const uKeyDir = uniform(new Vector3(200, -120, 280).normalize());
  const uKeyColor = uniform(new Color(0xffffff).multiplyScalar(1.1));
  const uFillDir = uniform(new Vector3(-180, 100, 80).normalize());
  const uFillColor = uniform(new Color(0xb0c4de).multiplyScalar(0.32));
  const uBg = uniform(new Color(0x1a1c1e));
  const uMaxSteps = uniform(float(options.maxSteps ?? 96));
  const uSurfaceEps = uniform(float(options.surfaceEpsMm ?? 0.05));
  const uNormalEps = uniform(float(0.1));

  const uM0Color = uniform(
    options.color !== undefined
      ? new Color(options.color)
      : colorFromRgb(mat0.baseColor),
  );
  const uM0Rough = uniform(float(mat0.roughness));
  const uM0Metal = uniform(float(mat0.metalness));
  const uM0Trans = uniform(float(mat0.transmission));
  const uM0Ior = uniform(float(mat0.ior));
  const uM0SigmaA = uniform(
    vec3(mat0.sigmaA[0], mat0.sigmaA[1], mat0.sigmaA[2]),
  );
  const uM0SigmaS = uniform(
    vec3(mat0.sigmaS[0], mat0.sigmaS[1], mat0.sigmaS[2]),
  );

  const uM1Color = uniform(colorFromRgb(mat1.baseColor));
  const uM1Rough = uniform(float(mat1.roughness));
  const uM1Metal = uniform(float(mat1.metalness));
  const uM1Trans = uniform(float(mat1.transmission));
  const uM1Ior = uniform(float(mat1.ior));
  const uM1SigmaA = uniform(
    vec3(mat1.sigmaA[0], mat1.sigmaA[1], mat1.sigmaA[2]),
  );
  const uM1SigmaS = uniform(
    vec3(mat1.sigmaS[0], mat1.sigmaS[1], mat1.sigmaS[2]),
  );

  // Shared WGSL library — first fn is the include "entry"; callers use helpers by name.
  const fieldLib = wgslFn(`
fn fieldLibPing() -> f32 { return 0.0; }

fn intersectAabb(ro: vec3<f32>, rd: vec3<f32>, bmin: vec3<f32>, bmax: vec3<f32>) -> vec3<f32> {
  let inv = 1.0 / rd;
  let t0 = (bmin - ro) * inv;
  let t1 = (bmax - ro) * inv;
  let tmin = min(t0, t1);
  let tmax = max(t0, t1);
  let tNear = max(max(tmin.x, tmin.y), tmin.z);
  let tFar = min(min(tmax.x, tmax.y), tmax.z);
  let hit = select(0.0, 1.0, tFar >= max(tNear, 0.0));
  return vec3<f32>(tNear, tFar, hit);
}

fn sphereTrace(
  ro: vec3<f32>,
  rd: vec3<f32>,
  boundsMin: vec3<f32>,
  boundsMax: vec3<f32>,
  maxSteps: f32,
  surfaceEps: f32
) -> f32 {
  let aabb = intersectAabb(ro, rd, boundsMin, boundsMax);
  if (aabb.z < 0.5) {
    return -1.0;
  }
  var t = max(aabb.x, 0.0);
  let tFar = aabb.y;
  let stepScale = 0.85;
  let maxS = i32(maxSteps);
  for (var i = 0; i < 160; i++) {
    if (i >= maxS) { break; }
    if (t > tFar) { break; }
    let p = ro + rd * t;
    let d = sampleField(p).x;
    if (d < surfaceEps) {
      return t;
    }
    t = t + max(d * stepScale, surfaceEps * 0.5);
  }
  return -1.0;
}

fn calcNormal(p: vec3<f32>, normalEps: f32) -> vec3<f32> {
  let e = normalEps;
  return normalize(vec3<f32>(
    sampleField(p + vec3<f32>(e, 0.0, 0.0)).x - sampleField(p - vec3<f32>(e, 0.0, 0.0)).x,
    sampleField(p + vec3<f32>(0.0, e, 0.0)).x - sampleField(p - vec3<f32>(0.0, e, 0.0)).x,
    sampleField(p + vec3<f32>(0.0, 0.0, e)).x - sampleField(p - vec3<f32>(0.0, 0.0, e)).x
  ));
}

fn fresnelSchlick(cosTheta: f32, F0: vec3<f32>) -> vec3<f32> {
  return F0 + (vec3<f32>(1.0) - F0) * pow(clamp(1.0 - cosTheta, 0.0, 1.0), 5.0);
}

fn thicknessToOutside(p0: vec3<f32>, dir: vec3<f32>, surfaceEps: f32, maxSteps: i32) -> f32 {
  var p = p0;
  var trav = 0.0;
  for (var i = 0; i < 16; i++) {
    if (i >= maxSteps) { break; }
    let d = sampleField(p).x;
    if (d > surfaceEps) {
      return trav;
    }
    let step = max(-d * 0.9, surfaceEps * 0.6);
    p = p + dir * step;
    trav = trav + step;
    if (trav > 120.0) { break; }
  }
  return trav;
}

${compiled.mapSource}
`);

  const shadeField = wgslFn(
    `
fn shadeField(
  worldPos: vec3<f32>,
  cameraPos: vec3<f32>,
  boundsMin: vec3<f32>,
  boundsMax: vec3<f32>,
  ambient: vec3<f32>,
  keyDir: vec3<f32>,
  keyColor: vec3<f32>,
  fillDir: vec3<f32>,
  fillColor: vec3<f32>,
  bg: vec3<f32>,
  maxSteps: f32,
  surfaceEps: f32,
  normalEps: f32,
  m0Color: vec3<f32>,
  m0Rough: f32,
  m0Metal: f32,
  m0Trans: f32,
  m0Ior: f32,
  m0SigmaA: vec3<f32>,
  m0SigmaS: vec3<f32>,
  m1Color: vec3<f32>,
  m1Rough: f32,
  m1Metal: f32,
  m1Trans: f32,
  m1Ior: f32,
  m1SigmaA: vec3<f32>,
  m1SigmaS: vec3<f32>
) -> vec4<f32> {
  let ro = cameraPos;
  let rd = normalize(worldPos - cameraPos);

  let hitT = sphereTrace(ro, rd, boundsMin, boundsMax, maxSteps, surfaceEps);
  if (hitT < 0.0) {
    return vec4<f32>(0.0, 0.0, 0.0, -1.0);
  }

  let pos = ro + rd * hitT;
  let n = calcNormal(pos, normalEps);
  let s0 = sampleField(pos);
  let mw = clamp(s0.y, 0.0, 1.0);

  let baseColor = mix(m0Color, m1Color, mw);
  let roughness = mix(m0Rough, m1Rough, mw);
  let metalness = mix(m0Metal, m1Metal, mw);
  let transmission = mix(m0Trans, m1Trans, mw);

  let v = -rd;
  let nDotV = max(dot(n, v), 0.0);
  let F0 = mix(vec3<f32>(0.04), baseColor, metalness);
  let F = fresnelSchlick(nDotV, F0);

  let kDir = normalize(keyDir);
  let fDir = normalize(fillDir);
  let hKey = normalize(kDir + v);
  let specPow = mix(56.0, 10.0, roughness);
  let specKey = pow(max(dot(n, hKey), 0.0), specPow) * keyColor;
  let ndlKey = max(dot(n, kDir), 0.0);
  let ndlFill = max(dot(n, fDir), 0.0);

  if (metalness > 0.7 && transmission < 0.2) {
    let diff = baseColor * (ambient + keyColor * ndlKey + fillColor * ndlFill);
    let lit = mix(diff, baseColor * (specKey * 1.4 + ambient * 0.25 + fillColor * ndlFill * 0.4), metalness);
    return vec4<f32>(lit + F * specKey * (1.0 - roughness * 0.7), hitT);
  }

  // Soften specular on high-transmission media so the color gradient reads cleanly
  // (avoids a blown-out white bloom at the soft-min neck).
  let specAmt = (1.0 - roughness * 0.5) * mix(1.0, 0.28, transmission);
  let specular = F * specKey * specAmt;

  // Continuous dual-medium volume: sample mat weight every step for clean gradient.
  var T = vec3<f32>(1.0);
  var Cvol = vec3<f32>(0.0);
  var p = pos + rd * (surfaceEps * 2.5);
  var lastThick = 8.0;
  let minDs = 0.6;
  let maxDs = 4.5;
  let maxPath = 160.0;

  for (var vi = 0; vi < 36; vi++) {
    let s = sampleField(p);
    if (s.x > surfaceEps) {
      break;
    }

    let w = clamp(s.y, 0.0, 1.0);
    let col = mix(m0Color, m1Color, w);
    let sa = mix(m0SigmaA, m1SigmaA, w);
    let ss = mix(m0SigmaS, m1SigmaS, w);
    let st = sa + ss;
    let albedo = ss / max(st, vec3<f32>(1e-4));

    let ds = clamp(max(-s.x, surfaceEps) * 0.55 + minDs * 0.35, minDs, maxDs);

    if ((vi % 3) == 0) {
      lastThick = thicknessToOutside(p, kDir, surfaceEps, 10);
    }
    let lightAtt = exp(-sa * lastThick);
    let Li = keyColor * lightAtt * 0.28;
    let scatter = albedo * Li * col;

    let Tr = exp(-st * ds);
    Cvol = Cvol + T * (vec3<f32>(1.0) - Tr) * scatter;
    T = T * Tr;

    if (max(T.x, max(T.y, T.z)) < 0.025) {
      break;
    }
    p = p + rd * ds;
    if (distance(p, pos) > maxPath) {
      break;
    }
  }

  let surfaceDiff = baseColor * (
    ambient * 0.45 + keyColor * ndlKey * 0.18 + fillColor * ndlFill * 0.12
  );
  let body = Cvol + T * (surfaceDiff * 0.55 + bg * 0.12);
  let lit = specular + (vec3<f32>(1.0) - F) * body * (0.3 + 0.7 * transmission);

  return vec4<f32>(lit, hitT);
}
`,
    // Shared helper FunctionNode (types: CodeNodeInclude[]).
    [fieldLib as never],
  );

  const hitDepth = wgslFn(
    `
fn hitDepth(
  worldPos: vec3<f32>,
  cameraPos: vec3<f32>,
  boundsMin: vec3<f32>,
  boundsMax: vec3<f32>,
  maxSteps: f32,
  surfaceEps: f32
) -> f32 {
  let ro = cameraPos;
  let rd = normalize(worldPos - cameraPos);
  return sphereTrace(ro, rd, boundsMin, boundsMax, maxSteps, surfaceEps);
}
`,
    [fieldLib as never],
  );

  const material = new MeshBasicNodeMaterial();
  material.side = DoubleSide;
  material.depthTest = true;
  material.depthWrite = true;
  material.transparent = false;

  const shadeArgs = {
    worldPos: positionWorld,
    cameraPos: cameraPosition,
    boundsMin: uBoundsMin,
    boundsMax: uBoundsMax,
    ambient: uAmbient,
    keyDir: uKeyDir,
    keyColor: uKeyColor,
    fillDir: uFillDir,
    fillColor: uFillColor,
    bg: uBg,
    maxSteps: uMaxSteps,
    surfaceEps: uSurfaceEps,
    normalEps: uNormalEps,
    m0Color: uM0Color,
    m0Rough: uM0Rough,
    m0Metal: uM0Metal,
    m0Trans: uM0Trans,
    m0Ior: uM0Ior,
    m0SigmaA: uM0SigmaA,
    m0SigmaS: uM0SigmaS,
    m1Color: uM1Color,
    m1Rough: uM1Rough,
    m1Metal: uM1Metal,
    m1Trans: uM1Trans,
    m1Ior: uM1Ior,
    m1SigmaA: uM1SigmaA,
    m1SigmaS: uM1SigmaS,
  };

  material.colorNode = Fn(() => {
    const shaded = shadeField(shadeArgs) as Node<"vec4">;
    If(shaded.w.lessThan(0.0), () => {
      Discard();
    });
    return shaded.xyz;
  })();

  material.depthNode = Fn(() => {
    const t = hitDepth({
      worldPos: positionWorld,
      cameraPos: cameraPosition,
      boundsMin: uBoundsMin,
      boundsMax: uBoundsMax,
      maxSteps: uMaxSteps,
      surfaceEps: uSurfaceEps,
    }) as Node<"float">;
    const rd = normalize(positionWorld.sub(cameraPosition));
    const hitPos = cameraPosition.add(rd.mul(t));
    const viewPos = cameraViewMatrix.mul(vec4(hitPos, 1.0));
    return viewZToPerspectiveDepth(viewPos.z, cameraNear, cameraFar);
  })();

  const mesh = new Mesh(geometry, material) as FieldRayMarchMesh;
  if (options.name) mesh.name = options.name;
  mesh.userData[RAY_MARCH_USER] = true;
  mesh.userData.fieldNode = fieldNode;
  if (fieldSolid) mesh.userData.fieldSolid = fieldSolid;
  if (options.definitionHash !== undefined) {
    mesh.userData.definitionHash = options.definitionHash;
  }
  mesh.userData.rayMarchUniforms = {
    uAmbient,
    uKeyDir,
    uKeyColor,
    uFillDir,
    uFillColor,
    uBoundsMin,
    uBoundsMax,
    uMaxSteps,
    uSurfaceEps,
    uNormalEps,
    uM0Color,
    uM1Color,
  };
  mesh.frustumCulled = true;

  return mesh;
}

/** True when a mesh is a field sphere-trace display proxy. */
export function isRayMarchMesh(mesh: Mesh): boolean {
  return mesh.userData?.[RAY_MARCH_USER] === true;
}

/** Camera uniforms are TSL built-ins on WebGPU. */
export function updateRayMarchUniforms(
  _mesh: Mesh,
  _cameraPos: Vector3,
  _projectionMatrix: unknown,
  _viewMatrix: unknown,
): void {
  // no-op
}
